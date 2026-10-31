//! `team_wait` —— **后端阻塞**的等待原语（design §4.3，本设计的核心）。
//!
//! # 为什么是服务端阻塞，而不是「提示词让队长等着」
//!
//! 业界（Claude Code agent teams）已知缺陷是「队长自己动手干活而不是等队友」，官方修法是
//! 改提示词 —— 提示词级等待必然退化成「边干边看」。把等待做成服务端阻塞原语，队长就
//! **物理上**没有退化的空间：`tools/call` 不返回，它就没有下一轮。
//!
//! # 三条不变量（每条都有对应测试）
//!
//! 1. **超时不报错**：返回 [`WaitOutcome::Timeout`] + 最新快照。队长需要知道现状才能决策，
//!    一个 `Err` 只会让它重试同一个调用。
//! 2. **按 `member_id` / `task_id` 钉住**（偷自 herdr）：等待绑定的是**谁**，不是「当前占用
//!    该任务的那个人」。任务被租约回收、由新成员接手并完成后，旧 waiter **不得**被满足 ——
//!    否则队长会收到别人的结果并以为原成员完成了。
//! 3. **载荷恒定小**（红线 4）：快照只有成员行（id/名字/角色/状态/取证）与任务行
//!    （id/状态/owner/回收次数/租约剩余秒）。**任何 transcript 字段都不许进来** ——
//!    等待是长轮次调用，往返回值里塞正文等于每等一次就把对话拖进上下文一遍。
//!
//! # 唤醒为什么不丢（与 `pi_rpc` 同源的坑）
//!
//! 只创建 `notified()` 而不 poll **不算注册**：那一刻写入方的 `notify_waiters()` 会被丢弃，
//! 等待者于是白等满 timeout。所以循环里是 `notified()` → `pin!` → `enable()`（同步注册），
//! **之后**才读代数与快照；配合写入方「先置位、后 notify」的顺序，两种交错都不丢唤醒：
//!
//! - 注册先发生 → 变更时被唤醒；
//! - 变更先发生 → 代数的二次比对发现「变了」，立刻重查而不进入 await。

use std::time::{Duration, Instant};

use crate::agent::team::manager::{now_millis, TeamManager};
use crate::agent::team::types::{DoneVerification, MemberRole, MemberState, TeamTaskState};
use crate::common::error::AppError;

/// 等到什么程度算「好了」（design §4.3 / §6）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WaitUntil {
    /// L2 显式声明到位：目标成员有 `done` 任务且手上没有在飞任务（= `Verified`）。
    Declared,
    /// 目标成员空闲（`Idle` / `Done`）—— 「它说完了」，**不等于**「它做完了」。
    Idle,
    /// 二者任一。
    Any,
}

/// 全部 `until` 取值（遍历用：schema 的 enum 与解析共用这一份，禁止第二份清单）。
pub const WAIT_UNTILS: [WaitUntil; 3] = [WaitUntil::Declared, WaitUntil::Idle, WaitUntil::Any];

impl WaitUntil {
    /// wire 字面量（MCP 协议的一部分：改名即改协议）。
    #[must_use]
    pub const fn wire(self) -> &'static str {
        match self {
            Self::Declared => "declared",
            Self::Idle => "idle",
            Self::Any => "any",
        }
    }

    /// 解析 wire 字面量（未知返回 `None`，由 dispatch 翻成可读的 `InvalidInput`）。
    #[must_use]
    pub fn parse(raw: &str) -> Option<Self> {
        WAIT_UNTILS.into_iter().find(|until| until.wire() == raw)
    }
}

/// 等谁。
///
/// 刻意是 `enum` 而不是「两个 `Vec` 字段」：同时等成员与等任务混在一起时，「全部满足」
/// 的语义会含混不明（一个成员满足不等于它手上的任务也 done）。dispatch 因此对
/// 「同时给了 members 与 tasks」直接拒绝，而不是替调用方猜。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WaitTargets {
    /// 等成员（按 `member_id` 钉住）。
    Members(Vec<String>),
    /// 等任务（按 `task_id` 钉住）。
    Tasks(Vec<String>),
}

impl WaitTargets {
    /// 目标 id 列表（错误信息用）。
    #[must_use]
    pub fn ids(&self) -> &[String] {
        match self {
            Self::Members(ids) | Self::Tasks(ids) => ids,
        }
    }
}

