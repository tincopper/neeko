//! 团队视图（**快照的唯一构造点**）—— 两个入口层共用：MCP 工具面（`mcp::dispatch::status`）
//! 与本地 Tauri 命令（`commands::team_snapshot` / `team_task_detail`）。
//!
//! # 为什么视图构造不在入口层
//!
//! 两个消费者都是**入口层**（一个面向模型、一个面向前端），谁都不能拥有视图构造：让 MCP 侧
//! 拥有，面板就得复制一份；让面板拥有，`team_status` 与面板就会各自解释「租约剩余秒」是
//! 怎么算的。而这类推导的漂移是静默的 —— 两边都自洽，只是数字不同。
//!
//! 所以：**推导一份**（本文件），入口层只做「翻译 / 授权 / 校验」与「取快照」。
//!
//! # 红线 4 的结构性落点：`body` 不进列路径
//!
//! [`TeamTask::body`] 是**派活正文**（prompt），长度无上限。列路径（[`TaskCard`]）里没有这个
//! 字段，所以「列载荷无界」在类型层面就不可能发生 —— 不是靠调用方自律，是靠**没有那个字段**。
//! 要正文只有两条路：`team_task_detail`（点开才拉，与「成员 transcript 按需拉取」同一条原则）
//! 或 MCP 的 `task_list`（那边的契约见 `mcp::dispatch`）。
//!
//! [`TaskCard::summary`] 是另一件事：它由 `store::clamp_summary` 硬截到 4 KiB 并带
//! `summary_truncated` 标记，所以可以进列。
//!
//! # [`MAX_BOARD_TASKS`] 不是分页
//!
//! 它是**列载荷上界**：一个团队正常有几十个任务，但「正常」不是保证。没有上界时，一个
//! 脚本化的队长可以造出几千行任务板，而前端每次脉冲都要把整块板拉一遍 —— 那就是红线 4
//! 在时间维度上的破法（单次载荷不大，但每次都大）。超出时**不报错、不静默丢**：置
//! [`TeamSnapshot::tasks_truncated`] 让面板能说「只显示了前 200 个」，真分页是面板自己的事。

use crate::agent::team::manager::{now_millis, TeamManager};
use crate::agent::team::types::{
    Artifact, DoneVerification, MemberRole, MemberState, Team, TeamState, TeamTask, TeamTaskState,
    Workspace,
};
use crate::common::error::AppError;

/// 任务板列路径的硬上限（[`TeamSnapshot::tasks`] 至多这么多行）。存在理由见模块文档。
pub const MAX_BOARD_TASKS: usize = 200;

/// 团队状态视图（`team_status` 工具回复 + 面板顶部摘要的同一份载荷）。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamStatusView {
    /// 团队 id。
    pub team_id: String,
    /// 团队状态。
    pub team_state: TeamState,
    /// 成员花名册（六态徽标契约）。
    pub members: Vec<MemberStatusView>,
    /// 板上任务总数。
    pub task_total: usize,
    /// 未终结的任务数（`pending`/`claimed`/`in_progress`/`awaiting_approval`/`proposed`）。
    pub task_open: usize,
    /// 已完成的任务数。
    pub task_done: usize,
}

/// 花名册一行。**只有 id / 名字 / 角色 / 状态 / 取证 / 租约剩余秒** —— 不含任何正文。
///
/// [`Self::verification`] 是 AC2 的判据：「成员说完了（`Idle`）但任务仍 `in_progress`」与
/// 「成员声明做完了」在花名册上必须可区分（`idle` + `unverified` ⇔ 「空闲 ⚠ 未声明」）。
/// 只给 `state` 是不够的 —— 两者都可能落在 `idle`。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberStatusView {
    /// 成员 id。
    pub member_id: String,
    /// 用户可读名字。
    pub name: String,
    /// 角色。
    pub role: MemberRole,
    /// 六态之一。
    pub state: MemberState,
    /// 取证水位线：`verified` = 有 L2 显式声明背书；`unverified` = 只有 L1 回合信号。
    pub verification: DoneVerification,
    /// 手上在飞任务的租约剩余秒（无在飞任务 = `None`，已超时 = `Some(0)`）。
    pub lease_remaining_secs: Option<i64>,
}

