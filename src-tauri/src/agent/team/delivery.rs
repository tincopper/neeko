//! `Pty` 通道的投递（`team_send → NeedsDelivery` 的消费侧）。
//!
//! # 三层，各管一件事
//!
//! | 层 | 是什么 | 为什么 |
//! | --- | --- | --- |
//! | [`route`] | 纯函数：成员通道 → 怎么送 | 通道是**数据**（`WorkerChannel`），送法是策略；纯函数才能直测三档 |
//! | [`delivery_text`] | 纯函数：发送者 + 正文 → 接收方看到的那一行 | 投递文本是对方**唯一**的身份线索，只拼一次 |
//! | [`pty_write_plan`] | 纯函数：消息 + 提交形态 → 两笔写入 | AC14 的机器判据 |
//! | [`deliver_via_pty`] | 真的写（`emit` + 等待） | 唯一不可单测的部分，因此只剩三行 |
//!
//! # 写入协议是**两笔**，不是一笔
//!
//! 实测（`research/04-rmux-demo-close-reading.md`）：把 `"text\n"` 一次写进部分 AI TUI 的
//! stdin，会被丢弃或把回车解释成别的东西 —— 它们把「粘贴的文本」与「用户按下回车」当成
//! 两个批次解析。所以协议固定为：
//!
//! ```text
//! emit(terminal-input-{id}, text_bytes)   ← literal，不加换行
//! sleep(~150ms)                            ← 让 TUI 走完一次输入处理
//! emit(terminal-input-{id}, "\r")          ← 单独一次
//! ```
//!
//! **第一笔的字节内容由 [`PtySubmit`] 决定**（per-CLI 实测事实，由执行层从准入表取出）：
//! 大多数 CLI 就是裸正文，codex 必须包成显式粘贴（`ESC[200~ … ESC[201~`）—— 否则它的
//! paste-burst 会把紧跟的回车当成「粘贴里的换行」，消息永远停在输入框。两笔的**结构**与
//! 间隔对每一行都一样，所以「正文与回车分两笔」这条实测结论仍然成立。
//!
//! # 为什么走事件而不是直接拿 writer
//!
//! `terminal` 域已经把 stdin 的写权收在一处：`spawn_writer_listener` 独占 `writer`，前端
//! 通过 `terminal-input-{id}` 事件写入。团队域复用**同一事件**（名字来自
//! `common::terminal::events`，红线 5 的单一源）就不必去抢 writer 的所有权，也不必在
//! terminal 域新增一条"给某个 session 写字节"的 API。
//!
//! 代价是投递变成「emit + 等待」，所以本函数必须在**阻塞池**里调用（红线 3）。
//!
//! # 三种"不写字节"的情形，各有各的负责层
//!
//! | 情形 | 谁拒绝 | 形态 |
//! | --- | --- | --- |
//! | 目标 `MemberState::Awaiting`（在等人批） | `mcp::dispatch`（决策层） | `target_blocked`，一个字节都不写（AC14 的前半） |
//! | 通道不是 `Pty`（`Mcp` / `None`） | [`route`]（本模块，纯函数） | `DeliveryRoute::Unsupported` + 可行动理由 |
//! | 成员没有活的 PTY 会话（没起进程 / 已退出 / 已归档） | 执行层（`app::team_executor`） | `Unsupported`，回给队长 |
//!
//! 三种都**不能**静默成功：队长会继续往下走，而成员从未收到那个任务。

use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::agent::team::types::WorkerChannel;
use crate::common::error::AppError;
use crate::common::terminal::events::terminal_input_event;

/// 两笔写入之间的间隔。
///
/// 150ms 来自实测（`research/04` §2）：更短会在同一批里被 TUI 合并，等于回到"一次写
/// `text\n`"的失败形态；更长只是慢，不会更对。
pub const PTY_WRITE_GAP: Duration = Duration::from_millis(150);

/// 一笔待写入的 PTY 投递。
///
/// `writes` 恒为两笔（正文 + 回车）—— 用固定长度的数组而不是 `Vec`，让"必须拆成两笔"
/// 这件事在类型上就成立，而不是靠调用方自觉。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PtyWritePlan {
    /// 第一笔：正文（literal，**不带**换行），按 [`PtySubmit`] 决定要不要包成显式粘贴。
    pub text: Vec<u8>,
    /// 第二笔：单独的回车。
    pub enter: Vec<u8>,
    /// 两笔之间的间隔。
    pub gap: Duration,
}