/// 快照里的一行成员 —— 只有 id / 名字 / 角色 / 状态 / 取证，**没有正文**（红线 4）。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitMemberRow {
    /// 成员 id（等待键）。
    pub member_id: String,
    /// 用户可读名字。
    pub name: String,
    /// 角色。
    pub role: MemberRole,
    /// 六态之一。
    pub state: MemberState,
    /// 取证水位线（`Declared` 的判据）。
    pub verification: DoneVerification,
}

/// 快照里的一行任务 —— 只有 id / 状态 / owner / 回收次数 / 租约剩余秒，**不含摘要**。
///
/// 连 `summary`（哪怕已被截到 4 KiB）也不进快照：等待可能长达 30 分钟，那期间回来的是
/// 一句「它还在跑吗」，不是一个可用它替代 `team_status` 的板视图。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitTaskRow {
    /// 任务 id（等待键）。
    pub task_id: String,
    /// 任务状态。
    pub state: TeamTaskState,
    /// 当前 owner（`None` = 无人持有，通常意味着刚被租约回收）。
    pub owner: Option<String>,
    /// 被回收次数（`> 3` 即冻结，见不变量 4）。
    pub reclaim_count: u32,
    /// 租约剩余秒；无人持有 = `None`，已超时未回收 = `Some(0)`。
    pub lease_remaining_secs: Option<i64>,
}

/// 返回给调用方的**恒定小载荷**摘要：每成员一行 + 每任务一行。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitSnapshot {
    /// 团队 id。
    pub team_id: String,
    /// 目标成员行（按目标顺序）。
    pub members: Vec<WaitMemberRow>,
    /// 目标任务行（按目标顺序）。
    pub tasks: Vec<WaitTaskRow>,
    /// 建快照时就发现的不可达目标（`Dead` / `Failed` / 已不在团队里）。
    ///
    /// 不进序列化载荷：它只是**循环的控制信号**，不是给模型看的事实（成员行里已经带着
    /// `state: dead` 这个事实本身）。
    #[serde(skip)]
    pub gone: Option<String>,
}

/// 等待的三种结局 —— **没有 `Err` 变体**：超时是结论，不是错误。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WaitOutcome {
    /// 判据已满足。
    Satisfied {
        /// 满足时刻的快照。
        snapshot: WaitSnapshot,
    },
    /// 到点了还没满足（**不报错**：队长要凭快照决定「继续等 / 换人 / 自己上」）。
    Timeout {
        /// 超时时刻的最新快照。
        snapshot: WaitSnapshot,
    },
    /// 目标已不可达（`Dead` / `Failed` / 已从团队移除）—— 必须**立刻**返回，
    /// 否则队长会为一个永远不会到来的完成白等满 timeout。
    TargetGone {
        /// 消逝的那个成员 id（**不是**接手者的 id —— 这正是「钉住」的含义）。
        member_id: String,
        /// 消逝时刻的快照。
        snapshot: WaitSnapshot,
    },
}

/// 纯函数：给定快照与判据，条件是否已满足。**不碰时钟、不碰锁、不含 IO**。
///
/// 目标集为空时返回 `false`：一个「没有目标」的等待是调用方的缺陷，让它白等满 timeout
/// 并带上空快照，比让它立刻「满足」安全 —— 后者会让队长以为有人完成了它没派出去的活。
#[must_use]
pub fn satisfied(snapshot: &WaitSnapshot, until: WaitUntil) -> bool {
    if snapshot.members.is_empty() && snapshot.tasks.is_empty() {
        return false;
    }
    snapshot
        .members
        .iter()
        .all(|row| member_satisfied(row, until))
        && snapshot.tasks.iter().all(|row| task_satisfied(row, until))
}

/// 一行的判据。`Idle` 只认「它说完了」，`Declared` 只认 L2 显式声明。
fn member_satisfied(row: &WaitMemberRow, until: WaitUntil) -> bool {
    let declared = row.verification == DoneVerification::Verified;
    let idle = matches!(row.state, MemberState::Idle | MemberState::Done);
    match until {
        WaitUntil::Declared => declared,
        WaitUntil::Idle => idle,
        WaitUntil::Any => declared || idle,
    }
}

