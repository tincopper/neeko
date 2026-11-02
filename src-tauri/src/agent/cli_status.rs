//! CLI 在终端流里**自报状态**的契约（OSC 状态播报）。
//!
//! # 为什么需要这一层
//!
//! 侧栏要画会话状态点，能用的原生事实只有三种，质量从高到低：
//!
//! 1. **CLI 自己宣告**（本模块）：字节流里的状态协议，逐次状态转换都明确；
//! 2. CLI hook（`live_sessions::wiring::hooks`）：权威，但要求 hook 装好且能**精确归因**
//!    （`NEEKO_SESSION_ID` 必须真的出现在 hook 进程的 env 里 —— Codex 这类
//!    「TUI 只是 app-server 的客户端」的架构里，hook 由 daemon 拉起，env 不成立）；
//! 3. 字节静默推断（`wiring::pty::IDLE_AFTER`）：最弱，且**会被 TUI 重绘骗到** ——
//!    Codex 完成后仍会周期性重绘（光标 / 状态行），静默永远达不到阈值，于是「任务已结束」
//!    却一直显示绿色运行中（2026-11-02 真机反馈）。
//!
//! 所以只要有第 1 级事实，就不该继续用第 3 级猜。
//!
//! # 实测契约（Codex 0.166.0，`script` 起的真实 TUI，非 `exec`）
//!
//! ```text
//! 启动           ESC ] 7501 ; state=idle:app=codex    ESC \
//! 开始一轮        ESC ] 7501 ; state=working:app=codex ESC \
//! 一轮结束        ESC ] 7501 ; state=idle:app=codex    ESC \
//! ```
//!
//! 同一份输出里还有 `ESC ] 0 ; ⠋ codexprobe BEL`（标题 + spinner）与 OSC 10/11 查询。
//! 标题不参与命名（它只是状态栏，见 spec「OSC 0/2 不是标题来源」），**状态也只认 7501**：
//! 那是结构化字段（`key=value:key=value`），不是给人看的字符串。
//!
//! # 数据，而不是分支（红线 15 的同一条原则）
//!
//! 「哪个 CLI 用哪个 OSC 号、哪些取值算在跑」是**每个 CLI 的事实**，落在 [`CHANNELS`] 表里。
//! 解析器（[`StatusScanner`]）不认识任何具体 CLI —— 新增 CLI = 加一行数据 + 一个用例。

/// CLI 自报的一档状态（只区分「在算」与「在等」，与 `SessionState` 的粒度对齐）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CliStatus {
    /// 正在处理（轮次进行中）⇒ `TurnStarted`。
    Working,
    /// 空闲 / 轮次结束 ⇒ `TurnFinished`。
    Idle,
}

/// 一个 CLI 的状态播报通道声明。
#[derive(Debug, Clone, Copy)]
pub struct StatusChannel {
    /// 该声明属于哪个 agent（与 `AgentConfig::id` 同源，也是注册表里的 `agent_id`）。
    pub agent_id: &'static str,
    /// OSC 编号（`ESC ] <n> ; <payload> <terminator>`）。
    pub osc: u16,
    /// 判定为 [`CliStatus::Working`] 的载荷前缀。
    pub working: &'static str,
    /// 判定为 [`CliStatus::Idle`] 的载荷前缀。
    pub idle: &'static str,
}

/// 已知的状态播报通道（新增 CLI：加一行；解析器不改）。
pub static CHANNELS: &[StatusChannel] = &[StatusChannel {
    agent_id: "codex",
    osc: 7501,
    working: "state=working",
    idle: "state=idle",
}];

/// 按 agent id 找通道（未知 / `None` ⇒ 该会话没有状态播报，退回静默推断）。
#[must_use]
pub fn channel_for(agent_id: Option<&str>) -> Option<&'static StatusChannel> {
    let id = agent_id?;
    CHANNELS.iter().find(|channel| channel.agent_id == id)
}

impl StatusChannel {
    /// 载荷 → 状态（前缀匹配 = 允许 `:app=codex` 这类附加字段，且不依赖字段顺序之外的东西）。
    #[must_use]
    fn classify(self, payload: &[u8]) -> Option<CliStatus> {
        if payload.starts_with(self.working.as_bytes()) {
            return Some(CliStatus::Working);
        }
        if payload.starts_with(self.idle.as_bytes()) {
            return Some(CliStatus::Idle);
        }
        None
    }
}