/// 把一行字变成**一次提交**的形态 —— 每 CLI 的实测事实（红线 15 同族）。
///
/// # 为什么是数据，且没有默认值可偷懒
///
/// 两种形态对**不认对方那个写法的 TUI** 都是灾难：
/// - 裸正文（[`Self::Plain`]）发给 codex ⇒ paste-burst 把紧跟的回车当成「粘贴里的换行」，
///   消息停在输入框；
/// - bracketed paste（[`Self::BracketedPaste`]）发给一个不认识这个转义的 TUI ⇒ 它把
///   `ESC[200~` 当字面量插进输入框。
///
/// 所以它**必须**在准入表里逐行填写，而不是写成「默认包起来」或「按 agent 名分支」：
/// 只有实测过能用的那一行才配非 `Plain`。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PtySubmit {
    /// 正文一笔（literal）→ 间隔 → `\r` 一笔。既有形态，逐字节不变。
    Plain,
    /// `ESC[200~` + 正文 + `ESC[201~` 一笔 → 间隔 → `\r` 一笔。
    ///
    /// 显式粘贴会清掉 codex 的 paste-burst 窗口（`clear_after_explicit_paste`），
    /// 回车因此**必然**被当成提交，而不是窗口内的「换行」。
    BracketedPaste,
}

/// 成员通道 → 投递方式（纯函数）。
///
/// 三档由 `WorkerChannel` 这一**数据**决定（红线 15 的同一思路：不按 agent 名分支）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DeliveryRoute {
    /// 能直接写 stdin：按两笔协议送。
    Pty(PtyWritePlan),
    /// 送不了。理由要**可行动**：队长看完知道下一步该做什么，而不是去查文档。
    Unsupported(&'static str),
}

/// 选投递方式。
///
/// `submit` 是成员那台 CLI 的**提交形态**（由执行层从准入表取出后传入，见
/// `admission::pty_submit_for`）—— 投递层不认识 CLI，只认识值。
///
/// # 为什么 `Mcp` 是 `Unsupported` 而不是「静默成功」
///
/// `Mcp` 意味着「成员是我们的客户端」—— 它调我们，我们**没有**往它嘴里推的通道。
/// 假装送达比报错坏得多：队长会继续往下走，而成员从未收到那个任务。让它得到一个
/// 明确错误、并指向板上派活（`task_create` / `task_update`）才是可行动的。
///
/// # 谁还会走到 `Mcp` / `None` 这两支
///
/// CLI 成员现在一律 `Pty`（[`WorkerChannel::CLI_MEMBER`]）。剩下三种：
/// ① 将来接 Chat 成员时，`Mcp` 会先变成真通道（`SessionRequest`）再解除拒绝；
/// ② 本轮改动**之前**落库的成员行（通道已持久化）—— 拒绝理由同样可行动；
/// ③ 准入表里没有工具面的行（`None`），`team_spawn` 现在早拒，只剩历史数据。
#[must_use]
pub fn route(channel: WorkerChannel, submit: PtySubmit, message: &str) -> DeliveryRoute {
    match channel {
        WorkerChannel::Pty => DeliveryRoute::Pty(pty_write_plan(message, submit)),
        WorkerChannel::Mcp => DeliveryRoute::Unsupported(
            "this member's only inbound channel is MCP (it calls us; we cannot push to it), so \
             `team_send` cannot reach it: hand it work through the task board instead \
             (`task_create` / `task_update`)",
        ),
        WorkerChannel::None => DeliveryRoute::Unsupported(
            "this member has no inbound channel at all (admission tier B/C), so no message can \
             be delivered to it; recover its result from the sentinel channel instead",
        ),
    }
}

/// 显式粘贴的**开启**序列（bracketed paste on）。
///
/// 只写在这一处：包裹字节是**投递协议**，不是 per-CLI 事实 —— per-CLI 的只是「用不用它」
/// （[`PtySubmit`]）。
const BRACKETED_PASTE_OPEN: &[u8] = b"\x1b[200~";

/// 显式粘贴的**关闭**序列（bracketed paste off），紧接着正文。
const BRACKETED_PASTE_CLOSE: &[u8] = b"\x1b[201~";

/// 把一条消息排成两笔写入（纯函数，AC14 的机器判据）。
///
/// 正文里的 `\n` / `\r` 原样保留：它们是消息内容的一部分，不该被这里改写
/// （"规范化换行"会让代码片段在 TUI 里变样）。`submit` 改变的是**外面那层声明**：
/// `BracketedPaste` 把正文包进 `ESC[200~ … ESC[201~`，正文自身一个字节也不动。
#[must_use]
pub fn pty_write_plan(message: &str, submit: PtySubmit) -> PtyWritePlan {
    let body = message.as_bytes();
    let text = match submit {
        PtySubmit::Plain => body.to_vec(),
        PtySubmit::BracketedPaste => {
            let mut wrapped = Vec::with_capacity(
                BRACKETED_PASTE_OPEN.len() + body.len() + BRACKETED_PASTE_CLOSE.len(),
            );
            wrapped.extend_from_slice(BRACKETED_PASTE_OPEN);
            wrapped.extend_from_slice(body);
            wrapped.extend_from_slice(BRACKETED_PASTE_CLOSE);
            wrapped
        }
    };
    PtyWritePlan {
        text,
        enter: b"\r".to_vec(),
        gap: PTY_WRITE_GAP,
    }
}

