//! 完成判定 —— **纯函数**，design §2.1 + §6 的单一状态机。
//!
//! 输入是一个 [`MemberSignal`]（不是 `HookEvent`、不是 `StreamEvent`）+ 成员/任务/取证三态，
//! 输出是迁移后的三态。这样做的收益是：CLI 与 Chat 两条路径共用同一台状态机，
//! 而本函数永远不需要认识任何一条传输（design §5.6）。
//!
//! # 三条硬规则（每条都有对应测试）
//!
//! 1. `Idle` **永不**自动升级为 `Done` —— 否则「它说完了」会被当成「它做完了」。
//!    这也是本函数**永远不返回 [`DoneVerification::Verified`]** 的原因：verified 只能由
//!    `task_update(done)` 产生，那条路径在 `TeamManager::update_task`，不在这里。
//! 2. 无 L2 时落 `Unverified`，团队面板必须可区分。
//! 3. `Done` 的唯一权威是任务板 `state == done`，不是 `member.state` ——
//!    所以本函数对任务状态的迁移只做「板上确实发生的事」（审批），从不替成员宣布完成。
//!
//! # 本函数**不管**的两件事
//!
//! - **租约回收**：`owner` 转 `Dead`/`Stalled` 后任务回 `pending` 是 `lease.rs` +
//!   `TeamManager::reclaim_expired` 的活（design §2.1：`in_progress ──owner 转 Dead/Stalled──▶ pending`）。
//!   放在这里会让纯函数需要认识时钟与计数。
//! - **`task_update(failed)`**：那是显式声明（L2），走 manager。

use crate::agent::team::types::{DoneVerification, MemberSignal, MemberState, TeamTaskState};

/// 应用一条成员信号，返回迁移后的 `(成员态, 任务态, 取证)`。
///
/// 参数顺序刻意与 [`MemberSignal`] 之后的「三态」一致，便于调用方与测试表逐格对齐。
#[must_use]
pub const fn advance(
    member: MemberState,
    task: TeamTaskState,
    verification: DoneVerification,
    signal: MemberSignal,
) -> (MemberState, TeamTaskState, DoneVerification) {
    // 取证要看**输入**是否已 done（输出态里 Done 只可能来自输入，但仍以输入为准更直白）。
    let task_was_done = matches!(task, TeamTaskState::Done);
    (
        next_member_state(member, signal),
        next_task_state(task, signal),
        next_verification(verification, signal, task_was_done),
    )
}

/// 终态 = 不再接受「活着」类信号的状态。
const fn is_terminal(state: MemberState) -> bool {
    matches!(
        state,
        MemberState::Done | MemberState::Failed | MemberState::Offline
    )
}

/// 成员状态迁移（design §2.1）。
const fn next_member_state(member: MemberState, signal: MemberSignal) -> MemberState {
    // 「任意 ──进程退出 / SessionDone──▶ Dead」：连终态也照走。
    // `Done → Dead` 不丢信息，因为 done 的权威是任务板而不是 member.state（硬规则 3）。
    if matches!(signal, MemberSignal::Exited) {
        return MemberState::Offline;
    }
    // 其余信号对终态一律吸收：迟到的信号不得让一个已报废的成员重新看起来健康。
    if is_terminal(member) {
        return member;
    }
    match signal {
        // L1：回合结束 ⇒ 空闲。「说完了」不是「做完了」（硬规则 1）。
        MemberSignal::TurnCompleted => MemberState::Idle,
        // 审批门的家（design §6.1）。CLI 侧没有 `input_requested` 的 agent 会落到
        // `Stalled`（L3），所以这里只做「有信号就摆到 Awaiting」。
        MemberSignal::ApprovalRequested | MemberSignal::InputRequested => MemberState::Awaiting,
        // L2 之下的失败：本回合失败 ≠ 进程死亡。
        MemberSignal::Failed => MemberState::Failed,
        // 上面已提前返回；写同值分支是为了让 match 保持穷尽（不加 `_ =>`，
        // 新增信号变体会强制在此处被处理）。
        MemberSignal::Exited => MemberState::Offline,
    }
}

