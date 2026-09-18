//! Session lifecycle: the single source of truth for "what state is this session in".

use std::sync::atomic::{AtomicU8, Ordering};

use super::status::LspSessionStatus;

// 相位常量：非终态按"推进顺序"取值，终态值域高于所有非终态（`current < CLOSED`
// 即"仍在可推进区间"，这是 set / 崩溃判定共用的一条判据）。
const STARTING: u8 = 0;
const INITIALIZING: u8 = 1;
const READY: u8 = 2;
const CLOSED: u8 = 3;
const CRASHED: u8 = 4;

/// 会话生命周期的唯一真相。
///
/// 第一性原理：一个会话是否还能用，只能有**一个**事实来源。此前的表示有三份且
/// 互相补偿——`LspSession.status` 是构造期写入后永不更新的字段（永远 `Ready`）、
/// `closing: AtomicBool` 是并行的第二套判定、`snapshot()` 只能靠轮询
/// `JoinHandle::is_finished()` 反推真相。三份表示无法区分两种"reader 已结束"：
/// 优雅关闭（Neeko 主动 kill）与进程崩溃（子进程提前退出），于是"关闭后闪错误"
/// 只能靠人工保证顺序来回避。
///
/// 收敛后：reader 线程与关闭路径是**写者**，快照 / 存活判定 / 事件发射是**读者**。
#[derive(Debug)]
pub(crate) struct Lifecycle(AtomicU8);

impl Lifecycle {
    pub(crate) const fn new() -> Self {
        Self(AtomicU8::new(STARTING))
    }

    /// 推进到给定状态对应的相位。终态是吸收态（关闭 / 崩溃后不再复活）。
    ///
    /// `LspSessionStatus::Indexing` 是**前端派生**的展示态（由 work-done 进度 token
    /// 合成），服务端不存在该相位，故归一为 `Ready`（会话确实可用）。
    pub(crate) fn set(&self, status: &LspSessionStatus) {
        let target = phase_of(status);
        let mut current = self.0.load(Ordering::SeqCst);
        while current < CLOSED {
            match self
                .0
                .compare_exchange(current, target, Ordering::SeqCst, Ordering::SeqCst)
            {
                Ok(_) => return,
                Err(actual) => current = actual,
            }
        }
    }

    /// Neeko 主动关闭。返回是否为**首次**进入关闭态——调用方据此保证 `stopped`
    /// 只发一次（幂等由状态机给出，而不是靠调用方记住）。
    pub(crate) fn close(&self) -> bool {
        self.0.swap(CLOSED, Ordering::SeqCst) != CLOSED
    }

    /// reader 线程退出。返回是否为**首次**判定为崩溃。
    ///
    /// 非优雅关闭（子进程提前退出）才算崩溃；已关闭会话静默退出，且绝不会被
    /// 覆盖成崩溃态。已判定过崩溃时返回 `false` —— 重复退出不得重复发 `error`
    /// （否则前端会收到重复的重试提示）。
    pub(crate) fn on_reader_exit(&self) -> bool {
        let mut current = self.0.load(Ordering::SeqCst);
        loop {
            match current {
                CLOSED | CRASHED => return false,
                _ => match self.0.compare_exchange(
                    current,
                    CRASHED,
                    Ordering::SeqCst,
                    Ordering::SeqCst,
                ) {
                    Ok(_) => return true,
                    Err(actual) => current = actual,
                },
            }
        }
    }

    /// 是否已进入终态（关闭或崩溃）——会话不再可能提供任何能力。
    pub(crate) fn is_terminal(&self) -> bool {
        self.0.load(Ordering::SeqCst) >= CLOSED
    }

    /// 快照用的状态视图。
    ///
    /// 崩溃态的 message 由 [`crash_message`] 重建（不是调用方传入的字符串）：
    /// reader 崩溃事件与 `list_sessions` 快照共用同一文案，杜绝两处漂移。
    pub(crate) fn status(&self, server_name: &str) -> LspSessionStatus {
        match self.0.load(Ordering::SeqCst) {
            CLOSED => LspSessionStatus::Stopped,
            CRASHED => LspSessionStatus::Error(crash_message(server_name)),
            INITIALIZING => LspSessionStatus::Initializing,
            READY => LspSessionStatus::Ready,
            _ => LspSessionStatus::Starting,
        }
    }
}

impl Default for Lifecycle {
    fn default() -> Self {
        Self::new()
    }
}

const fn phase_of(status: &LspSessionStatus) -> u8 {
    match status {
        LspSessionStatus::Starting => STARTING,
        LspSessionStatus::Initializing => INITIALIZING,
        LspSessionStatus::Indexing | LspSessionStatus::Ready => READY,
        LspSessionStatus::Error(_) => CRASHED,
        LspSessionStatus::Stopped => CLOSED,
    }
}

/// 服务器意外退出的统一文案。reader 崩溃事件与快照派生共用（单一事实源）。
pub(crate) fn crash_message(server_name: &str) -> String {
    format!("{server_name} exited unexpectedly")
}

#[cfg(test)]
mod tests {
    use super::*;

    const NAME: &str = "gopls";