/// 任务板上的一行（**不含 [`TeamTask::body`]**，见模块文档）。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCard {
    /// 任务 id。
    pub id: String,
    /// 标题。
    pub title: String,
    /// 任务状态。
    pub state: TeamTaskState,
    /// 持有者成员 id。
    pub owner: Option<String>,
    /// 工作区。
    pub workspace: Workspace,
    /// 依赖的任务 id。
    pub depends_on: Vec<String>,
    /// 起租时间（epoch 毫秒）。
    pub claimed_at: Option<i64>,
    /// 租约时长（秒）。
    pub lease_ttl: i64,
    /// 结果摘要（落库时已硬截到 4 KiB）。
    pub summary: Option<String>,
    /// 摘要是否被截断。
    pub summary_truncated: bool,
    /// 产物引用（只存定位信息）。
    pub artifacts: Vec<Artifact>,
    /// 被回收次数。
    pub reclaim_count: u32,
}

impl TaskCard {
    /// 从完整任务行取列视图。**唯一**的转换点（第二个转换点 = 第二个「哪些字段进列」的答案）。
    #[must_use]
    pub fn from_task(task: &TeamTask) -> Self {
        Self {
            id: task.id.clone(),
            title: task.title.clone(),
            state: task.state,
            owner: task.owner.clone(),
            workspace: task.workspace.clone(),
            depends_on: task.depends_on.clone(),
            claimed_at: task.claimed_at,
            lease_ttl: task.lease_ttl,
            summary: task.summary.clone(),
            summary_truncated: task.summary_truncated,
            artifacts: task.artifacts.clone(),
            reclaim_count: task.reclaim_count,
        }
    }
}

/// 一个任务的详情（`team_task_detail`）：列视图 + 派活正文。
///
/// `body` 只在**点开**时才拉（design §7.3 的同一条原则：成员 transcript 也不默认上行）。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetail {
    /// 列视图的同一份字段（`flatten` 到线上是平铺的，不是嵌套对象）。
    #[serde(flatten)]
    pub card: TaskCard,
    /// 派活正文（长度无上限 —— 这就是它不在列路径里的原因）。
    pub body: String,
}

/// 团队快照（面板的数据源）：团队行 + 花名册 + 任务板列。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamSnapshot {
    /// 团队行（id / 名字 / 根 / 状态 / 队长信息）。
    pub team: Team,
    /// 花名册（与 `team_status` 同一份推导）。
    pub members: Vec<MemberStatusView>,
    /// 任务板列（至多 [`MAX_BOARD_TASKS`] 行）。
    pub tasks: Vec<TaskCard>,
    /// 任务行是否被 [`MAX_BOARD_TASKS`] 截断（面板据此显示「只显示前 N 个」）。
    pub tasks_truncated: bool,
}

/// `team_status` 的载荷（MCP 工具面）。
pub fn team_status_view(manager: &TeamManager, team_id: &str) -> Result<TeamStatusView, AppError> {
    let team = loaded_team(manager, team_id)?;
    let tasks = manager.tasks(team_id);
    let members = roster(manager, team_id, &tasks, now_millis())?;
    Ok(TeamStatusView {
        team_id: team.id,
        team_state: team.state,
        members,
        task_total: tasks.len(),
        task_open: tasks.iter().filter(|task| is_open(task.state)).count(),
        task_done: tasks
            .iter()
            .filter(|task| task.state == TeamTaskState::Done)
            .count(),
    })
}

/// 面板快照（本地 Tauri 入口）。
pub fn team_snapshot(manager: &TeamManager, team_id: &str) -> Result<TeamSnapshot, AppError> {
    let team = loaded_team(manager, team_id)?;
    let tasks = manager.tasks(team_id);
    let members = roster(manager, team_id, &tasks, now_millis())?;
    Ok(TeamSnapshot {
        team,
        members,
        tasks_truncated: tasks.len() > MAX_BOARD_TASKS,
        tasks: tasks
            .iter()
            .take(MAX_BOARD_TASKS)
            .map(TaskCard::from_task)
            .collect(),
    })
}

/// 单个任务的详情（点开才拉）。
pub fn task_detail(manager: &TeamManager, task_id: &str) -> Result<TaskDetail, AppError> {
    let task = manager
        .task(task_id)
        .ok_or_else(|| AppError::NotFound(format!("task `{task_id}` is not loaded")))?;
    Ok(TaskDetail {
        body: task.body.clone(),
        card: TaskCard::from_task(&task),
    })
}

