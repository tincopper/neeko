//! sentinel 扫描器（design §5.7 / `research/03-sentinel-channel.md`）—— **纯字节函数**。
//!
//! 成员的 stdout 会被 pump 原样转给 WebView；本模块是「第二个 sink 消费者」的解析半边：
//! 从同一份原始字节里认出成员打印的结果行
//!
//! ```text
//! NEEKO_RESULT <nonce> {"executionId":"…","task_id":"…","status":"completed","summary":"…"}
//! ```
//!
//! 它是**无 hook / 无 MCP** agent 唯一可行的结果通道（C 档准入，design §4.4）。
//!
//! # 本模块刻意**不做**的事
//!
//! - **不做归属校验**：`nonce` 的绑定关系、`task_id` 的 owner 与 `state`、`executionId` 的幂等
//!   都在 `TeamManager`（它才持有权威状态，design §5.7 的条件 ③④）。因此 [`SentinelScanner::feed`]
//!   **不接触 DB、不持锁、不 spawn**，可以在 pump 的热路径上被调用。
//! - **不报错**：in-band 通道里「格式不对」是每日常态（回显的任务模板本身就会被扫到）。
//!   任何解析失败都静默丢弃该行 —— 返回 `Result` 只会让调用方把噪声当故障。
//! - **不回写终端**：in-band 无处回错。
//!
//! # 三条历史约束（都是踩出来的）
//!
//! 1. **绝不无界累积**：carry 只保存「一行尚未结束的字节」，且上限
//!    [`MAX_LINE_BYTES`]（2 KiB），远低于 [`MAX_CARRY_BYTES`]（8 KiB）。该 pump 的历史事故是
//!    WebView 8 分钟涨到 5.2 GB（红线 4 的由来），所以这里连「先攒着，遇到 `\n` 再判」都不做：
//!    超限立刻丢掉已累积字节并只留一个标记。
//! 2. **剥 ANSI 再匹配**：颜色码会插在 JSON 中间（`{"sta\x1b[0mtus":…}`），
//!    复用 `common::text::strip_ansi`（零域语义的通用原语），不在本文件复制大正则。
//! 3. **只在 `\n` 处切行**：终端软换行不进字节流，进来的 `\n` 都是 agent 自己打的硬换行。

use crate::common::text::strip_ansi;

/// sentinel 行前缀（**带尾随空格**：`NEEKO_RESULT_X` 这类同族词不得误匹配）。
pub const SENTINEL_PREFIX: &str = "NEEKO_RESULT ";

/// carry buffer 上限（未结束行的累积上界，design §5.7 约束 1）。
pub const MAX_CARRY_BYTES: usize = 8 * 1024;

/// 单行上限；超过则整行丢弃（design §5.7 约束 4：载荷要小）。
pub const MAX_LINE_BYTES: usize = 2 * 1024;

/// 结果状态。**非法值即丢弃该行**，绝不兜底成 [`SentinelStatus::Completed`]。
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SentinelStatus {
    /// 成员声明完成。
    Completed,
    /// 成员声明失败。
    Failed,
    /// 成员声明被阻塞。
    Blocked,
}

/// 结果载荷（wire → 类型化后）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SentinelPayload {
    /// 幂等键（design §5.7 条件 ④）；去重在 `TeamManager`。
    pub execution_id: String,
    /// 结果归属的任务（design §5.7 条件 ③）；owner/state 校验在 `TeamManager`。
    pub task_id: String,
    /// 结果状态。
    pub status: SentinelStatus,
    /// 结果摘要（可选）。
    pub summary: Option<String>,
}

/// 一次命中：`nonce` + 载荷。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SentinelHit {
    /// 注入任务体的 nonce（挡**意外回显**，不挡刻意伪造 —— 见 research/03 §3）。
    pub nonce: String,
    /// 结果载荷。
    pub payload: SentinelPayload,
}

/// wire 形状（**一次性的反序列化目标**，不对外暴露）。
///
/// `rename_all = "camelCase"` 处理 `executionId`；`task_id` 按协议保持 snake_case，
/// 故单独覆盖 —— 两个字段拼法不同是实测协议的一部分，不是疏忽。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WirePayload {
    execution_id: String,
    #[serde(rename = "task_id")]
    task_id: String,
    status: SentinelStatus,
    #[serde(default)]
    summary: Option<String>,
}

/// 流式扫描器：有界 carry + 逐行匹配。
#[derive(Debug, Default)]
pub struct SentinelScanner {
    /// 尚未遇到 `\n` 的那一行的字节（长度恒 ≤ [`MAX_LINE_BYTES`]）。
    carry: Vec<u8>,
    /// 当前行已超单行上限 ⇒ 内容已被丢弃，行结束时不产出任何结果。
    overflowed: bool,
}