/// 载荷缓冲上限：协议只发短 KV 串，超出即视为垃圾并重置（防病态流把内存撑大）。
const MAX_PAYLOAD: usize = 96;

/// OSC 解析状态机。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// 普通字节。
    Ground,
    /// 刚读到 `ESC`。
    Escape,
    /// `ESC ]` 之后、分号之前的编号位。
    Number,
    /// 编号匹配，正在收载荷。
    Payload,
    /// 载荷里的 `ESC`：下一字节是 `\` 才是 ST 终止符。
    PayloadEscape,
    /// 不关心的序列：吞到自己终止符为止。
    Skip,
}

/// 流式 OSC 扫描器：把任意分块的终端输出喂进来，吐出**最后一次**状态转换。
///
/// 跨 chunk 由状态机自然处理（不缓存原始字节）；一个 chunk 里出现多次转换时返回最后
/// 一次 —— 状态是收敛的，中间态没人要。
#[derive(Debug)]
pub struct StatusScanner {
    channel: &'static StatusChannel,
    phase: Phase,
    number: u16,
    payload: Vec<u8>,
}

impl StatusScanner {
    /// 按通道声明建立一个扫描器（每个会话一个，跨 chunk 保留状态）。
    #[must_use]
    pub const fn new(channel: &'static StatusChannel) -> Self {
        Self {
            channel,
            phase: Phase::Ground,
            number: 0,
            payload: Vec::new(),
        }
    }

    /// 喂入一块输出；返回本块解析到的**最后**一次状态（没有则 `None`）。
    pub fn feed(&mut self, bytes: &[u8]) -> Option<CliStatus> {
        let mut last = None;
        for &byte in bytes {
            match self.phase {
                Phase::Ground => {
                    if byte == 0x1b {
                        self.phase = Phase::Escape;
                    }
                }
                Phase::Escape => match byte {
                    b']' => {
                        self.phase = Phase::Number;
                        self.number = 0;
                    }
                    // `ESC ESC ]`（少见）时保留第二次 ESC 的机会；其余两字节序列不关心。
                    0x1b => {}
                    _ => self.phase = Phase::Ground,
                },
                Phase::Number => match byte {
                    b'0'..=b'9' => {
                        // 编号位数超限 ⇒ 必然不是我们要的序列（防整数溢出 / 垃圾流）。
                        self.number = self
                            .number
                            .checked_mul(10)
                            .and_then(|n| n.checked_add(u16::from(byte - b'0')))
                            .unwrap_or(u16::MAX);
                        if self.number > self.channel.osc {
                            self.phase = Phase::Skip;
                        }
                    }
                    b';' if self.number == self.channel.osc => {
                        self.payload.clear();
                        self.phase = Phase::Payload;
                    }
                    _ => self.phase = Phase::Skip,
                },
                Phase::Payload => {
                    if byte == 0x07 {
                        // BEL 终止符。
                        last = self.channel.classify(&self.payload).or(last);
                        self.phase = Phase::Ground;
                    } else if byte == 0x1b {
                        // 可能是 ST（`ESC \`），交给下一字节裁决。
                        self.phase = Phase::PayloadEscape;
                    } else if self.payload.len() >= MAX_PAYLOAD {
                        self.phase = Phase::Skip;
                    } else {
                        self.payload.push(byte);
                    }
                }
                Phase::PayloadEscape => {
                    if byte == b'\\' {
                        last = self.channel.classify(&self.payload).or(last);
                    }
                    // 无论是 ST 还是被截断的序列，都回到普通状态；截断的那份不结算。
                    self.phase = Phase::Ground;
                }
                Phase::Skip => {
                    if byte == 0x07 || byte == 0x5c {
                        // BEL / `\`（ST 的第二个字节）都收尾。
                        self.phase = Phase::Ground;
                    } else if byte == 0x1b {
                        self.phase = Phase::Escape;
                    }
                }
            }
        }
        last
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codex() -> &'static StatusChannel {
        channel_for(Some("codex")).expect("codex 声明存在")
    }