/// 团队行；未知 id 一律 `NotFound`（可读信息里带 id —— 前端据此判断「团队被关了」还是「拉错了」）。
fn loaded_team(manager: &TeamManager, team_id: &str) -> Result<Team, AppError> {
    manager
        .team(team_id)
        .ok_or_else(|| AppError::NotFound(format!("team `{team_id}` is not loaded")))
}

/// 花名册：成员行（库）+ 取证（内存）+ 租约剩余秒（由板上在飞任务推导）。
///
/// 成员行走库读（`TeamManager` 只暴露 `member(member_id)`，全量列在 `store` 上）；
/// 取证走内存（它刻意不落库，见 `TeamManager::derive_verification` 的文档）。
fn roster(
    manager: &TeamManager,
    team_id: &str,
    tasks: &[TeamTask],
    now: i64,
) -> Result<Vec<MemberStatusView>, AppError> {
    let mut members = manager.store().list_members(team_id)?;
    members.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(members
        .into_iter()
        .map(|member| MemberStatusView {
            lease_remaining_secs: lease_remaining_secs(tasks, &member.id, now),
            // 取证缺失（内存里没有该行）= 未声明。`Verified` 只能由显式声明写出来，
            // 所以缺省取 `Unverified` 是唯一不会「凭空宣布做完」的方向。
            verification: manager
                .verification(&member.id)
                .unwrap_or(DoneVerification::Unverified),
            member_id: member.id,
            name: member.name,
            role: member.role,
            state: member.state,
        })
        .collect())
}

/// 在飞的任务态（租约判据）。
const fn is_active(state: TeamTaskState) -> bool {
    matches!(
        state,
        TeamTaskState::Claimed | TeamTaskState::InProgress | TeamTaskState::AwaitingApproval
    )
}

/// 未终结的任务态（`task_open` 的判据）。
const fn is_open(state: TeamTaskState) -> bool {
    !matches!(
        state,
        TeamTaskState::Done | TeamTaskState::Failed | TeamTaskState::Blocked
    )
}