impl SentinelScanner {
    /// 新建扫描器（每个 pane 一个）。
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// 当前 carry 长度（有界性断言用；生产不消费）。
    #[must_use]
    pub const fn carry_len(&self) -> usize {
        self.carry.len()
    }

    /// 喂一段原始 PTY 字节，返回本次能确认的命中（0 条或多条，顺序与输入一致）。
    ///
    /// **只在 `\n` 处切行**（终端软换行不进字节流，进来的都是 agent 自己打的硬换行）；
    /// 未结束的尾巴留在 carry，等下一次 `feed` 拼回来。
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<SentinelHit> {
        let mut hits = Vec::new();
        let mut rest = bytes;
        while let Some(pos) = rest.iter().position(|byte| *byte == b'\n') {
            self.push(&rest[..pos]);
            self.take_line(&mut hits);
            rest = &rest[pos + 1..];
        }
        // 尾巴（本帧没有换行）：只累积，不解析。
        self.push(rest);
        hits
    }

    /// 有界累积：超单行上限即**立刻丢弃**已累积字节，只留一个标记。
    ///
    /// 这里刻意不做「先攒着，遇到 `\n` 再判」—— 那正是 5.2 GB 事故的形状
    /// （红线 4 / research/03 P4）。carry 因此恒 ≤ [`MAX_LINE_BYTES`] < [`MAX_CARRY_BYTES`]。
    fn push(&mut self, chunk: &[u8]) {
        if chunk.is_empty() || self.overflowed {
            return;
        }
        if self.carry.len() + chunk.len() > MAX_LINE_BYTES {
            self.carry = Vec::new();
            self.overflowed = true;
            return;
        }
        self.carry.extend_from_slice(chunk);
    }

    /// 一行结束：处理并清空 carry（无论是否命中）。
    fn take_line(&mut self, hits: &mut Vec<SentinelHit>) {
        let overflowed = std::mem::take(&mut self.overflowed);
        if !overflowed && !self.carry.is_empty() {
            if let Some(hit) = parse_line(&self.carry) {
                hits.push(hit);
            }
        }
        // 保留容量复用（pump 每 16ms 一次，不为每行分配）。
        self.carry.clear();
    }
}