/// 任务状态迁移（design §2.1）。**从不产出 `Done`** —— 那是 L2 显式声明的活。
const fn next_task_state(task: TeamTaskState, signal: MemberSignal) -> TeamTaskState {
    match signal {
        // 回合结束不改板上事实（硬规则 1）；进程死亡 / 本回合失败同样不改 ——
        // 任务靠租约回收回 `pending`（design §2.1「owner 转 Dead/Stalled → pending」）。
        MemberSignal::TurnCompleted | MemberSignal::Failed | MemberSignal::Exited => task,
        // 只有「有 owner 在干活」的两个态能进待批队列。`Claimed` 也放行：
        // `TurnStart` 不在 `MemberSignal` 里（design §5.6 只有五条），排除它会让
        // 「首轮就要审批」的任务永远进不了待批队列。
        MemberSignal::ApprovalRequested | MemberSignal::InputRequested => match task {
            TeamTaskState::Claimed | TeamTaskState::InProgress => TeamTaskState::AwaitingApproval,
            _ => task,
        },
    }
}

/// 取证迁移：只有 `TurnCompleted` 会写，且只在任务尚未 `done` 时降级为 `Unverified`。
///
/// # 为什么这里不做「`Verified` 饱和」
///
/// `(成员态, 任务态, 取证)` 是**一致三元组**：任务还在 `in_progress` 却带 `Verified` 是自相矛盾
/// 的输入，降级属于**修复**而不是丢失。所以本函数保持纯：它只看传入的三元组。
///
/// 「任务已 `done`，迟到的 `turn_completed` 不得抹掉 `Verified`」这条硬规则由调用方保证——
/// `TeamManager::observe_signal` 在没有**在飞任务**时只推进成员态、不改写取证。
const fn next_verification(
    verification: DoneVerification,
    signal: MemberSignal,
    task_was_done: bool,
) -> DoneVerification {
    if matches!(signal, MemberSignal::TurnCompleted) && !task_was_done {
        return DoneVerification::Unverified;
    }
    verification
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::team::types::{DoneVerification, MemberSignal, MemberState, TeamTaskState};

    const ALL_MEMBER_STATES: [MemberState; 8] = [
        MemberState::Spawned,
        MemberState::Running,
        MemberState::Awaiting,
        MemberState::Idle,
        MemberState::Done,
        MemberState::Failed,
        MemberState::Offline,
        MemberState::Stalled,
    ];

    const ALL_TASK_STATES: [TeamTaskState; 8] = [
        TeamTaskState::Pending,
        TeamTaskState::Claimed,
        TeamTaskState::InProgress,
        TeamTaskState::AwaitingApproval,
        TeamTaskState::Done,
        TeamTaskState::Failed,
        TeamTaskState::Blocked,
        TeamTaskState::Proposed,
    ];

    const ALL_SIGNALS: [MemberSignal; 5] = [
        MemberSignal::TurnCompleted,
        MemberSignal::ApprovalRequested,
        MemberSignal::InputRequested,
        MemberSignal::Failed,
        MemberSignal::Exited,
    ];

    /// design §2.1 成员状态机逐格：行 = 当前成员态，列 = 信号
    /// （`TurnCompleted` / `ApprovalRequested` / `InputRequested` / `Failed` / `Exited`）。
    ///
    /// 这张表就是「六态徽标」的契约：`Idle` 只在回合结束时出现，
    /// 而且**任何一格都不会产出 `Done`**（它只能由 `task_update(done)` 触达）。
    const MEMBER_TABLE: [(MemberState, [MemberState; 5]); 8] = [
        (
            MemberState::Spawned,
            [
                MemberState::Idle,
                MemberState::Awaiting,
                MemberState::Awaiting,
                MemberState::Failed,
                MemberState::Offline,
            ],
        ),
        (
            MemberState::Running,
            [
                MemberState::Idle,
                MemberState::Awaiting,
                MemberState::Awaiting,
                MemberState::Failed,
                MemberState::Offline,
            ],
        ),
        (
            MemberState::Awaiting,
            [
                MemberState::Idle,
                MemberState::Awaiting,
                MemberState::Awaiting,
                MemberState::Failed,
                MemberState::Offline,
            ],
        ),
        (
            MemberState::Idle,
            [
                MemberState::Idle,
                MemberState::Awaiting,
                MemberState::Awaiting,
                MemberState::Failed,
                MemberState::Offline,
            ],
        ),
        (
            MemberState::Stalled,
            [
                MemberState::Idle,
                MemberState::Awaiting,
                MemberState::Awaiting,
                MemberState::Failed,
                MemberState::Offline,
            ],
        ),
        (
            MemberState::Done,
            [
                MemberState::Done,
                MemberState::Done,
                MemberState::Done,
                MemberState::Done,
                MemberState::Offline,
            ],
        ),
        (
            MemberState::Failed,
            [
                MemberState::Failed,
                MemberState::Failed,
                MemberState::Failed,
                MemberState::Failed,
                MemberState::Offline,
            ],
        ),
        (
            MemberState::Offline,
            [
                MemberState::Offline,
                MemberState::Offline,
                MemberState::Offline,
                MemberState::Offline,
                MemberState::Offline,
            ],
        ),
    ];

    /// design §2.1 任务状态机逐格：行 = 当前任务态，列 = 信号。
    ///
    /// 关键两列：
    /// - `TurnCompleted` 列**恒等于输入任务态** —— 回合结束不改变板上事实（硬规则 1）。
    /// - `Failed` / `Exited` 列同样不改变任务态：进程死掉后任务靠**租约**回 `pending`，
    ///   不是靠这里把任务判死（design §2.1「owner 转 Dead/Stalled → pending（lease 回收）」）。
    const TASK_TABLE: [(TeamTaskState, [TeamTaskState; 5]); 8] = [
        (
            TeamTaskState::Pending,
            [
                TeamTaskState::Pending,
                TeamTaskState::Pending,
                TeamTaskState::Pending,
                TeamTaskState::Pending,
                TeamTaskState::Pending,
            ],
        ),
        (
            TeamTaskState::Claimed,
            [
                TeamTaskState::Claimed,
                TeamTaskState::AwaitingApproval,
                TeamTaskState::AwaitingApproval,
                TeamTaskState::Claimed,
                TeamTaskState::Claimed,
            ],
        ),
        (
            TeamTaskState::InProgress,
            [
                TeamTaskState::InProgress,
                TeamTaskState::AwaitingApproval,
                TeamTaskState::AwaitingApproval,
                TeamTaskState::InProgress,
                TeamTaskState::InProgress,
            ],
        ),
        (
            TeamTaskState::AwaitingApproval,
            [
                TeamTaskState::AwaitingApproval,
                TeamTaskState::AwaitingApproval,
                TeamTaskState::AwaitingApproval,
                TeamTaskState::AwaitingApproval,
                TeamTaskState::AwaitingApproval,
            ],
        ),
        (
            TeamTaskState::Done,
            [
                TeamTaskState::Done,
                TeamTaskState::Done,
                TeamTaskState::Done,
                TeamTaskState::Done,
                TeamTaskState::Done,
            ],
        ),
        (
            TeamTaskState::Failed,
            [
                TeamTaskState::Failed,
                TeamTaskState::Failed,
                TeamTaskState::Failed,
                TeamTaskState::Failed,
                TeamTaskState::Failed,
            ],
        ),
        (
            TeamTaskState::Blocked,
            [
                TeamTaskState::Blocked,
                TeamTaskState::Blocked,
                TeamTaskState::Blocked,
                TeamTaskState::Blocked,
                TeamTaskState::Blocked,
            ],
        ),
        (
            TeamTaskState::Proposed,
            [
                TeamTaskState::Proposed,
                TeamTaskState::Proposed,
                TeamTaskState::Proposed,
                TeamTaskState::Proposed,
                TeamTaskState::Proposed,
            ],
        ),
    ];

    /// 硬规则 1（AC2）：`Running + TurnCompleted` → 成员 `Idle`，任务**仍在进行中**，
    /// 取证降为 `Unverified`。「它说完了」不得被当成「它做完了」。
    #[test]
    fn turn_completed_lands_idle_and_marks_unverified() {
        let (member, task, verification) = advance(
            MemberState::Running,
            TeamTaskState::InProgress,
            DoneVerification::Verified,
            MemberSignal::TurnCompleted,
        );
        assert_eq!(member, MemberState::Idle);
        assert_eq!(task, TeamTaskState::InProgress, "回合结束不改板上事实");
        assert_eq!(verification, DoneVerification::Unverified);
    }

    /// 硬规则 1（AC2）：连续两轮都没有 `task_update(done)` ⇒ 成员仍是 `Idle`、
    /// 任务仍是 `InProgress`。这是「idle ≠ done」在长时间运行下的形态。
    #[test]
    fn repeated_turn_completed_never_upgrades_idle_to_done() {
        let (mut member, mut task, mut verification) = (
            MemberState::Running,
            TeamTaskState::InProgress,
            DoneVerification::Verified,
        );
        for _ in 0..5 {
            (member, task, verification) =
                advance(member, task, verification, MemberSignal::TurnCompleted);
            assert_eq!(member, MemberState::Idle);
            assert_eq!(task, TeamTaskState::InProgress);
            assert_eq!(verification, DoneVerification::Unverified);
        }
    }

    /// 硬规则 2：`advance` **永不**产出 `Verified` ——
    /// 它只能由 `task_update(done)` 产生（`TeamManager::update_task`）。
    /// 全组合穷举，输入 `Unverified` 时输出必须还是 `Unverified`。
    #[test]
    fn advance_never_invents_verified() {
        for state in ALL_MEMBER_STATES {
            for task_state in ALL_TASK_STATES {
                for signal in ALL_SIGNALS {
                    let (_, _, out) =
                        advance(state, task_state, DoneVerification::Unverified, signal);
                    assert_eq!(
                        out,
                        DoneVerification::Unverified,
                        "advance invented Verified for {state:?}/{task_state:?}/{signal:?}"
                    );
                }
            }
        }
    }

    /// 硬规则 2：任务已经 `done`（说明 L2 已到，取证为 `Verified`）时，
    /// 后到的 `TurnCompleted` 不得把它降级成 `Unverified`。
    #[test]
    fn verified_survives_a_late_turn_completed() {
        let (_, task, verification) = advance(
            MemberState::Done,
            TeamTaskState::Done,
            DoneVerification::Verified,
            MemberSignal::TurnCompleted,
        );
        assert_eq!(task, TeamTaskState::Done);
        assert_eq!(verification, DoneVerification::Verified);
    }

    /// 规则 3：`approval_requested` / `input_requested` → 成员 `Awaiting` + 任务
    /// `awaiting_approval`（审批门的家，design §6.1）。
    #[test]
    fn approval_and_input_requests_route_to_awaiting() {
        for signal in [
            MemberSignal::ApprovalRequested,
            MemberSignal::InputRequested,
        ] {
            let (member, task, _) = advance(
                MemberState::Running,
                TeamTaskState::InProgress,
                DoneVerification::Unverified,
                signal,
            );
            assert_eq!(member, MemberState::Awaiting, "{signal:?}");
            assert_eq!(task, TeamTaskState::AwaitingApproval, "{signal:?}");
        }
    }

    /// 规则 4：`Failed` → `Failed`；`Exited` → `Offline`。
    #[test]
    fn failed_and_exited_have_distinct_signatures() {
        let (member, _, _) = advance(
            MemberState::Running,
            TeamTaskState::InProgress,
            DoneVerification::Unverified,
            MemberSignal::Failed,
        );
        assert_eq!(member, MemberState::Failed);

        let (member, _, _) = advance(
            MemberState::Running,
            TeamTaskState::InProgress,
            DoneVerification::Unverified,
            MemberSignal::Exited,
        );
        assert_eq!(member, MemberState::Offline);
    }

    /// 规则 5：终态对 `TurnCompleted` 吸收 —— 迟到的回合信号不得把 `Failed` / `Offline`
    /// 洗回 `Idle`（那会让「已报废的成员」在板上重新看起来健康）。
    #[test]
    fn terminal_member_states_absorb_turn_completed() {
        for state in [MemberState::Done, MemberState::Failed, MemberState::Offline] {
            let (member, _, _) = advance(
                state,
                TeamTaskState::InProgress,
                DoneVerification::Unverified,
                MemberSignal::TurnCompleted,
            );
            assert_eq!(member, state, "{state:?} must be absorbing");
        }
    }

    /// 规则 6：没有任何信号能把 `Offline` 拉回 `Running`（这正是「幽灵成员」的来源）。
    #[test]
    fn offline_never_returns_to_running() {
        for signal in ALL_SIGNALS {
            let (member, _, _) = advance(
                MemberState::Offline,
                TeamTaskState::InProgress,
                DoneVerification::Unverified,
                signal,
            );
            assert_eq!(
                member,
                MemberState::Offline,
                "{signal:?} resurrected a dead member"
            );
        }
    }

    /// 成员状态机逐格（design §2.1）。任务侧用 `Pending`（惰性态）以隔离成员列。
    #[test]
    fn member_state_matrix_matches_design_table() {
        for (from, expected) in MEMBER_TABLE {
            for (i, signal) in ALL_SIGNALS.iter().enumerate() {
                let (member, _, _) = advance(
                    from,
                    TeamTaskState::Pending,
                    DoneVerification::Unverified,
                    *signal,
                );
                assert_eq!(member, expected[i], "{from:?} + {signal:?}");
            }
        }
    }

    /// 任务状态机逐格（design §2.1）。成员侧用 `Running` 以隔离任务列。
    #[test]
    fn task_state_matrix_matches_design_table() {
        for (from, expected) in TASK_TABLE {
            for (i, signal) in ALL_SIGNALS.iter().enumerate() {
                let (_, task, _) = advance(
                    MemberState::Running,
                    from,
                    DoneVerification::Unverified,
                    *signal,
                );
                assert_eq!(task, expected[i], "{from:?} + {signal:?}");
            }
        }
    }

    /// 取证矩阵：只有 `TurnCompleted` 会写取证，且只在任务**不是** `done` 时降级。
    #[test]
    fn verification_matrix_only_degrades_on_turn_completed() {
        for task_state in ALL_TASK_STATES {
            for signal in ALL_SIGNALS {
                let (_, _, out) = advance(
                    MemberState::Running,
                    task_state,
                    DoneVerification::Verified,
                    signal,
                );
                let expected =
                    if signal == MemberSignal::TurnCompleted && task_state != TeamTaskState::Done {
                        DoneVerification::Unverified
                    } else {
                        DoneVerification::Verified
                    };
                assert_eq!(out, expected, "{task_state:?} + {signal:?}");
            }
        }
    }

    /// 全组合穷举的**总结性**不变量：任何格子的产出都不得是 `Done`，
    /// 除非输入任务态已经是 `Done`（硬规则 1 的最强表述）。
    #[test]
    fn no_signal_combination_manufactures_a_done_task() {
        for state in ALL_MEMBER_STATES {
            for task_state in ALL_TASK_STATES {
                for signal in ALL_SIGNALS {
                    let (_, task, _) =
                        advance(state, task_state, DoneVerification::Unverified, signal);
                    if task == TeamTaskState::Done {
                        assert_eq!(
                            task_state,
                            TeamTaskState::Done,
                            "advance manufactured Done from {task_state:?} on {signal:?}"
                        );
                    }
                }
            }
        }
    }
}
