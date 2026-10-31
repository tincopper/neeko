//! `Pty` 通道的投递（`team_send → NeedsDelivery` 的消费侧）。
//!
//! # 三层，各管一件事
//!
//! | 层 | 是什么 | 为什么 |
//! | --- | --- | --- |
//! | [`route`] | 纯函数：成员通道 → 怎么送 | 通道是**数据**（`WorkerChannel`），送法是策略；纯函数才能直测三档 |
//! | [`pty_write_plan`] | 纯函数：消息 → 两笔写入 | AC14 的机器判据 |
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
//! | 成员没有 `terminal_id`（没起进程 / 已归档） | 执行层（`app::team_executor`） | `Unsupported`，回给队长 |
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
    /// 第一笔：正文（literal，**不带**换行）。
    pub text: Vec<u8>,
    /// 第二笔：单独的回车。
    pub enter: Vec<u8>,
    /// 两笔之间的间隔。
    pub gap: Duration,
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
pub fn route(channel: WorkerChannel, message: &str) -> DeliveryRoute {
    match channel {
        WorkerChannel::Pty => DeliveryRoute::Pty(pty_write_plan(message)),
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

/// 把一条消息排成两笔写入（纯函数，AC14 的机器判据）。
///
/// 正文里的 `\n` / `\r` 原样保留：它们是消息内容的一部分，不该被这里改写
/// （"规范化换行"会让代码片段在 TUI 里变样）。
#[must_use]
pub fn pty_write_plan(message: &str) -> PtyWritePlan {
    PtyWritePlan {
        text: message.as_bytes().to_vec(),
        enter: b"\r".to_vec(),
        gap: PTY_WRITE_GAP,
    }
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
        let plan = pty_write_plan("run the tests");
        assert_eq!(plan.text, b"run the tests");
        assert_eq!(plan.enter, b"\r", "回车必须单独一笔，且是 CR");
        assert_eq!(plan.gap, PTY_WRITE_GAP);
        assert!(
            !plan.text.ends_with(b"\r") && !plan.text.ends_with(b"\n"),
            "正文不得自带回车 —— 那正是部分 TUI 会丢弃的形态"
        );
    }

    /// 正文里的换行/回车是**内容**，不得被规范化掉（代码片段会因此变样）。
    #[test]
    fn newlines_inside_the_message_are_preserved() {
        let plan = pty_write_plan("line1\nline2\r\nline3");
        assert_eq!(plan.text, b"line1\nline2\r\nline3");
        assert_eq!(plan.enter, b"\r");
    }

    /// 多字节字符按 UTF-8 原样送出（不截断、不转义）。
    #[test]
    fn multibyte_text_is_sent_as_utf8_bytes() {
        let plan = pty_write_plan("跑一下测试");
        assert_eq!(plan.text, "跑一下测试".as_bytes());
    }

    /// `Pty` 通道得到两笔写入计划；另外两档得到**可行动**的拒绝理由。
    #[test]
    fn only_the_pty_channel_gets_a_write_plan() {
        assert!(matches!(
            route(WorkerChannel::Pty, "hi"),
            DeliveryRoute::Pty(_)
        ));

        // `Mcp` 的拒绝理由必须指向替代路径（板上派活），否则队长只能卡住。
        match route(WorkerChannel::Mcp, "hi") {
            DeliveryRoute::Unsupported(why) => {
                assert!(why.contains("MCP"), "{why}");
                assert!(why.contains("task_create"), "{why}");
            }
            other => panic!("Mcp 通道不得得到写入计划：{other:?}"),
        }

        match route(WorkerChannel::None, "hi") {
            DeliveryRoute::Unsupported(why) => assert!(why.contains("no inbound channel"), "{why}"),
            other => panic!("None 通道不得得到写入计划：{other:?}"),
        }
    }
}