/// 解析一整行（**不含 `\n`**）；不是 sentinel → `None`（静默丢弃，绝不报错）。
fn parse_line(line: &[u8]) -> Option<SentinelHit> {
    // 快路径：绝大多数输出行既不含 `NEEKO` 也不含 ESC —— 连正则都不跑。
    //
    // 判据是**充分**的：`strip_ansi` 只删转义序列，剩下的字符是原字节的子序列，
    // 所以「剥完能出现 `NEEKO_RESULT `」⟹ 原字节里含 `NEEKO`，或含某个把 `NEEKO` 切开的 ESC。
    if !line.windows(5).any(|window| window == b"NEEKO") && !line.contains(&0x1b) {
        return None;
    }

    // `\r`（CRLF 的行尾、TUI 回退覆盖行首）不承载 JSON 语义；颜色码可能插在 JSON 中间。
    let Ok(raw) = std::str::from_utf8(line) else {
        // 非法 UTF-8（被硬件序列/二进制噪声污染的行）→ 丢该行，不 panic。
        return None;
    };
    let text = strip_ansi(&raw.replace('\r', ""));

    let start = text.find(SENTINEL_PREFIX)?;
    let rest = &text[start + SENTINEL_PREFIX.len()..];
    let (nonce, json) = rest.split_once(' ')?;
    let nonce = nonce.trim();
    if nonce.is_empty() {
        return None;
    }

    let wire: WirePayload = serde_json::from_str(json.trim()).ok()?;
    let execution_id = wire.execution_id.trim();
    let task_id = wire.task_id.trim();
    // 空身份没有意义（`task_id` 为空的行永远过不了 TeamManager 的 owner 校验，提前丢）。
    if execution_id.is_empty() || task_id.is_empty() {
        return None;
    }
    Some(SentinelHit {
        nonce: nonce.to_owned(),
        payload: SentinelPayload {
            execution_id: execution_id.to_owned(),
            task_id: task_id.to_owned(),
            status: wire.status,
            summary: wire.summary,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造一条合法 sentinel 行（带 `\n`）。
    fn line(nonce: &str, json: &str) -> Vec<u8> {
        format!("{SENTINEL_PREFIX}{nonce} {json}\n").into_bytes()
    }

    /// ① 分片到达：一条 sentinel 跨两次 `feed` —— 第二次必须能拼回。
    ///
    /// 保护「pump 按 16ms 合流，一条 sentinel 必然跨帧」（research/03 P4）。
    #[test]
    fn hit_split_across_two_feeds_is_reassembled() {
        let mut scanner = SentinelScanner::new();
        let full = line(
            "n1",
            r#"{"executionId":"e1","task_id":"t1","status":"completed","summary":"ok"}"#,
        );
        let (head, tail) = full.split_at(12);

        assert!(scanner.feed(head).is_empty(), "半截行不得命中");
        let hits = scanner.feed(tail);
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(hits[0].nonce, "n1");
        assert_eq!(
            hits[0].payload,
            SentinelPayload {
                execution_id: "e1".into(),
                task_id: "t1".into(),
                status: SentinelStatus::Completed,
                summary: Some("ok".into()),
            }
        );
    }

    /// ② 颜色码插在 JSON 中间 + 行内 `\r`（TUI 回退覆盖）→ 仍须命中。
    ///
    /// 保护「剥 ANSI 后匹配」（research/03 P3）；`\r` 不承载 JSON 语义，整行先剔除。
    #[test]
    fn ansi_and_carriage_return_inside_json_still_match() {
        let mut scanner = SentinelScanner::new();
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"NEEKO_RESULT n2 {\"sta\r\x1b[32m");
        bytes.extend_from_slice(b"tus\":\"completed\",\"executionId\":\"e2\",");
        bytes.extend_from_slice(b"\"task_id\":\"t1\"}\n");
        let hits = scanner.feed(&bytes);
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(hits[0].payload.status, SentinelStatus::Completed);
        assert_eq!(hits[0].payload.execution_id, "e2");
        assert_eq!(hits[0].payload.summary, None);
    }

    /// ③ 超过单行上限的行整行丢弃，且扫描器**不因此失效**、carry 恒有界。
    ///
    /// 保护红线 4 / research/03 P4：绝不无界累积（历史事故 5.2 GB）。
    #[test]
    fn over_long_line_is_dropped_and_carry_stays_bounded() {
        let mut scanner = SentinelScanner::new();
        // 一条 64 KiB 的「无换行」垃圾（远超 2 KiB 单行上限与 8 KiB carry 上限）
        let junk = vec![b'x'; 64 * 1024];
        assert!(scanner.feed(&junk).is_empty());
        assert!(
            scanner.carry_len() <= MAX_LINE_BYTES,
            "carry 必须有界，实际 {}",
            scanner.carry_len()
        );
        assert!(scanner.carry_len() <= MAX_CARRY_BYTES);
        assert!(scanner.overflowed, "超限行必须被标记为丢弃");

        // 该行以 `\n` 结束后不得产出任何结果
        assert!(scanner.feed(b"\n").is_empty());

        // 后续正常行仍能被识别（扫描器没有被毒住）
        let hits = scanner.feed(&line(
            "n3",
            r#"{"executionId":"e3","task_id":"t1","status":"failed"}"#,
        ));
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(hits[0].payload.status, SentinelStatus::Failed);
    }

    /// ④ 非法 `status` / 缺字段 → 静默丢弃该行，不 panic、不兜底成 `completed`。
    ///
    /// 保护「解析失败静默丢弃」（回显的任务模板会天天出现）与「非法 status 不兜底」。
    #[test]
    fn invalid_payload_is_dropped_silently() {
        let mut scanner = SentinelScanner::new();
        // 非法 status（大小写/词表外都算非法）
        assert!(scanner
            .feed(&line(
                "n4",
                r#"{"executionId":"e4","task_id":"t1","status":"DONE"}"#
            ))
            .is_empty());
        // 缺 executionId
        assert!(scanner
            .feed(&line("n5", r#"{"task_id":"t1","status":"completed"}"#))
            .is_empty());
        // 缺 task_id
        assert!(scanner
            .feed(&line("n6", r#"{"executionId":"e6","status":"completed"}"#))
            .is_empty());
        // 空 task_id（存在但无意义 —— 状态校验永远过不了，提前丢）
        assert!(scanner
            .feed(&line(
                "n7",
                r#"{"executionId":"e7","task_id":"  ","status":"completed"}"#
            ))
            .is_empty());
        // 完全不是 JSON
        assert!(scanner.feed(&line("n8", "not-json")).is_empty());
        // 截断的 JSON（回显被 TUI 折行切断）
        assert!(scanner
            .feed(&line("n9", r#"{"executionId":"e9","task_"#))
            .is_empty());
        // 非法 UTF-8 行不 panic
        let mut raw = b"NEEKO_RESULT n10 {".to_vec();
        raw.extend_from_slice(&[0xff, 0xfe]);
        raw.push(b'\n');
        assert!(scanner.feed(&raw).is_empty());
    }

    /// ⑤ 一次 `feed` 里两条 sentinel → 返回 2 条，顺序与输入一致。
    ///
    /// 保护「一次 flush 可能含多行」（pump 合流窗口内 agent 连打两行）。
    #[test]
    fn two_sentinels_in_one_feed_keep_order() {
        let mut scanner = SentinelScanner::new();
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&line(
            "first",
            r#"{"executionId":"e1","task_id":"t1","status":"completed"}"#,
        ));
        bytes.extend_from_slice("普通输出，中间夹一行\n".as_bytes());
        bytes.extend_from_slice(&line(
            "second",
            r#"{"executionId":"e2","task_id":"t2","status":"blocked"}"#,
        ));
        let hits = scanner.feed(&bytes);
        assert_eq!(hits.len(), 2, "{hits:?}");
        assert_eq!(hits[0].nonce, "first");
        assert_eq!(hits[1].nonce, "second");
        assert_eq!(hits[1].payload.status, SentinelStatus::Blocked);
    }

    /// `\r\n` 行尾必须能处理（Windows 成员 / 某些 CLI 的 CRLF 输出）。
    #[test]
    fn crlf_line_endings_are_handled() {
        let mut scanner = SentinelScanner::new();
        let mut bytes =
            format!("{SENTINEL_PREFIX}n11 {{\"executionId\":\"e11\",\"task_id\":\"t1\",\"status\":\"completed\"}}")
                .into_bytes();
        bytes.extend_from_slice(b"\r\n");
        let hits = scanner.feed(&bytes);
        assert_eq!(hits.len(), 1, "{hits:?}");
        assert_eq!(hits[0].nonce, "n11");
        assert!(scanner.carry_len() <= MAX_LINE_BYTES);
    }

    /// 普通带颜色的输出（无 sentinel）→ 0 条，且不因 ESC 误判。
    ///
    /// 保护「不要为了匹配 sentinel 而误伤正常输出」；同时覆盖 ANSI 快路径分支。
    #[test]
    fn colored_plain_output_yields_nothing() {
        let mut scanner = SentinelScanner::new();
        let hits = scanner.feed(b"\x1b[32mPASS\x1b[0m src/main.rs\n\x1b[0m\n");
        assert!(hits.is_empty(), "{hits:?}");
        assert_eq!(scanner.carry_len(), 0);
    }

    /// 同族词不得误匹配（前缀只有带尾随空格才算 sentinel）。
    #[test]
    fn lookalike_prefix_is_not_a_sentinel() {
        let mut scanner = SentinelScanner::new();
        assert!(scanner
            .feed(b"NEEKO_RESULT_X n12 {\"executionId\":\"e\",\"task_id\":\"t\",\"status\":\"completed\"}\n")
            .is_empty());
        assert!(scanner.feed(b"NEEKO_RESULT\n").is_empty());
    }

    /// 单行上限的**边界**：恰好 2 KiB 可过，多一个字节就整行丢。
    ///
    /// 保护「上限是含的」：如果实现里写成 `>=`，正好卡在上限的真实载荷会被静默吃掉。
    #[test]
    fn line_exactly_at_the_limit_is_accepted_and_one_byte_more_is_dropped() {
        let nonce = "nn";
        let head = r#"{"executionId":"e","task_id":"t","status":"completed","summary":""#;
        let tail = r#""}"#;
        let fixed = SENTINEL_PREFIX.len() + nonce.len() + 1 + head.len() + tail.len();
        let pad = MAX_LINE_BYTES - fixed;

        let exact = format!("{SENTINEL_PREFIX}{nonce} {head}{}{tail}\n", "a".repeat(pad));
        let line_bytes = exact.trim_end_matches('\n').len();
        assert_eq!(line_bytes, MAX_LINE_BYTES, "夹具必须恰好卡在上限");
        let mut scanner = SentinelScanner::new();
        assert_eq!(scanner.feed(exact.as_bytes()).len(), 1);

        let over = format!(
            "{SENTINEL_PREFIX}{nonce} {head}{}{tail}\n",
            "a".repeat(pad + 1)
        );
        assert!(scanner.feed(over.as_bytes()).is_empty());
    }

    /// carry 上限与单行上限的关系是**硬约束**（改任一个都必须重新审视 5.2 GB 事故）。
    ///
    /// 用 `const` 断言而不是运行时断言：两者都是常量，编译期就该拦下来。
    #[test]
    fn carry_budget_is_larger_than_the_line_budget() {
        const _: () = assert!(MAX_LINE_BYTES < MAX_CARRY_BYTES);
        const _: () = assert!(MAX_LINE_BYTES == 2 * 1024);
        const _: () = assert!(MAX_CARRY_BYTES == 8 * 1024);
    }
}
