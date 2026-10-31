//! 状态转移（纯函数）：`reduce(state, signal) -> Option<SessionState>`。
//!
//! 两条硬规则（事故形态写在括号里）：
//!
//! 1. **终止态吸收一切迟到信号**（pi 实测：`Error` 之后还会来 `TurnEnd` —— 把
//!    `Failed` 改写回 `Ready` 会让「点停止后仍显示运行中」的形态复活）。
//! 2. **`Ready + ApprovalResolved` 是噪声**（用户误点 / 迟到回执），返回 `None`
//!    而不是把空闲会话推进到 `Running`。
//!
//! `None` 的语义统一为「这条信号不产生转移」：非法信号、被吸收的迟到信号、以及
//! 不改变状态的抖动都归它。注册表据此决定**是否 bump 版本号**（R2.3：状态抖动不刷 IPC）。

use crate::live_sessions::entry::SessionState;

/// 状态信号（唯一写者的输入）。
///
/// 生产者只有两个：chat 事件流（`wiring::chat::signal_of`）与 terminal 生命周期
/// （`wiring::pty`）。视图层没有构造信号的位置。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Signal {
    /// 会话已建立（chat：`SessionStart` / `ContextInit`）。
    Created,
    /// 一轮开始（`TurnStart`）。
    TurnStarted,
    /// 一轮结束（`TurnEnd`）。
    TurnFinished,
    /// 请求用户审批（`RequestApproval`）。
    ApprovalRequested,
    /// 审批已解决（`UserInput` / 前端回执）。
    ApprovalResolved,
    /// 失败（`Error`；terminal 非零退出码）。
    Failed,
    /// 被停止（用户点停止 / 会话被关闭）。
    Stopped,
    /// 进程退出（terminal child 退出码 0 / 无退出码；chat `SessionDone`）。
    Exited,
    /// 会话关闭（视图侧注销前的最后一跳）。
    Closed,
}