/// 成员手上在飞任务的租约剩余秒。
///
/// `None` = 没有在飞任务（不是 0）；`Some(0)` = 已超时但尚未被回收 —— 两者在 UI 上
/// 必须可区分（一个是在干活，一个是该回收了）。
fn lease_remaining_secs(tasks: &[TeamTask], member_id: &str, now: i64) -> Option<i64> {
    let task = tasks
        .iter()
        .find(|task| task.owner.as_deref() == Some(member_id) && is_active(task.state))?;
    let claimed_at = task.claimed_at?;
    let deadline = claimed_at.saturating_add(task.lease_ttl.saturating_mul(1000));
    Some(deadline.saturating_sub(now).max(0) / 1000)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::team::fixtures::{fixture_member, fixture_team, RecordingNotifier, TEAM, W1};
    use crate::agent::team::manager::TeamManager;
    use crate::agent::team::store::TeamStore;
    use crate::agent::team::types::{MemberRole, MemberSignal, TeamMember};
    use std::sync::Arc;

    const LEAD: &str = "lead@tm_1";
    const W2: &str = "w2@tm_1";

    fn seeded() -> TeamManager {
        let manager = TeamManager::new(TeamStore::open_in_memory().expect("in-memory store"));
        manager.create_team(fixture_team(TEAM)).expect("team");
        manager
            .add_member(TeamMember {
                role: MemberRole::Lead,
                ..fixture_member(LEAD, TEAM)
            })
            .expect("lead");
        manager.add_member(fixture_member(W1, TEAM)).expect("w1");
        manager.add_member(fixture_member(W2, TEAM)).expect("w2");
        manager
    }

    fn task(id: &str) -> TeamTask {
        TeamTask {
            id: id.into(),
            team_id: TEAM.into(),
            title: "do it".into(),
            body: "派活正文：这段长度无上限，列路径里绝不允许出现".into(),
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

    /// 红线 4：**线上**不许出现 `body`。
    ///
    /// 断言的是序列化后的 `Value`，不是结构体字段：结构体没有字段不代表 wire 上没有
    /// （`flatten` / `skip_serializing_if` / 手动 impl 都能把它们送出去）。这一条判据的唯一
    /// 可靠形态就是「看真正发给前端的那份 JSON」。
    #[test]
    fn the_snapshot_json_carries_no_task_body() {
        let manager = seeded();
        manager.create_task(task("t1")).expect("t1");

        let snapshot = team_snapshot(&manager, TEAM).expect("snapshot");
        let json = serde_json::to_value(&snapshot).expect("serialize");

        // 键集逐字钉住：新增字段必须是有意识的决定，而不是顺手把整个 TeamTask 塞进来。
        let mut keys: Vec<&str> = json
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(keys, vec!["members", "tasks", "tasksTruncated", "team"]);

        // `team` 子对象把**团队配置**也带给前端（池 / 上限 / 三个缺省值）：前端的 TS 镜像
        // 下一轮才补，所以这里先把线上键集钉住 —— 键名错的症状是「面板上那五项恒为空」，
        // 而它不会报错。
        let mut team_keys: Vec<&str> = json["team"]
            .as_object()
            .expect("team object")
            .keys()
            .map(String::as_str)
            .collect();
        team_keys.sort_unstable();
        for needed in [
            "allowedAgentIds",
            "defaultApprovalPolicy",
            "defaultModel",
            "defaultWorkspace",
            "maxMembers",
        ] {
            assert!(
                team_keys.contains(&needed),
                "快照的 team 里缺 `{needed}`：{team_keys:?}"
            );
        }

        let task_json = json["tasks"][0].as_object().expect("task object");
        let mut task_keys: Vec<&str> = task_json.keys().map(String::as_str).collect();
        task_keys.sort_unstable();
        assert_eq!(
            task_keys,
            vec![
                "artifacts",
                "claimedAt",
                "dependsOn",
                "id",
                "leaseTtl",
                "owner",
                "reclaimCount",
                "state",
                "summary",
                "summaryTruncated",
                "title",
                "workspace",
            ]
        );
        assert!(
            !task_json.contains_key("body"),
            "列载荷里出现了 body（红线 4）：{json}"
        );
        // 递归兜底：任何层级的键都不得叫 body（防止将来被套进一个子对象）。
        assert!(
            !serde_json::to_string(&json)
                .expect("stringify")
                .contains("\"body\""),
            "快照的任意层级都不得出现 body 键：{json}"
        );
    }

    /// 点开才拉：`team_task_detail` 必须带回派活正文。
    #[test]
    fn the_task_detail_returns_the_body() {
        let manager = seeded();
        manager.create_task(task("t1")).expect("t1");

        let detail = task_detail(&manager, "t1").expect("detail");
        assert_eq!(detail.card.id, "t1");
        assert!(detail.body.contains("派活正文"));

        // 线上形态是**平铺**（`flatten`）：面板拿到的是一行，不是一个嵌套对象。
        let json = serde_json::to_value(&detail).expect("serialize");
        assert_eq!(json["id"], "t1");
        assert_eq!(json["body"], detail.body);
    }

    /// 列载荷上界：超过 [`MAX_BOARD_TASKS`] 时**截断 + 标记**，不静默丢也不报错。
    ///
    /// 任务用循环造（不写 200 个字面量）：这个数字的唯一来源必须是常量本身，测试里再写一遍
    /// 字数就等于把上限钉了两遍 —— 改常量时测试会以一个看不懂的理由失败。
    #[test]
    fn a_board_beyond_the_limit_is_truncated_and_flagged() {
        let manager = seeded();
        for index in 0..=MAX_BOARD_TASKS {
            manager
                .create_task(task(&format!("t{index:04}")))
                .expect("task");
        }

        let snapshot = team_snapshot(&manager, TEAM).expect("snapshot");
        assert_eq!(snapshot.tasks.len(), MAX_BOARD_TASKS, "列上界必须生效");
        assert!(snapshot.tasks_truncated, "截断必须让面板知道");

        // 未超限时不得误报（否则提示永远亮着，等于没有提示）。
        let small = seeded();
        small.create_task(task("t1")).expect("t1");
        let snapshot = team_snapshot(&small, TEAM).expect("snapshot");
        assert!(!snapshot.tasks_truncated);
    }

    /// 未知 id → `NotFound`，且可读信息里带 id（面板据此区分「被关了」与「拉错了」）。
    #[test]
    fn unknown_ids_are_not_found() {
        let manager = seeded();

        let err = team_snapshot(&manager, "tm_missing").expect_err("未知团队");
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
        assert!(err.to_string().contains("tm_missing"), "{err}");

        let err = task_detail(&manager, "t404").expect_err("未知任务");
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
        assert!(err.to_string().contains("t404"), "{err}");

        let err = team_status_view(&manager, "tm_missing").expect_err("未知团队");
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
    }

    /// AC2：成员 `turn_completed` 但任务仍 `in_progress` ⇒ 花名册上是
    /// 「空闲 ⚠ 未声明」（`idle` + `unverified`），且任务**留在进行中**。
    ///
    /// 这条断言是面板那个徽标的唯一数据来源：只有 `state` 的话「空闲」与「空闲但没声明」
    /// 长得一模一样，用户会以为活干完了。
    #[test]
    fn a_member_that_only_finished_its_turn_shows_idle_and_unverified() {
        let manager = seeded();
        manager.create_task(task("t1")).expect("t1");
        let now = now_millis();
        manager.claim_task("t1", W1, now).expect("claim");
        manager
            .update_task("t1", W1, TeamTaskState::InProgress, None, now)
            .expect("in_progress");

        // L1：回合结束（没有任何 `task_update(done)`）。
        manager
            .observe_signal(W1, MemberSignal::TurnCompleted, now + 10)
            .expect("signal");

        let snapshot = team_snapshot(&manager, TEAM).expect("snapshot");
        let member = snapshot
            .members
            .iter()
            .find(|row| row.member_id == W1)
            .expect("w1 在花名册里");
        assert_eq!(member.state, MemberState::Idle, "回合结束 = 空闲");
        assert_eq!(
            member.verification,
            DoneVerification::Unverified,
            "没有显式声明 ⇒ 未声明（AC2 的 ⚠）"
        );

        let task_row = snapshot
            .tasks
            .iter()
            .find(|row| row.id == "t1")
            .expect("t1 在板上");
        assert_eq!(
            task_row.state,
            TeamTaskState::InProgress,
            "「说完了」不等于「做完了」：任务必须留在进行中列"
        );

        // 反向：显式声明之后同一行必须变成 verified（否则 ⚠ 永远擦不掉）。
        manager
            .update_task("t1", W1, TeamTaskState::Done, Some("done"), now + 20)
            .expect("done");
        let snapshot = team_snapshot(&manager, TEAM).expect("snapshot");
        let member = snapshot
            .members
            .iter()
            .find(|row| row.member_id == W1)
            .expect("w1");
        assert_eq!(member.verification, DoneVerification::Verified);
    }

    /// 读路径（面板会反复调用）**零脉冲**且不改代数。
    ///
    /// 少了这条，「快照里发一次脉冲」这种写法（看起来无害）会让前端陷入
    /// 「收到脉冲 → 拉快照 → 又收到脉冲」的自维持循环。
    #[test]
    fn building_a_snapshot_emits_no_pulse() {
        let manager = seeded();
        manager.create_task(task("t1")).expect("t1");
        let recorder = Arc::new(RecordingNotifier::new());
        manager.set_notifier(recorder.clone());
        let before = manager.epoch();

        let _ = team_snapshot(&manager, TEAM).expect("snapshot");
        let _ = team_status_view(&manager, TEAM).expect("status");
        let _ = task_detail(&manager, "t1").expect("detail");

        assert!(recorder.pulses().is_empty(), "读路径不得发脉冲");
        assert_eq!(manager.epoch(), before, "读路径不得改动代数");
    }

    /// 花名册的租约剩余秒由在飞任务推导（`None` 与 `Some(0)` 语义不同）。
    #[test]
    fn the_roster_derives_lease_remaining_from_the_live_task() {
        let manager = seeded();
        manager.create_task(task("t1")).expect("t1");
        manager.claim_task("t1", W1, now_millis()).expect("claim");

        let snapshot = team_snapshot(&manager, TEAM).expect("snapshot");
        let w1 = snapshot
            .members
            .iter()
            .find(|row| row.member_id == W1)
            .expect("w1");
        let remaining = w1.lease_remaining_secs.expect("在飞任务必须有租约剩余秒");
        assert!((0..=1_800).contains(&remaining), "剩余秒 {remaining} 越界");
        let lead = snapshot
            .members
            .iter()
            .find(|row| row.member_id == LEAD)
            .expect("lead");
        assert_eq!(
            lead.lease_remaining_secs, None,
            "无在飞任务 = None（不是 0）"
        );
        assert_eq!(lead.role, MemberRole::Lead);
    }
}
