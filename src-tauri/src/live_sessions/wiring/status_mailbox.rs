//! 把「逐字节的事实」收敛成一档 CLI 自报状态，并跨线程移交给状态消费者。
//!
//! # 为什么不在 `agent::cli_status`
//!
//! 那是**契约**层：数据表（`CHANNELS`）+ 解析器（`StatusScanner`），零线程、零共享状态，
//! 可以脱离运行时直测。信箱是**运行时编排**（写侧扫描、读侧无锁发布），而且只有本域
//! （终端活动探针 `OutputActivity`）消费它 —— 把它放在契约层会让「解析器不认识线程」
//! 这条性质失效。
//!
//! # 跨线程边界
//!
//! 写侧（PTY reader / SSH io 线程）只调 `feed`，读侧（watcher tick）只调
//! `take_pending` / `has_reported`；两侧没有共享的可变引用，也没有跨 `await` 的锁。

use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Mutex;

use crate::agent::cli_status::{CliStatus, StatusChannel, StatusScanner};

/// 跨线程的自报状态信箱：**输出线程喂字节，状态消费者取结果**。
///
/// # 为什么不是「把扫描器塞进活动探针的锁里」
///
/// 扫描器只有一个写者（读 PTY / SSH 的那个线程），消费者要的只是**最后一档**状态。
/// 把两件事拆开之后：
///
/// - 写侧：扫描器仍在锁内（只有它自己取，永不竞争），扫描结果发布到原子量；
/// - 读侧：**完全无锁**（`take_pending` / `has_reported` 只读原子量）。
///
/// 消费者每 100–250ms 取一次，写侧每个字节块喂一次 —— 把这两条路径塞进同一把锁，
/// 是让读侧替写侧的私有状态付锁钱。
pub(crate) struct StatusMailbox {
    scanner: Mutex<StatusScanner>,
    /// 最近一次自报（sticky）：用于「CLI 已经在自报 ⇒ 停用字节静默推断」。
    last: AtomicU8,
    /// 还没被取走的那一档（`take_pending` 清零）。
    pending: AtomicU8,
}

/// 原子量里的编码（`0` = 没有状态）。
const NO_STATUS: u8 = 0;

const fn encode(status: CliStatus) -> u8 {
    match status {
        CliStatus::Working => 1,
        CliStatus::Idle => 2,
    }
}

const fn decode(code: u8) -> Option<CliStatus> {
    match code {
        1 => Some(CliStatus::Working),
        2 => Some(CliStatus::Idle),
        _ => None,
    }
}

impl StatusMailbox {
    /// 按通道声明建信箱（每个会话一个，跨块保留扫描状态）。
    #[must_use]
    pub(crate) const fn new(channel: &'static StatusChannel) -> Self {
        Self {
            scanner: Mutex::new(StatusScanner::new(channel)),
            last: AtomicU8::new(NO_STATUS),
            pending: AtomicU8::new(NO_STATUS),
        }
    }

    /// 喂入一块输出（由输出线程调用；只发布**最后一次**转换）。
    pub(crate) fn feed(&self, bytes: &[u8]) {
        let Ok(mut scanner) = self.scanner.lock() else {
            return;
        };
        let Some(status) = scanner.feed(bytes) else {
            return;
        };
        let code = encode(status);
        // 先写 pending 再写 last：消费者看到 `has_reported` 时那一档一定可取。
        self.pending.store(code, Ordering::Release);
        self.last.store(code, Ordering::Release);
    }

    /// 取走待应用的那一档（没有 ⇒ `None`）。
    pub(crate) fn take_pending(&self) -> Option<CliStatus> {
        decode(self.pending.swap(NO_STATUS, Ordering::AcqRel))
    }

    /// 这条会话是否**出现过**自报（sticky，取走 pending 也不会退回 `false`）。
    #[must_use]
    pub(crate) fn has_reported(&self) -> bool {
        self.last.load(Ordering::Acquire) != NO_STATUS
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codex() -> &'static StatusChannel {
        crate::agent::cli_status::channel_for(Some("codex")).expect("codex 声明存在")
    }

    /// 实测字节形态（`script` 起的真实 TUI 抓到的原文）。
    const WORKING: &[u8] = b"\x1b]7501;state=working:app=codex\x1b\\";
    const IDLE: &[u8] = b"\x1b]7501;state=idle:app=codex\x1b\\";

    // ── 信箱：一次性移交 / sticky / 只认已知状态 ────────────────────────────

    /// 取走即清空：同一档状态只被应用一次。
    ///
    /// 不清的话，消费者的 tick（100–250ms）会反复重放同一次转换，`Ready` 被一直
    /// "重新确认"，任何后续判定都失去意义。
    #[test]
    fn mailbox_hands_each_transition_out_once() {
        let mailbox = StatusMailbox::new(codex());
        mailbox.feed(WORKING);
        assert_eq!(mailbox.take_pending(), Some(CliStatus::Working));
        assert_eq!(mailbox.take_pending(), None, "取走之后不再重复给出");

        mailbox.feed(IDLE);
        assert_eq!(mailbox.take_pending(), Some(CliStatus::Idle));
    }

    /// `has_reported` 是 sticky：取走 pending 不会让它退回 `false`。
    ///
    /// 它回答的是「这条会话有没有自报通道在用」，而不是「有没有待应用项」——
    /// 退化之后，字节静默推断会在下一次 tick 重新接管（旧 bug 复发）。
    #[test]
    fn mailbox_reported_flag_is_sticky() {
        let mailbox = StatusMailbox::new(codex());
        assert!(!mailbox.has_reported());

        mailbox.feed(WORKING);
        assert!(mailbox.has_reported());
        let _ = mailbox.take_pending();
        assert!(mailbox.has_reported(), "取走待应用项不等于没自报过");
    }

    /// 未知取值 / 无OSC 不算自报：一次无关的序列不得让静默推断永久失效。
    #[test]
    fn mailbox_only_counts_known_states_as_reported() {
        let mailbox = StatusMailbox::new(codex());
        mailbox.feed(b"\x1b]7501;state=awaiting-approval:app=codex\x1b\\");
        mailbox.feed(b"\x1b]0;codex\x07");
        assert_eq!(mailbox.take_pending(), None);
        assert!(!mailbox.has_reported());
    }
}