/// 把一条队内消息拼成**接收方在 TUI 里看到的那一行**（纯函数）。
///
/// # 为什么这段文本存在
///
/// `team_send` 的唯一效果就是往对方 stdin 写一行字节。对方（另一个 CLI agent）看见的
/// 就是这行字 —— 没有 `from` 时队长收到 `1275` / `3775` 根本不知道是谁在说话（真实
/// 冒烟测试的现场：发送者在链路上整段丢失）。
///
/// # 格式是契约，且只做一件事
///
/// `"[team] {from}: {message}"` —— 一行、可 grep、**不加工正文**：
///
/// - 不 `trim`：正文的前后空白也是内容（粘贴的代码片段 / 缩进块）；
/// - 不 `escape` / 不折行：正文里的 `\n` 原样保留（同 [`pty_write_plan`] 的立场）；
/// - 不加第二个分隔符：前缀必须能一眼认出，而正文必须能**逐字**匹配回去。
#[must_use]
pub fn delivery_text(from: &str, message: &str) -> String {
    format!("[team] {from}: {message}")
}

/// 真正投递：两笔写入 + 中间的间隔。
///
/// 阻塞 150ms，调用方必须在阻塞池里调（红线 3）。
pub fn deliver_via_pty(
    app: &AppHandle,
    terminal_id: &str,
    plan: &PtyWritePlan,
) -> Result<(), AppError> {
    let event = terminal_input_event(terminal_id);
    emit_write(app, &event, plan.text.clone())?;
    std::thread::sleep(plan.gap);
    emit_write(app, &event, plan.enter.clone())
}