/// 状态转移表（穷举；`None` = 本信号不产生转移）。
///
/// | 当前 \ 信号 | Created | TurnStarted | TurnFinished | ApprovalRequested | ApprovalResolved | Failed | Stopped / Exited / Closed |
/// | --- | --- | --- | --- | --- | --- | --- | --- |
/// | Ready | Ready | Running | Ready | AwaitingApproval | — | Failed | Stopped |
/// | Running | Running | Running | Ready | AwaitingApproval | Running | Failed | Stopped |
/// | AwaitingApproval | AwaitingApproval | Running | Ready | AwaitingApproval | Running | Failed | Stopped |
/// | Failed / Stopped | — | — | — | — | — | — | — |
#[must_use]
pub const fn reduce(state: SessionState, signal: Signal) -> Option<SessionState> {
    use SessionState::{AwaitingApproval, Failed, Ready, Running, Stopped};
    use Signal::{
        ApprovalRequested, ApprovalResolved, Closed, Created, Exited, Failed as OnFailed,
        Stopped as OnStopped, TurnFinished, TurnStarted,
    };

    // 终止吸收：任何迟到信号都不得复活已终止的会话。
    if state.is_terminal() {
        return None;
    }

    match (state, signal) {
        // ── Ready ───────────────────────────────────────────────────────────
        (Ready, Created) => Some(Ready),
        (Ready, TurnStarted) => Some(Running),
        (Ready, TurnFinished) => Some(Ready),
        (Ready, ApprovalRequested) => Some(AwaitingApproval),
        // 噪声：没有待审批项时的「已解决」回执不得把空闲会话推进到 Running。
        (Ready, ApprovalResolved) => None,
        (Ready, OnFailed) => Some(Failed),
        (Ready | Running | AwaitingApproval, OnStopped | Exited | Closed) => Some(Stopped),

        // ── Running ─────────────────────────────────────────────────────────
        (Running, Created) => Some(Running),
        (Running, TurnStarted) => Some(Running),
        (Running, TurnFinished) => Some(Ready),
        (Running, ApprovalRequested) => Some(AwaitingApproval),
        // 迟到的「已解决」：本轮仍在跑，维持运行态（不改变状态 ⇒ 不 bump）。
        (Running, ApprovalResolved) => Some(Running),
        (Running, OnFailed) => Some(Failed),

        // ── AwaitingApproval ────────────────────────────────────────────────
        (AwaitingApproval, Created) => Some(AwaitingApproval),
        (AwaitingApproval, TurnStarted) => Some(Running),
        (AwaitingApproval, TurnFinished) => Some(Ready),
        // 并发的第二个审批请求：仍在等待。
        (AwaitingApproval, ApprovalRequested) => Some(AwaitingApproval),
        // 审批往返：解决后本轮继续跑（回到 Running，不是 Ready —— 回合还没结束）。
        (AwaitingApproval, ApprovalResolved) => Some(Running),
        (AwaitingApproval, OnFailed) => Some(Failed),

        // 终止态已在上面早退；此臂只为让「新增 variant 必须处理」在编译期生效。
        (Failed | Stopped, _) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use SessionState as S;
    use Signal::*;

    const ALL_STATES: [SessionState; 5] = [
        S::Ready,
        S::Running,
        S::AwaitingApproval,
        S::Failed,
        S::Stopped,
    ];
    const ALL_SIGNALS: [Signal; 9] = [
        Created,
        TurnStarted,
        TurnFinished,
        ApprovalRequested,
        ApprovalResolved,
        Signal::Failed,
        Signal::Stopped,
        Exited,
        Closed,
    ];

    /// 转移表的**全部** `(state, signal)` 组合（45 行），逐行断言。
    /// 新增 `SessionState` / `Signal` variant 时这张表会被 `ALL_*` 的等长断言顶红。
    #[test]
    fn reduce_covers_every_state_signal_pair() {
        let table: [(SessionState, Signal, Option<SessionState>); 45] = [
            // Ready
            (S::Ready, Created, Some(S::Ready)),
            (S::Ready, TurnStarted, Some(S::Running)),
            (S::Ready, TurnFinished, Some(S::Ready)),
            (S::Ready, ApprovalRequested, Some(S::AwaitingApproval)),
            (S::Ready, ApprovalResolved, None),
            (S::Ready, Signal::Failed, Some(S::Failed)),
            (S::Ready, Signal::Stopped, Some(S::Stopped)),
            (S::Ready, Exited, Some(S::Stopped)),
            (S::Ready, Closed, Some(S::Stopped)),
            // Running
            (S::Running, Created, Some(S::Running)),
            (S::Running, TurnStarted, Some(S::Running)),
            (S::Running, TurnFinished, Some(S::Ready)),
            (S::Running, ApprovalRequested, Some(S::AwaitingApproval)),
            (S::Running, ApprovalResolved, Some(S::Running)),
            (S::Running, Signal::Failed, Some(S::Failed)),
            (S::Running, Signal::Stopped, Some(S::Stopped)),
            (S::Running, Exited, Some(S::Stopped)),
            (S::Running, Closed, Some(S::Stopped)),
            // AwaitingApproval
            (S::AwaitingApproval, Created, Some(S::AwaitingApproval)),
            (S::AwaitingApproval, TurnStarted, Some(S::Running)),
            (S::AwaitingApproval, TurnFinished, Some(S::Ready)),
            (
                S::AwaitingApproval,
                ApprovalRequested,
                Some(S::AwaitingApproval),
            ),
            (S::AwaitingApproval, ApprovalResolved, Some(S::Running)),
            (S::AwaitingApproval, Signal::Failed, Some(S::Failed)),
            (S::AwaitingApproval, Signal::Stopped, Some(S::Stopped)),
            (S::AwaitingApproval, Exited, Some(S::Stopped)),
            (S::AwaitingApproval, Closed, Some(S::Stopped)),
            // Failed（吸收全部）
            (S::Failed, Created, None),
            (S::Failed, TurnStarted, None),
            (S::Failed, TurnFinished, None),
            (S::Failed, ApprovalRequested, None),
            (S::Failed, ApprovalResolved, None),
            (S::Failed, Signal::Failed, None),
            (S::Failed, Signal::Stopped, None),
            (S::Failed, Exited, None),
            (S::Failed, Closed, None),
            // Stopped（吸收全部）
            (S::Stopped, Created, None),
            (S::Stopped, TurnStarted, None),
            (S::Stopped, TurnFinished, None),
            (S::Stopped, ApprovalRequested, None),
            (S::Stopped, ApprovalResolved, None),
            (S::Stopped, Signal::Failed, None),
            (S::Stopped, Signal::Stopped, None),
            (S::Stopped, Exited, None),
            (S::Stopped, Closed, None),
        ];
        assert_eq!(
            table.len(),
            ALL_STATES.len() * ALL_SIGNALS.len(),
            "新 variant 未进表 ⇒ 穷举失效"
        );
        for (state, signal, expected) in table {
            assert_eq!(
                reduce(state, signal),
                expected,
                "reduce({state:?}, {signal:?}) 与转移表不一致"
            );
        }
    }

    /// 事故形态（R1.3）：`Error` 之后还会有 `TurnEnd`；不得把失败改写回 Ready。
    #[test]
    fn terminal_states_absorb_every_late_signal() {
        for state in [S::Failed, S::Stopped] {
            for signal in ALL_SIGNALS {
                assert_eq!(
                    reduce(state, signal),
                    None,
                    "{state:?} 被迟到信号 {signal:?} 复活"
                );
            }
        }
    }

    /// 审批往返：Running → AwaitingApproval → Running（回合未结束，不能落回 Ready）。
    #[test]
    fn approval_round_trip_returns_to_running() {
        let awaiting = reduce(S::Running, ApprovalRequested).expect("request → awaiting");
        assert_eq!(awaiting, S::AwaitingApproval);
        let resumed = reduce(awaiting, ApprovalResolved).expect("resolve → running");
        assert_eq!(resumed, S::Running);
        assert_eq!(
            reduce(resumed, TurnFinished),
            Some(S::Ready),
            "回合结束才回到 Ready"
        );
    }

    #[test]
    fn ready_approval_resolved_is_noise() {
        assert_eq!(reduce(S::Ready, ApprovalResolved), None);
    }

    /// `Exited` / `Closed` 都落 `Stopped`（正常终止只有一种外观）。
    #[test]
    fn exit_and_close_both_settle_on_stopped() {
        for state in [S::Ready, S::Running, S::AwaitingApproval] {
            assert_eq!(reduce(state, Exited), Some(S::Stopped));
            assert_eq!(reduce(state, Closed), Some(S::Stopped));
        }
    }
}