    /// 实测字节形态（`script` 起的真实 TUI 抓到的原文）。
    const WORKING: &[u8] = b"\x1b]7501;state=working:app=codex\x1b\\";
    const IDLE: &[u8] = b"\x1b]7501;state=idle:app=codex\x1b\\";

    #[test]
    fn unknown_agents_have_no_channel() {
        assert!(channel_for(None).is_none());
        assert!(channel_for(Some("pi")).is_none());
        assert!(channel_for(Some("claude-code")).is_none());
        assert_eq!(codex().osc, 7501);
    }

    #[test]
    fn st_terminated_status_is_read() {
        let mut scanner = StatusScanner::new(codex());
        assert_eq!(scanner.feed(WORKING), Some(CliStatus::Working));
        assert_eq!(scanner.feed(IDLE), Some(CliStatus::Idle));
    }

    #[test]
    fn bel_terminated_status_is_read_too() {
        let mut scanner = StatusScanner::new(codex());
        assert_eq!(
            scanner.feed(b"\x1b]7501;state=idle:app=codex\x07"),
            Some(CliStatus::Idle)
        );
    }

    /// 输出按任意边界分块到达（PTY 与 SSH 都可能切断序列中间）。
    #[test]
    fn sequences_split_across_chunks_still_parse() {
        let mut scanner = StatusScanner::new(codex());
        let mut seen = None;
        for byte in WORKING {
            seen = scanner.feed(std::slice::from_ref(byte)).or(seen);
        }
        assert_eq!(seen, Some(CliStatus::Working), "逐字节喂入也要认出来");

        let mut scanner = StatusScanner::new(codex());
        assert_eq!(scanner.feed(&WORKING[..5]), None);
        assert_eq!(scanner.feed(&WORKING[5..]), Some(CliStatus::Working));
    }

    /// 一块里多次转换 ⇒ 只要最后一次（状态收敛，中间态没人要）。
    #[test]
    fn the_last_transition_in_a_chunk_wins() {
        let mut scanner = StatusScanner::new(codex());
        let mut bytes = Vec::new();
        bytes.extend_from_slice(WORKING);
        bytes.extend_from_slice(b"\x1b]0;\xe2\xa0\x8b codex\x07"); // 标题 + spinner 插入
        bytes.extend_from_slice(IDLE);
        assert_eq!(scanner.feed(&bytes), Some(CliStatus::Idle));
    }

    /// 别的 OSC（标题 / 前景色查询）不得被误认。
    #[test]
    fn other_osc_sequences_are_ignored() {
        let mut scanner = StatusScanner::new(codex());
        assert_eq!(
            scanner.feed(b"\x1b]0;codex\x07\x1b]10;rgb:3838/3a3a/4242\x1b\\"),
            None
        );
        // 干扰之后仍能正常解析。
        assert_eq!(scanner.feed(IDLE), Some(CliStatus::Idle));
    }

    /// 未知取值（未来版本新增档位）⇒ 忽略，不要瞎猜成 Working / Idle。
    #[test]
    fn unknown_values_are_ignored() {
        let mut scanner = StatusScanner::new(codex());
        assert_eq!(
            scanner.feed(b"\x1b]7501;state=awaiting-approval:app=codex\x1b\\"),
            None
        );
    }

    /// 病态流（永不终止的长载荷）不得无限增长内存。
    #[test]
    fn oversized_payload_is_dropped() {
        let mut scanner = StatusScanner::new(codex());
        let mut bytes = b"\x1b]7501;state=working".to_vec();
        bytes.extend(std::iter::repeat_n(b'x', MAX_PAYLOAD * 4));
        assert_eq!(scanner.feed(&bytes), None);
        // 之后仍能恢复（状态机回到 Ground）。
        assert_eq!(scanner.feed(b"\x07"), None);
        assert_eq!(scanner.feed(IDLE), Some(CliStatus::Idle));
    }

    /// ST 的第一个字节到达后如果不是 `\`，序列只是被截断，不能当作完成。
    #[test]
    fn truncated_sequence_is_not_a_transition() {
        let mut scanner = StatusScanner::new(codex());
        assert_eq!(scanner.feed(b"\x1b]7501;state=working\x1b"), None);
        assert_eq!(scanner.feed(b"x"), None);
        assert_eq!(scanner.feed(IDLE), Some(CliStatus::Idle), "之后照常工作");
    }
}