/// 单笔写入。抽出来只为让「两笔」这个结构在代码里也看得见。
fn emit_write(app: &AppHandle, event: &str, bytes: Vec<u8>) -> Result<(), AppError> {
    app.emit(event, bytes).map_err(|err| {
        AppError::Unsupported(format!(
            "cannot deliver to pty session via `{event}`: {err}; the session may have exited"
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// AC14 后半：正文与回车**分两笔**，且中间有间隔。
    #[test]
    fn the_message_and_the_enter_are_two_separate_writes() {
        let plan = pty_write_plan("run the tests", PtySubmit::Plain);
        assert_eq!(plan.text, b"run the tests");
        assert_eq!(plan.enter, b"\r", "回车必须单独一笔，且是 CR");
        assert_eq!(plan.gap, PTY_WRITE_GAP);
        assert!(
            !plan.text.ends_with(b"\r") && !plan.text.ends_with(b"\n"),
            "正文不得自带回车 —— 那正是部分 TUI 会丢弃的形态"
        );
    }

    /// `Plain` 的字节与改动前**逐字节相同**：除 codex 之外的成员的投递不因本轮改动变样。
    ///
    /// 这是 R3 的机器判据。`PtySubmit` 迟到地加进来之后，最容易发生的退化是「顺手把所有
    /// 行的第一笔都包起来」—— 对不认这个转义的 TUI，那会把 `ESC[200~` 当字面量插进输入框。
    #[test]
    fn plain_plan_is_byte_identical_to_the_original_protocol() {
        let plan = pty_write_plan("hi", PtySubmit::Plain);
        assert_eq!(plan.text, b"hi");
        assert_eq!(plan.enter, b"\r");
        assert_eq!(plan.gap, PTY_WRITE_GAP);
    }

    /// `BracketedPaste` 只改**第一笔的内容**，回车仍是单独一笔（`PtyWritePlan` 的两笔契约不变）。
    ///
    /// 为什么是这个形状：explicit paste（`ESC[200~ … ESC[201~`）会清掉 codex 的 paste-burst
    /// 窗口（`clear_after_explicit_paste`），之后的回车因此**必然**被当成提交，而不是
    /// 「粘贴里的换行」。间隔常量仍然保留：对 codex 它已不承担正确性，但「两笔」这条协议
    /// 对所有 CLI 必须一致。
    #[test]
    fn bracketed_paste_wraps_the_body_and_keeps_enter_separate() {
        let plan = pty_write_plan("hi", PtySubmit::BracketedPaste);
        assert_eq!(plan.text, b"\x1b[200~hi\x1b[201~");
        assert_eq!(plan.enter, b"\r", "回车必须是单独一笔（不被包进粘贴）");
        assert_eq!(plan.gap, PTY_WRITE_GAP);
    }

    /// 包裹**不改写正文**：多行与 UTF-8 只被包起来，换行与字节原样保留。
    ///
    /// 反例（本用例挡的正是它）：顺手对正文做 `trim()` / 换行归一 —— 粘贴的代码片段会变形，
    /// 而「投递成功」依然成立，所以没有别的测试会红。
    #[test]
    fn the_wrapper_survives_multiline_and_utf8_bodies() {
        let body = "line1\n中文";
        let plan = pty_write_plan(body, PtySubmit::BracketedPaste);
        let expected = [
            b"\x1b[200~".as_slice(),
            body.as_bytes(),
            b"\x1b[201~".as_slice(),
        ]
        .concat();
        assert_eq!(plan.text, expected);
        assert_eq!(plan.enter, b"\r");
    }

    /// 投递文本带**发送者**：接收方只能看到这一行字，没有发送者就无法归因。
    #[test]
    fn the_delivery_text_names_the_sender() {
        let text = delivery_text("w2@tm_1", "please rebase");
        assert_eq!(text, "[team] w2@tm_1: please rebase");
        assert!(text.starts_with("[team] "), "前缀必须可 grep：{text}");
    }

    /// 正文**逐字**保留：前后空白 / 多行 / 制表符都不被加工。
    ///
    /// 反例（本用例挡的正是它）：对正文做 `trim()` —— 粘贴的代码片段会因此变形，而
    /// 「投递成功」这件事依然成立，所以没有任何其它测试会红。
    #[test]
    fn the_delivery_text_keeps_the_body_verbatim() {
        let body = "\n  line1\n\tline2  \n";
        assert_eq!(
            delivery_text("w2@tm_1", body),
            format!("[team] w2@tm_1: {body}")
        );
        // 空正文不被折成空行之外的东西（前缀 + 空格原样）。
        assert_eq!(delivery_text("w2@tm_1", ""), "[team] w2@tm_1: ");
    }

    /// 发送者原样拼进前缀（成员 id 含 `@`，任何「归一化」都会让它找不到成员）。
    #[test]
    fn the_delivery_text_does_not_normalise_the_sender() {
        let text = delivery_text(" w2@tm_1 ", "hi");
        assert_eq!(text, "[team]  w2@tm_1 : hi", "发送者同样不得 trim");
    }

    /// 正文里的换行/回车是**内容**，不得被规范化掉（代码片段会因此变样）。
    #[test]
    fn newlines_inside_the_message_are_preserved() {
        let plan = pty_write_plan("line1\nline2\r\nline3", PtySubmit::Plain);
        assert_eq!(plan.text, b"line1\nline2\r\nline3");
        assert_eq!(plan.enter, b"\r");
    }

    /// 多字节字符按 UTF-8 原样送出（不截断、不转义）。
    #[test]
    fn multibyte_text_is_sent_as_utf8_bytes() {
        let plan = pty_write_plan("跑一下测试", PtySubmit::Plain);
        assert_eq!(plan.text, "跑一下测试".as_bytes());
    }

    /// `Pty` 通道得到两笔写入计划；另外两档得到**可行动**的拒绝理由。
    ///
    /// 两种提交形态都要过一遭：`submit` 只改第一笔的字节，**不得**把非 `Pty` 通道打开
    /// （那会让队长以为往一个没有下行通道的成员嘴里推进了消息）。
    #[test]
    fn only_the_pty_channel_gets_a_write_plan() {
        for submit in [PtySubmit::Plain, PtySubmit::BracketedPaste] {
            assert!(
                matches!(
                    route(WorkerChannel::Pty, submit, "hi"),
                    DeliveryRoute::Pty(_)
                ),
                "{submit:?}：`Pty` 通道必须得到写入计划"
            );

            // `Mcp` 的拒绝理由必须指向替代路径（板上派活），否则队长只能卡住。
            match route(WorkerChannel::Mcp, submit, "hi") {
                DeliveryRoute::Unsupported(why) => {
                    assert!(why.contains("MCP"), "{why}");
                    assert!(why.contains("task_create"), "{why}");
                }
                other => panic!("Mcp 通道不得得到写入计划（{submit:?}）：{other:?}"),
            }

            match route(WorkerChannel::None, submit, "hi") {
                DeliveryRoute::Unsupported(why) => {
                    assert!(why.contains("no inbound channel"), "{why}");
                }
                other => panic!("None 通道不得得到写入计划（{submit:?}）：{other:?}"),
            }
        }
    }
}