    /// 相位推进：starting → initializing → ready 各阶段如实映射。
    #[test]
    fn phases_advance_from_starting_to_ready() {
        let lifecycle = Lifecycle::new();
        assert_eq!(lifecycle.status(NAME), LspSessionStatus::Starting);
        assert!(!lifecycle.is_terminal());

        lifecycle.set(&LspSessionStatus::Initializing);
        assert_eq!(lifecycle.status(NAME), LspSessionStatus::Initializing);

        lifecycle.set(&LspSessionStatus::Ready);
        assert_eq!(lifecycle.status(NAME), LspSessionStatus::Ready);
        assert!(!lifecycle.is_terminal());
    }

    /// close 幂等：只有首次进入关闭态返回 true（调用方据此保证 stopped 只发一次）。
    #[test]
    fn close_reports_first_entry_only() {
        let lifecycle = Lifecycle::new();
        lifecycle.set(&LspSessionStatus::Ready);

        assert!(lifecycle.close(), "首次关闭必须返回 true");
        assert!(
            !lifecycle.close(),
            "重复关闭不得再返回 true（否则重复发 stopped）"
        );
        assert!(lifecycle.is_terminal());
        assert_eq!(lifecycle.status(NAME), LspSessionStatus::Stopped);
    }

    /// 优雅关闭后 reader 退出必须静默：不得把 Stopped 覆盖成 Error。
    #[test]
    fn reader_exit_after_close_is_silent() {
        let lifecycle = Lifecycle::new();
        lifecycle.set(&LspSessionStatus::Ready);
        lifecycle.close();

        assert!(
            !lifecycle.on_reader_exit(),
            "已关闭会话的 reader 退出不算崩溃"
        );
        assert_eq!(
            lifecycle.status(NAME),
            LspSessionStatus::Stopped,
            "崩溃判定不得覆盖优雅关闭的终态"
        );
    }

    /// 运行中 reader 退出 = 崩溃，且只报一次（重复退出不得重复发 error）。
    #[test]
    fn reader_exit_while_running_reports_crash_once() {
        let lifecycle = Lifecycle::new();
        lifecycle.set(&LspSessionStatus::Ready);

        assert!(
            lifecycle.on_reader_exit(),
            "非优雅关闭的 reader 退出必须判为崩溃"
        );
        assert!(
            !lifecycle.on_reader_exit(),
            "崩溃判定必须幂等（否则重复发 error + 重复触发前端重试提示）"
        );
        assert_eq!(
            lifecycle.status(NAME),
            LspSessionStatus::Error(crash_message(NAME))
        );
        assert!(lifecycle.is_terminal());
        assert!(
            !matches!(lifecycle.status(NAME), LspSessionStatus::Stopped),
            "崩溃不等于 Neeko 主动关闭"
        );
    }

    /// `Error` 归一为崩溃相位：message 由 `crash_message` 单点重建，避免两处文案漂移。
    #[test]
    fn set_error_normalizes_to_crash_phase() {
        let lifecycle = Lifecycle::new();
        lifecycle.set(&LspSessionStatus::Error(
            "whatever the caller passed".into(),
        ));
        assert_eq!(
            lifecycle.status(NAME),
            LspSessionStatus::Error(crash_message(NAME))
        );
    }

    /// 崩溃后用户主动关闭（重试 / 停止）：必须接受关闭并转为 Stopped（前端据此清诊断）。
    #[test]
    fn close_after_crash_enters_closed_state() {
        let lifecycle = Lifecycle::new();
        lifecycle.set(&LspSessionStatus::Ready);
        lifecycle.on_reader_exit();

        assert!(lifecycle.close(), "崩溃后的主动关闭仍是首次进入关闭态");
        assert_eq!(lifecycle.status(NAME), LspSessionStatus::Stopped);
    }

    /// 终态是吸收态：关闭后任何相位推进都不得让会话"复活"。
    #[test]
    fn terminal_state_is_absorbing() {
        let lifecycle = Lifecycle::new();
        lifecycle.close();
        lifecycle.set(&LspSessionStatus::Ready);
        assert_eq!(
            lifecycle.status(NAME),
            LspSessionStatus::Stopped,
            "关闭后推进 ready 不得复活会话"
        );

        let crashed = Lifecycle::new();
        crashed.on_reader_exit();
        crashed.set(&LspSessionStatus::Ready);
        assert_eq!(
            crashed.status(NAME),
            LspSessionStatus::Error(crash_message(NAME)),
            "崩溃后推进 ready 不得复活会话"
        );
    }

    /// `Indexing` 是前端派生态（work-done token 合成），服务端不存在该相位 →
    /// 归一为 Ready：会话确实可用，不得因展示态而降级成错误或空闲。
    #[test]
    fn set_indexing_normalizes_to_ready() {
        let lifecycle = Lifecycle::new();
        lifecycle.set(&LspSessionStatus::Indexing);
        assert_eq!(lifecycle.status(NAME), LspSessionStatus::Ready);
        assert!(!lifecycle.is_terminal());
    }

    /// 崩溃文案单点（reader 事件与快照派生共用）。
    #[test]
    fn crash_message_names_the_server() {
        assert_eq!(crash_message("jdtls"), "jdtls exited unexpectedly");
    }
}