/// 任务行的判据。
///
/// `Idle` 的语义是「无人正在干活」（不处于 `claimed`/`in_progress`/`awaiting_approval`），
/// 所以 `done` / `failed` / `blocked` / 尚未认领的 `pending` 都算。`Any` 对任务因此与
/// `Idle` 等价（`done ⊂ 非在飞`）—— 保留两个分支是为了让「成员侧 Any 是析取」这件事
/// 在任务侧不被读成「任务也支持两种独立语义」。
fn task_satisfied(row: &WaitTaskRow, until: WaitUntil) -> bool {
    let declared = row.state == TeamTaskState::Done;
    let idle = !matches!(
        row.state,
        TeamTaskState::Claimed | TeamTaskState::InProgress | TeamTaskState::AwaitingApproval
    );
    match until {
        WaitUntil::Declared => declared,
        WaitUntil::Idle => idle,
        WaitUntil::Any => declared || idle,
    }
}

/// 阻塞等待：条件满足 / 超时 / 目标消亡，三者之一返回。**超时不报错**。
///
/// # 循环形状（顺序即契约，别改）
///
/// 1. **先同步注册**（`notified()` → `pin!` → `enable()`）；
/// 2. 读代数；
/// 3. 建快照 → 判消亡 → 判满足 → 判超时；
/// 4. 只有「代数没变过」才真正去 await；变了就立刻重查（否则会漏掉注册与检查之间的唤醒）。
///
/// # 为什么超时后回到循环顶而不是直接返回
///
/// `tokio::time::timeout` 醒来只说明「到点或有人唤醒」，两者都要**重新建快照**才能给出
/// 最新现状。所以到点不在这里返回，而是回到顶部：那时快照已经是最新的，超时分支自然也
/// 就带上了最准确的 `Timeout { snapshot }`（这是「超时返回摘要」的全部价值）。
pub async fn wait(
    manager: &TeamManager,
    team_id: &str,
    targets: &WaitTargets,
    until: WaitUntil,
    timeout: Duration,
) -> Result<WaitOutcome, AppError> {
    let wake = manager.wake_handle();
    let deadline = Instant::now() + timeout;

    loop {
        // ① **同步注册**：`notified()` → `pin!` → `enable()`。只创建 future 而不 poll
        //    不算注册 —— 那一刻写入方的 `notify_waiters()` 会被丢弃，于是白等满剩余时间。
        //    同一个坑的完整复盘在 `agent/chat/adapter/pi_rpc/process.rs::annotate`。
        let notified = wake.notifier().notified();
        tokio::pin!(notified);
        let _ = notified.as_mut().enable();

        // ② 注册**之后**才读代数，才能覆盖「注册前已变更」那种交错。
        let epoch = wake.epoch();

        // ③ 快照 + 三个终局判定（顺序固定：先消亡、再满足、最后才看超时）。
        let snapshot = build_snapshot(manager, team_id, targets)?;
        if let Some(member_id) = snapshot.gone.clone() {
            return Ok(WaitOutcome::TargetGone {
                member_id,
                snapshot,
            });
        }
        if satisfied(&snapshot, until) {
            return Ok(WaitOutcome::Satisfied { snapshot });
        }
        let now = Instant::now();
        if now >= deadline {
            return Ok(WaitOutcome::Timeout { snapshot });
        }

        // ④ 检查之后已发生过变更 → 立刻重查（不 await 一个已经错过的唤醒）。
        if wake.epoch() != epoch {
            continue;
        }

        // ⑤ 有界等待。超时**不是错误**：睡醒后回到循环顶，快照重建后再落 Timeout ——
        //    这样 `Timeout { snapshot }` 带的一定是最新现状（超时的全部价值在此）。
        let _ = tokio::time::timeout(deadline - now, notified.as_mut()).await;
    }
}

/// 建一份**只含目标**的快照（团队成员表与板的投影）。
///
/// 只取 design §4.3 允许的列：成员 `id/name/role/state/verification`，任务
/// `id/state/owner/reclaim_count/租约剩余秒`。**任何正文列都不进来**（红线 4），
/// 所以这里不用整行 `TeamTask` / `TeamMember` 的序列化，而是逐列投影。
fn build_snapshot(
    manager: &TeamManager,
    team_id: &str,
    targets: &WaitTargets,
) -> Result<WaitSnapshot, AppError> {
    // 团队必须已加载：否则「空快照 + 白等满 timeout」会让调用方把配置错误读成「没人完成」。
    if manager.team(team_id).is_none() {
        return Err(AppError::NotFound(format!(
            "team `{team_id}` is not loaded"
        )));
    }

    let now = now_millis();
    let mut snapshot = WaitSnapshot {
        team_id: team_id.to_owned(),
        members: Vec::new(),
        tasks: Vec::new(),
        gone: None,
    };

    match targets {
        WaitTargets::Members(ids) => {
            for member_id in ids {
                // 同一把锁内取「成员 + 取证」：分两次读会在两次之间插进一次 claim，
                // 得到「刚认领了任务却仍显示已验证」的自相矛盾行。
                let Some((member, verification)) = manager.member_with_verification(member_id)
                else {
                    // 目标已不在团队里（无移除 API 时靠 dispatch 的入参校验拦住）——
                    // 当作不可达：否则 waiter 会为一个不存在的成员白等满 timeout。
                    snapshot.gone = Some(member_id.clone());
                    break;
                };
                let gone = member.team_id != team_id
                    || matches!(member.state, MemberState::Dead | MemberState::Failed);
                snapshot.members.push(WaitMemberRow {
                    member_id: member.id.clone(),
                    name: member.name,
                    role: member.role,
                    state: member.state,
                    verification,
                });
                if gone {
                    snapshot.gone = Some(member_id.clone());
                    break;
                }
            }
        }
        WaitTargets::Tasks(ids) => {
            let board = manager.tasks(team_id);
            for task_id in ids {
                let Some(task) = board.iter().find(|task| &task.id == task_id) else {
                    // 任务不在板上：无可等待的事实（dispatch 已在入口校验存在性）。
                    continue;
                };
                snapshot.tasks.push(WaitTaskRow {
                    task_id: task.id.clone(),
                    state: task.state,
                    owner: task.owner.clone(),
                    reclaim_count: task.reclaim_count,
                    lease_remaining_secs: lease_remaining_secs(task, now),
                });
            }
        }
    }

    Ok(snapshot)
}

/// 任务的租约剩余秒：`None` = 无人持有（不是 0），`Some(0)` = 已超时未回收。
///
/// 与 `mcp::dispatch` 的同名计算同口径，但方向相反（那边按成员在飞任务找，这边按任务
/// 自己算）—— 两边都必须能区分「没起租」与「已超时」，否则 UI 上「在干活」与「该回收了」
/// 会长得一模一样。
fn lease_remaining_secs(task: &crate::agent::team::types::TeamTask, now: i64) -> Option<i64> {
    let claimed_at = task.claimed_at?;
    let deadline = claimed_at.saturating_add(task.lease_ttl.saturating_mul(1000));
    Some(deadline.saturating_sub(now).max(0) / 1000)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::team::fixtures::{fixture_member, fixture_team};
    use crate::agent::team::manager::TeamManager;
    use crate::agent::team::store::TeamStore;
    use crate::agent::team::types::{MemberSignal, Team, TeamMember, TeamTask, Workspace};

    const TEAM: &str = "tm_1";
    const LEAD: &str = "lead@tm_1";
    /// 被等成员（钉住测试里的 A）。
    const A: &str = "w1@tm_1";
    /// 任务回收后的接手者（钉住测试里的 B）。
    const B: &str = "w2@tm_1";

    /// 夹具只剩"本测试关心的字段"；全量默认值在 [`fixture_team`] / [`fixture_member`]。
    fn team() -> Team {
        fixture_team(TEAM)
    }

    fn member(id: &str, name: &str, role: MemberRole) -> TeamMember {
        TeamMember {
            name: name.into(),
            role,
            ..fixture_member(id, TEAM)
        }
    }

    fn task(id: &str) -> TeamTask {
        TeamTask {
            id: id.into(),
            team_id: TEAM.into(),
            title: "do it".into(),
            body: "body".into(),
            state: TeamTaskState::Pending,
            owner: None,
            workspace: Workspace::Shared,
            depends_on: vec![],
            claimed_at: None,
            lease_ttl: 1800,
            summary: None,
            summary_truncated: false,
            artifacts: vec![],
            reclaim_count: 0,
        }
    }

    fn seeded() -> TeamManager {
        let manager = TeamManager::new(TeamStore::open_in_memory().unwrap());
        manager.create_team(team()).unwrap();
        for (id, name, role) in [
            (LEAD, "lead", MemberRole::Lead),
            (A, "a", MemberRole::Worker),
            (B, "b", MemberRole::Worker),
        ] {
            manager.add_member(member(id, name, role)).unwrap();
        }
        manager
    }

    fn members(ids: &[&str]) -> WaitTargets {
        WaitTargets::Members(ids.iter().map(|id| (*id).to_owned()).collect())
    }

    fn tasks(ids: &[&str]) -> WaitTargets {
        WaitTargets::Tasks(ids.iter().map(|id| (*id).to_owned()).collect())
    }

    /// 手搓一行成员快照（纯函数测试不碰 manager）。
    fn row(state: MemberState, verification: DoneVerification) -> WaitMemberRow {
        WaitMemberRow {
            member_id: A.into(),
            name: "a".into(),
            role: MemberRole::Worker,
            state,
            verification,
        }
    }

    /// 手搓一行任务快照。
    fn trow(state: TeamTaskState) -> WaitTaskRow {
        WaitTaskRow {
            task_id: "t1".into(),
            state,
            owner: Some(A.into()),
            reclaim_count: 0,
            lease_remaining_secs: Some(900),
        }
    }

    fn snap(members: Vec<WaitMemberRow>, tasks: Vec<WaitTaskRow>) -> WaitSnapshot {
        WaitSnapshot {
            team_id: TEAM.into(),
            members,
            tasks,
            gone: None,
        }
    }

    // ───────────────────────────────────────────────────────────────
    // 纯函数：判据表
    // ───────────────────────────────────────────────────────────────

    /// 表驱动：3 个 `until` × 3 种快照形态（全满足 / 部分满足 / 全不满足）。
    ///
    /// 保护的不变量（design §6 硬规则 1 / 2）：`Idle` 只认「它说完了」，`Declared` 只认
    /// L2 显式声明（`Verified`），`Any` 是**析取**而不是「什么都不用等」。把三者混成一条
    /// 判据的后果是队长拿到「它空闲了」并当成「它做完了」。
    #[test]
    fn satisfied_follows_the_three_untils() {
        // (形态描述, 成员行, 三种 until 的期望)
        let table: [(&str, WaitMemberRow, [bool; 3]); 3] = [
            (
                "全满足：空闲且已验证",
                row(MemberState::Idle, DoneVerification::Verified),
                [true, true, true],
            ),
            (
                "部分满足：空闲但未声明",
                row(MemberState::Idle, DoneVerification::Unverified),
                [false, true, true],
            ),
            (
                "全不满足：还在跑",
                row(MemberState::Running, DoneVerification::Unverified),
                [false, false, false],
            ),
        ];
        for (label, member_row, expected) in table {
            for (index, until) in WAIT_UNTILS.into_iter().enumerate() {
                let snapshot = snap(vec![member_row.clone()], vec![]);
                assert_eq!(
                    satisfied(&snapshot, until),
                    expected[index],
                    "{label} × until={:?}",
                    until.wire()
                );
            }
        }

        // 成员侧的反例补充：`Done` 态无需已验证也算空闲（硬规则 3：done 的权威是板，
        // 但成员自己走到 Done 时「它不忙了」这个事实成立）。
        let done_member = snap(
            vec![row(MemberState::Done, DoneVerification::Unverified)],
            vec![],
        );
        assert!(satisfied(&done_member, WaitUntil::Idle));
        assert!(!satisfied(&done_member, WaitUntil::Declared));

        // 任务侧：`Declared` 只认 done；`Idle` 认「无人在飞」。
        let table: [(TeamTaskState, [bool; 3]); 3] = [
            (TeamTaskState::Done, [true, true, true]),
            (TeamTaskState::Pending, [false, true, true]),
            (TeamTaskState::InProgress, [false, false, false]),
        ];
        for (state, expected) in table {
            for (index, until) in WAIT_UNTILS.into_iter().enumerate() {
                let snapshot = snap(vec![], vec![trow(state)]);
                assert_eq!(
                    satisfied(&snapshot, until),
                    expected[index],
                    "task {state:?} × until={:?}",
                    until.wire()
                );
            }
        }
    }

    /// 多目标 = **全满足**（不是「任一」）。
    ///
    /// 保护的不变量：队长等 3 个成员时，其中 1 个完成就返回会让它把「还有人没做完」
    /// 读成「全都做完了」。宁可多等，不可早返回。
    #[test]
    fn all_targets_must_be_satisfied() {
        let snapshot = snap(
            vec![
                row(MemberState::Idle, DoneVerification::Verified),
                row(MemberState::Running, DoneVerification::Unverified),
            ],
            vec![],
        );
        assert!(!satisfied(&snapshot, WaitUntil::Declared));
        assert!(!satisfied(&snapshot, WaitUntil::Idle));
        assert!(!satisfied(&snapshot, WaitUntil::Any));
    }

    /// 空目标集**永不**满足。
    ///
    /// 保护的不变量：`all()` 对空集是 `true`，直接用会让「on: {}」瞬间返回 satisfied ——
    /// 队长会以为自己等的那件事已经完成了。
    #[test]
    fn empty_target_set_is_never_satisfied() {
        let snapshot = snap(vec![], vec![]);
        for until in WAIT_UNTILS {
            assert!(!satisfied(&snapshot, until), "{:?}", until.wire());
        }
    }

    /// `TargetGone` 只对 `Dead` / `Failed` 生效（`Idle` / `Done` / `Stalled` 都不算）。
    ///
    /// 保护的不变量：把「空闲」「已完成」判成消亡会让队长在最该高兴的时候收到错误结论；
    /// 把 `Stalled` 判成消亡则会让它放弃一个还能被租约回收后重试的成员。
    #[test]
    fn gone_covers_only_dead_and_failed() {
        for (state, gone) in [
            (MemberState::Dead, true),
            (MemberState::Failed, true),
            (MemberState::Idle, false),
            (MemberState::Done, false),
            (MemberState::Stalled, false),
            (MemberState::Awaiting, false),
            (MemberState::Running, false),
            (MemberState::Spawned, false),
        ] {
            let manager = seeded();
            manager.observe_signal(A, signal_for(state), 1_000).unwrap();
            let snapshot = build_snapshot(&manager, TEAM, &members(&[A])).unwrap();
            assert_eq!(
                snapshot.gone.as_deref(),
                gone.then_some(A),
                "{state:?} 的 gone 判定错了"
            );
        }
    }

    /// 把成员推进到指定状态所需的信号（只覆盖本测试用到的态）。
    fn signal_for(state: MemberState) -> MemberSignal {
        match state {
            MemberState::Dead => MemberSignal::Exited,
            MemberState::Failed => MemberSignal::Failed,
            MemberState::Idle | MemberState::Done => MemberSignal::TurnCompleted,
            MemberState::Awaiting => MemberSignal::ApprovalRequested,
            // `Spawned` / `Running` / `Stalled` 由夹具初值或租约回收给出，无需信号。
            _ => MemberSignal::TurnCompleted,
        }
    }

    // ───────────────────────────────────────────────────────────────
    // 异步：三种结局
    // ───────────────────────────────────────────────────────────────

    /// 已满足 → **立即** `Satisfied`（远小于 timeout，证明没有白等一轮）。
    #[tokio::test]
    async fn already_satisfied_returns_without_waiting() {
        let manager = seeded();
        manager
            .observe_signal(A, MemberSignal::TurnCompleted, 1_000)
            .unwrap();

        let started = Instant::now();
        let outcome = wait(
            &manager,
            TEAM,
            &members(&[A]),
            WaitUntil::Idle,
            Duration::from_secs(5),
        )
        .await
        .unwrap();
        let elapsed = started.elapsed();

        assert!(
            matches!(outcome, WaitOutcome::Satisfied { .. }),
            "{outcome:?}"
        );
        assert!(
            elapsed < Duration::from_millis(100),
            "已满足却等了 {elapsed:?}（应当立即返回）"
        );
    }

    /// 永不满足 → `Timeout` 且**不返回 `Err`**（design §4.3：超时是结论，不是错误）。
    #[tokio::test]
    async fn unsatisfiable_target_times_out_without_an_error() {
        let manager = seeded();
        let started = Instant::now();
        // `A` 停在 `Spawned`：没有 done 任务 ⇒ `Declared` 永远不成立。
        let outcome = wait(
            &manager,
            TEAM,
            &members(&[A]),
            WaitUntil::Declared,
            Duration::from_millis(60),
        )
        .await
        .expect("超时不得返回 Err");
        let elapsed = started.elapsed();

        let WaitOutcome::Timeout { snapshot } = outcome else {
            panic!("必须是 Timeout，实际 {outcome:?}");
        };
        assert!(
            elapsed >= Duration::from_millis(45),
            "60ms 的超时在 {elapsed:?} 就返回了（判断「到点」的实现是坏的）"
        );
        // 快照必须是**最新**的（超时的价值全在这一段摘要上）。
        assert_eq!(snapshot.team_id, TEAM);
        assert_eq!(snapshot.members.len(), 1);
        assert_eq!(snapshot.members[0].member_id, A);
    }

    /// **真唤醒**（本设计的关键链路）：20ms 后有人把任务置 `done`，waiter 应在 ~20ms
    /// 返回 `Satisfied`，而不是白等满 2s。
    ///
    /// 保护的不变量：等待是**事件驱动**的，不是轮询 —— 否则「服务端阻塞」就退化成了
    /// 「每 100ms 查一次板」，与提示词级等待没有本质区别。
    #[tokio::test]
    async fn mutation_wakes_the_waiter_in_milliseconds() {
        let manager = std::sync::Arc::new(seeded());
        manager.create_task(task("t1")).unwrap();

        let mutator = {
            let manager = std::sync::Arc::clone(&manager);
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(20)).await;
                manager.claim_task("t1", A, 1_000).unwrap();
                manager
                    .update_task("t1", A, TeamTaskState::Done, Some("ok"), 1_100)
                    .unwrap();
            })
        };

        let started = Instant::now();
        let outcome = wait(
            &manager,
            TEAM,
            &members(&[A]),
            WaitUntil::Declared,
            Duration::from_secs(2),
        )
        .await
        .unwrap();
        let elapsed = started.elapsed();
        mutator.await.unwrap();

        // 留一行实测值（stderr：`print_stdout` 在本 crate 是 deny）：
        // 这条测试的存在意义是「事件驱动而不是轮询」，耗时就是证据。
        eprintln!("team_wait 唤醒延迟（20ms 变更 / 2s timeout）: {elapsed:?}");

        assert!(
            matches!(outcome, WaitOutcome::Satisfied { .. }),
            "{outcome:?}"
        );
        // 20ms 的变更必须在 20ms 量级被唤醒；500ms 是极宽松的天花板（CI 抖动），
        // 而旧的「轮询 100ms」实现也会落在这个区间 —— 所以下面还要卡下界。
        assert!(
            elapsed < Duration::from_millis(500),
            "被唤醒却等了 {elapsed:?}（timeout 是 2s，说明唤醒链路断了）"
        );
        assert!(
            elapsed >= Duration::from_millis(15),
            "在 {elapsed:?} 就返回了 —— 变更还没发生，说明快照/判据是假的"
        );
    }

    /// 目标成员 `Dead` → 立即 `TargetGone`（不等 timeout）。
    ///
    /// 保护的不变量：队长为一个永远不会到来的完成白等满 30 分钟是纯损失；进程已死是
    /// 板上可判定的事实，没有理由让等待继续。
    #[tokio::test]
    async fn dead_target_returns_target_gone_immediately() {
        let manager = seeded();
        manager
            .observe_signal(A, MemberSignal::Exited, 1_000)
            .unwrap();

        let started = Instant::now();
        let outcome = wait(
            &manager,
            TEAM,
            &members(&[A]),
            WaitUntil::Declared,
            Duration::from_secs(5),
        )
        .await
        .unwrap();
        let elapsed = started.elapsed();

        let WaitOutcome::TargetGone { member_id, .. } = outcome else {
            panic!("必须是 TargetGone，实际 {outcome:?}");
        };
        assert_eq!(member_id, A);
        assert!(
            elapsed < Duration::from_millis(100),
            "消亡必须立即返回，实际等了 {elapsed:?}"
        );
    }

    /// **钉住**（design §4.3 / AC15）：旧 waiter 绑定成员 A。A 死 → `TargetGone{A}`；
    /// 随后 B 认领同一任务并 `done` —— **B 从未满足过这个 waiter**。
    ///
    /// 保护的不变量：任务被租约回收后由新成员接手，是**另一个人的结果**。若等待按
    /// 「当前持有该任务的人」判定，队长会收到 B 的完成并以为 A 做完了 —— 这正是 herdr
    /// 用 agent id 钉住的原因。
    #[tokio::test]
    async fn a_new_owner_never_satisfies_the_old_waiter() {
        let manager = std::sync::Arc::new(seeded());
        manager.create_task(task("t1")).unwrap();
        // A 认领（起租约），随后退出。
        manager.claim_task("t1", A, 1_000).unwrap();

        let mutator = {
            let manager = std::sync::Arc::clone(&manager);
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(20)).await;
                // A 死亡 → 租约到期 → 任务回 pending（不变量 4 的回收路径）。
                manager
                    .observe_signal(A, MemberSignal::Exited, 1_000)
                    .unwrap();
                manager.reclaim_expired(1_000 + 1_800_000 + 1).unwrap();
                // B 接手同一任务并完成。
                manager.claim_task("t1", B, 2_000_000).unwrap();
                manager
                    .update_task("t1", B, TeamTaskState::Done, Some("b 做的"), 2_000_100)
                    .unwrap();
            })
        };

        let started = Instant::now();
        let outcome = wait(
            &manager,
            TEAM,
            &members(&[A]),
            WaitUntil::Declared,
            Duration::from_secs(2),
        )
        .await
        .unwrap();
        let elapsed = started.elapsed();
        mutator.await.unwrap();

        let WaitOutcome::TargetGone {
            member_id,
            snapshot,
        } = outcome
        else {
            panic!("必须因 A 消亡而返回 TargetGone，实际 {outcome:?}");
        };
        // ① 报的是 **A**，不是接手者 B。
        assert_eq!(member_id, A);
        assert!(
            elapsed < Duration::from_millis(500),
            "应当因 A 消亡立刻返回，实际 {elapsed:?}"
        );
        // ② 快照里只有 A 一行，不可能被 B 的完成满足。
        assert_eq!(snapshot.members.len(), 1);
        assert_eq!(snapshot.members[0].member_id, A);
        assert!(!satisfied(&snapshot, WaitUntil::Declared));
        // ③ 事后再查一次 A 的判据：B 已经真的做完了（否则下面两条是空断言）。
        assert_eq!(manager.verification(B), Some(DoneVerification::Verified));
        let after = build_snapshot(&manager, TEAM, &members(&[A])).unwrap();
        assert!(
            !satisfied(&after, WaitUntil::Declared),
            "B 完成了任务，但 A 的判据绝不允许被 B 的完成满足"
        );
    }

    // ───────────────────────────────────────────────────────────────
    // 载荷边界（红线 4）
    // ───────────────────────────────────────────────────────────────

    /// 快照键集恰好是规定的那些 —— **不含任何 transcript / 摘要字段**。
    ///
    /// 保护的不变量：`team_wait` 是长轮次调用，一旦返回体里出现正文，队长每等一次就把
    /// 对话拖进上下文一遍（红线 4 的团队版）。用**精确键集**而不是「不含某个词」，
    /// 因为新加的字段名完全可以不带 summary 字样。
    #[test]
    fn snapshot_carries_no_transcript() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager.claim_task("t1", A, now_millis()).unwrap();

        let member_snapshot = build_snapshot(&manager, TEAM, &members(&[A])).unwrap();
        let json = serde_json::to_value(&member_snapshot).unwrap();
        assert_eq!(
            sorted_keys(&json),
            vec!["members", "tasks", "teamId"],
            "快照顶层键集变了（`gone` 是控制信号，不得进载荷）"
        );
        assert_eq!(
            sorted_keys(&json["members"][0]),
            vec!["memberId", "name", "role", "state", "verification"]
        );

        let task_snapshot = build_snapshot(&manager, TEAM, &tasks(&["t1"])).unwrap();
        let json = serde_json::to_value(&task_snapshot).unwrap();
        assert_eq!(
            sorted_keys(&json["tasks"][0]),
            vec![
                "leaseRemainingSecs",
                "owner",
                "reclaimCount",
                "state",
                "taskId"
            ],
            "任务行不得带 summary / body / artifacts"
        );
    }

    fn sorted_keys(value: &serde_json::Value) -> Vec<&str> {
        let mut keys: Vec<&str> = value
            .as_object()
            .unwrap_or_else(|| panic!("必须是 object：{value}"))
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        keys
    }

    /// 快照只含**目标**：等 A 时不得带上全队花名册或整块板。
    #[test]
    fn snapshot_is_scoped_to_the_targets() {
        let manager = seeded();
        manager.create_task(task("t1")).unwrap();
        manager.create_task(task("t2")).unwrap();

        let snapshot = build_snapshot(&manager, TEAM, &members(&[A])).unwrap();
        assert_eq!(snapshot.members.len(), 1);
        assert!(snapshot.tasks.is_empty());

        let snapshot = build_snapshot(&manager, TEAM, &tasks(&["t2"])).unwrap();
        assert!(snapshot.members.is_empty());
        assert_eq!(snapshot.tasks.len(), 1);
        assert_eq!(snapshot.tasks[0].task_id, "t2");
    }

    /// 未加载的团队 → `NotFound`（而不是空快照 + 白等满 timeout）。
    #[tokio::test]
    async fn unknown_team_is_not_found() {
        let manager = seeded();
        let err = wait(
            &manager,
            "tm_nope",
            &members(&[A]),
            WaitUntil::Any,
            Duration::from_millis(10),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
    }
}
