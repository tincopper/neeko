//! 团队视图（**快照的唯一构造点**）—— 两个入口层共用：MCP 工具面（`mcp::dispatch::status`）
//! 与本地 Tauri 命令（`commands::team_snapshot` / `team_task_detail` / `team_member_detail`）。
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
    AdmissionTier, Artifact, DoneVerification, MemberRole, MemberState, TaskRef, Team, TeamMember,
    TeamState, TeamTask, TeamTaskState, WorkerChannel, Workspace,
};
use crate::common::error::AppError;

/// 任务板列路径的硬上限（[`TeamSnapshot::tasks`] 至多这么多行）。存在理由见模块文档。
pub const MAX_BOARD_TASKS: usize = 200;

/// 成员详情里事件流的上界（[`MemberDetail::events`] 至多这么多条）。
///
/// 事件表**只追加**：一个队跑久了会上万条（一次派活就写 `claim` + `update` 两条）。
/// 抽屉开着时每秒都在重取（租约走动靠前端定时器，脉冲靠后端的每次写），所以这条读路径
/// 必须**在 SQL 里就有上界**，而不是「读全量再截」—— 后者正是红线 4 的时间维度破法。
///
/// 50 条的选法：一屏抽屉只看得到十几条，用户要翻更早的应该去审计（库里的 `team_event`
/// 才是全量），而不是让每次脉冲刷新都搬一遍整部历史。
pub const MAX_MEMBER_EVENTS: usize = 50;

/// 团队列表的硬上限（[`TeamList::teams`] 至多这么多行）。
///
/// # 为什么团队列表也要有界（历史团队会一直累积）
///
/// 与 [`MAX_BOARD_TASKS`] 同一条红线 4 纪律：**单次载荷不许无界**。任务板的上界是「一个
/// 团队最多多少活」，这里的是「这台机器上曾经有多少队」—— 后者只增不减（app 重启会
/// hydrate 全部历史团队），所以更需要一个明确的截断点，而不是靠「用户不会建很多队」。
///
/// 超出时**不报错、不静默丢**：置 [`TeamList::truncated`]，面板能说「只显示了最近 50 个」。
pub const MAX_LISTED_TEAMS: usize = 50;

/// 团队列表的一条（`team_list` 工具 / `team_list` 命令的同一份载荷）。
///
/// # 为什么没有花名册与任务行
///
/// 这是**选队**用的列表，不是「某一个队的视图」：多带一列就是给「重启后重开自己的队」
/// 这件事多传一份用不上的数据（红线 4）。要看内容用 `team_id` 去拉 `team_status` /
/// `team_snapshot`。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamSummary {
    /// 团队 id（下一步的入口参数）。
    pub team_id: String,
    /// 用户可读名字。
    pub name: String,
    /// 团队状态（`active` / `closing` / `closed`）—— 面板据此决定「能重开」还是「只读」。
    pub state: TeamState,
    /// 团队根（归一化后的绝对路径）。
    pub project_path: std::path::PathBuf,
    /// 队长用哪个 CLI（面板显示「这个队是 claude-code 带的」）。
    pub lead_agent_id: String,
    /// 建队时间（epoch 毫秒）。
    pub created_at: i64,
    /// 关闭时间；`None` = 未关闭。
    pub closed_at: Option<i64>,
    /// **成员数（不含队长，含已 `Dead` 的成员）**。
    ///
    /// 与 `TeamManager::member_count` **同源**（同一个数字也用于 `team_options` 的
    /// 「还能加几个」与 `team_spawn` 的上限判据）。刻意**不**在这里改成「只数活着的」：
    /// 那样同一个队会有两个不同的成员数（面板说 2、`team_options` 说 3），而偏差只在
    /// 「刚好卡在上限」时显形。已关闭的成员仍占名额 —— 那是上限判据的事实。
    pub member_count: u32,
    /// 板上任务总数。
    pub task_total: usize,
    /// 未终结的任务数（`pending`/`claimed`/`in_progress`/`awaiting_approval`/`proposed`）。
    pub task_open: usize,
    /// 已完成的任务数。
    pub task_done: usize,
}

/// 团队列表（`team_list` 的两条入口共用）：行 + 是否被 [`MAX_LISTED_TEAMS`] 截断。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamList {
    /// 最近的团队（`created_at` 倒序，同毫秒按 id 升序 —— 排序必须稳定，否则面板每次
    /// 重取都会换一个顺序）。
    pub teams: Vec<TeamSummary>,
    /// 是否还有更早的团队没被列出。
    pub truncated: bool,
}

/// 团队状态视图（`team_status` 工具回复 + 面板顶部摘要的同一份载荷）。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamStatusView {
    /// 团队 id。
    pub team_id: String,
    /// 团队状态。
    pub team_state: TeamState,
    /// **成员数（不含队长，含已 `Dead` 的成员）**。
    ///
    /// 与 [`TeamSummary::member_count`] **同源**（同一个 `TeamManager::member_count`：它也供
    /// `team_options` 的「还能加几个」与 `team_spawn` 的上限判据用）。
    ///
    /// # 为什么这里必须有它（而不是让调用方数 `members.len()`）
    ///
    /// 花名册**含队长**（队长也要在面板上被看见），所以 `members.len()` 恒比「成员数」大 1。
    /// 让前端自己减一，等于把「谁是队长」这条域规则搬到展示层 —— 而同一个队于是有了两个成员
    /// 数：头部（`members.length`）与团队清单行（`memberCount`）。判据：
    /// `the_two_faces_of_a_team_report_the_same_member_count`。
    pub member_count: u32,
    /// 成员花名册（六态徽标契约）。
    pub members: Vec<MemberStatusView>,
    /// 板上任务总数。
    pub task_total: usize,
    /// 未终结的任务数（`pending`/`claimed`/`in_progress`/`awaiting_approval`/`proposed`）。
    pub task_open: usize,
    /// 已完成的任务数。
    pub task_done: usize,
}

/// 花名册一行：**身份 + 状态 + 它能被打开的那个终端** —— 不含任何正文。
///
/// [`Self::verification`] 是 AC2 的判据：「成员说完了（`Idle`）但任务仍 `in_progress`」与
/// 「成员声明做完了」在花名册上必须可区分（`idle` + `unverified` ⇔ 「空闲 ⚠ 未声明」）。
/// 只给 `state` 是不够的 —— 两者都可能落在 `idle`。
///
/// # 为什么带上 `terminal_id` / `agent_id` / `workspace` / `channel` / `tier`
///
/// 面板要能回答三件事：**「这是谁」**（`agent_id` + `tier` 决定能力边界）、**「它在哪干活」**
/// （`workspace`）、**「我怎么看它」**（`terminal_id`）。
///
/// 前两件是花名册的 chip，第三件是「点一下打开成员终端」的**唯一**凭据：成员是 Neeko 起的
/// PTY（§7.1），会话 id 只在团队域里，前端不可能自己推出来（红线 12：不许从路径/名字拼）。
/// 少了它，成员进程虽然在跑，用户却只能看见队长 —— 那正是「看着一队 agent 干活」的反面。
///
/// 这五项都是**恒定小字段**（id / 枚举 / 一个可选路径），没有摘要、没有正文（红线 4）。
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
    /// 这个成员跑的是哪个 CLI（`AgentConfig.id`）—— 花名册上的第一枚 chip。
    pub agent_id: String,
    /// 它那个 PTY 的会话 id（`None` = 还没有进程：没起来 / 起失败 / 已关掉）。
    ///
    /// **这是「打开成员终端」的唯一入口凭据**。`None` 与「有 id 但会话已死」是两件事：
    /// 前者前端不该给按钮，后者点了会得到终端的可读错误 —— 前端不预判哪一种。
    pub terminal_id: Option<String>,
    /// 它在哪个工作区干活（共享团队根 / 独立 worktree / 只读）。
    pub workspace: Workspace,
    /// 怎么**发**消息给它（CLI 成员恒为 `Pty`，见 design §4.4）。
    pub channel: WorkerChannel,
    /// 准入档位（A/B/C）—— 能力缺口的唯一出处（红线 14）。
    pub tier: AdmissionTier,
}

/// 任务板上的一行（**不含 [`TeamTask::body`]**，见模块文档）。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCard {
    /// 任务 id —— **只在 [`Self::team_id`] 之内唯一**。
    ///
    /// 两列必须一起传：`t1` 在每个队都有，只拿 `id` 去请求详情会让后端无从判断
    /// 用户点的是哪个队的 `t1`（[`TaskRef`] 就是那个配对）。
    pub id: String,
    /// 所属团队 —— 面板拿一张卡片就能凑出 `team_task_detail(team_id, task_id)` 的两个参数，
    /// 不必去猜它的父级（猜错 = 静默看到别队的任务）。
    pub team_id: String,
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
            team_id: task.team_id.clone(),
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

/// 一条审计记录的**成员详情视图**（**不**带 `id` / `team_id`：抽屉已经知道它在看谁）。
///
/// `kind` 是开集字符串（见 `store::TeamEventRecord` 的文档）—— 前端不得把它当封闭枚举用，
/// 未知类别要能原样显示，否则一次新增事件类型会让抽屉里的那一行变成空白。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberEventView {
    /// 发生时间（epoch 毫秒）。
    pub at: i64,
    /// 事件类别（`claim` / `update` / `signal` / `close_member` …）。
    pub kind: String,
    /// 触发者：成员 id 或 `"system"` / 队长 id。
    pub actor: String,
    /// 被操作对象（任务 id / 成员 id）。
    pub subject: Option<String>,
    /// 附加上下文（后端写的短文本）。
    pub detail: Option<String>,
}

/// 成员详情的载荷（`team_member_detail`，**点开一个成员才拉**）。
///
/// # 为什么不是「快照里多带一份」
///
/// 花名册是**每行恒定小字段**（[`MemberStatusView`]），而这里有任务行 + 50 条事件：
/// 放进快照就是「每次脉冲刷新都搬一遍全部成员的全部事件」（红线 4 的时间维度）。
/// 只在抽屉打开时拉一次，关掉就不再有读请求。
///
/// # `awaiting_approval` 是 `tasks` 的子集（不是第二份推导）
///
/// AC5 的待批队列：`state == awaiting_approval` 且 `owner == 该成员`。它单独成字段是
/// **因为它在 UI 上置顶**，而不是因为它的判据与 `tasks` 不同 —— 两者由同一遍过滤产出，
/// 前端不得自己从 `tasks` 里筛（那样一旦抽屉折叠了「当前任务」块，待批块就会静默消失）。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberDetail {
    /// 花名册的**同一行**（复用 [`member_status_view`]，不是第二份花名册推导）。
    pub member: MemberStatusView,
    /// 该成员在飞的任务 + 它最近完成的任务（至多 [`MAX_BOARD_TASKS`] 行）。
    pub tasks: Vec<TaskCard>,
    /// `tasks` 是否被 [`MAX_BOARD_TASKS`] 截断（抽屉据此说「只显示前 N 条」）。
    pub tasks_truncated: bool,
    /// AC5 待批队列（`tasks` 里 `state == awaiting_approval` 的那几行）。
    pub awaiting_approval: Vec<TaskCard>,
    /// 最近 [`MAX_MEMBER_EVENTS`] 条审计（最新在前）。
    pub events: Vec<MemberEventView>,
    /// 是否还有更早的事件没被列出。
    pub events_truncated: bool,
}

/// 团队快照（面板的数据源）：团队行 + 花名册 + 任务板列。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamSnapshot {
    /// 团队行（id / 名字 / 根 / 状态 / 队长信息）。
    pub team: Team,
    /// 花名册（与 `team_status` 同一份推导）。
    pub members: Vec<MemberStatusView>,
    /// 成员数（**后端口径**：不含队长、含已退出的成员）。
    ///
    /// 与 `TeamStatusView::member_count` / `TeamSummary::member_count` **同一个访问器**
    /// （`TeamManager::member_count`）：同一个队只有这一个成员数。面板头曾经数
    /// `members.len()`（含队长），于是列表行写 3、点进去写 4 —— 不是两个视角，是同一事实的两个答案。
    pub member_count: u32,
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
        team_id: team.id.clone(),
        team_state: team.state,
        // 与团队清单的 `memberCount` 同一个数（同一个访问器，不是各数一遍）。
        member_count: manager.member_count(&team.id),
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
        member_count: manager.member_count(team_id),
        members,
        tasks_truncated: tasks.len() > MAX_BOARD_TASKS,
        tasks: tasks
            .iter()
            .take(MAX_BOARD_TASKS)
            .map(TaskCard::from_task)
            .collect(),
    })
}

/// 这台机器上有哪些团队（`team_list` 工具 + `team_list` 命令的同一份推导）。
///
/// # 为什么必须存在
///
/// app 重启会把历史团队 hydrate 进 `TeamManager`（`load`），而在此之前没有任何读路径能
/// 列出它们 —— 用户看不见、也重不开自己的队。这不是「面板的便利功能」，是「团队是否
/// 还存在」这个问题的唯一答案。
///
/// # 不按团队过滤
///
/// 返回**全部**团队：它回答的是「这台机器上有哪些队」，而不是「我所在的那个队」。
/// 授权上它与 `team_status` 同列（只读；见 `authorize`）。
///
/// # 排序与截断
///
/// `created_at` 倒序（最近的队在最上面），同毫秒按 `id` 升序。截断到
/// [`MAX_LISTED_TEAMS`] 并置 `truncated`（不是分页：面板只需要「最近的那些」）。
#[must_use]
pub fn list_teams(manager: &TeamManager) -> TeamList {
    let mut teams: Vec<Team> = manager.teams();
    teams.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    let truncated = teams.len() > MAX_LISTED_TEAMS;
    let summaries = teams
        .iter()
        .take(MAX_LISTED_TEAMS)
        .map(|team| {
            // **计数**而不是「取回全部任务再数」：`list_teams` 是每次面板脉冲都会走的读路径，
            // 而 `tasks()` 会在锁内把整段任务行 clone 出来（红线 4 的时间维度）。同一个推导
            // （`is_terminal_task`）只放在库层一处。
            let counts = manager.task_counts(&team.id);
            TeamSummary {
                team_id: team.id.clone(),
                name: team.name.clone(),
                state: team.state,
                project_path: team.project_path.clone(),
                lead_agent_id: team.lead_agent_id.clone(),
                created_at: team.created_at,
                closed_at: team.closed_at,
                // 与 `team_options` / `team_spawn` 上限判据同一个数（见字段文档）。
                member_count: manager.member_count(&team.id),
                task_total: counts.total,
                task_open: counts.open,
                task_done: counts.done,
            }
        })
        .collect();
    TeamList {
        teams: summaries,
        truncated,
    }
}

/// 单个任务的详情（点开才拉）。
///
/// 收 [`TaskRef`] 而不是 `task_id: &str`：`t1` 在每个队都存在，只给 id 的实现要么猜一个队、
/// 要么遍历全部队 —— 两种都会让「点开 A 队的 t1，看到 B 队的正文」成为可能
/// （判据：`task_detail_rejects_a_pair_that_does_not_belong`）。
pub fn task_detail(manager: &TeamManager, key: &TaskRef) -> Result<TaskDetail, AppError> {
    let task = manager
        .task(key)
        .ok_or_else(|| AppError::NotFound(format!("task `{key}` is not loaded")))?;
    Ok(TaskDetail {
        body: task.body.clone(),
        card: TaskCard::from_task(&task),
    })
}

/// 单个成员详情（抽屉的数据源）：花名册行 + 任务 + 待批队列 + 最近事件。
///
/// # 成员属于哪个队由**行自己**回答
///
/// 命令签名只有 `member_id`（成员 id 自带 `@{team}` 后缀，但这里**不拆字符串** —— 红线 12：
/// 身份不从字符串反解）。团队归属是 `team_member.team_id` 那一列的事实，直接用。
/// 所以「成员属于别的队」不需要调用方判：它的任务/事件自然只能从自己的队里读。
///
/// # 读路径的两半：内存 + 库
///
/// 任务走 `TeamManager` 的内存镜像（与快照同一份真相，存量小），事件走**库**的
/// [`crate::agent::team::store::TeamStore::member_events`]（只追加，必须 SQL 有界）。
/// 所以本函数会读库 —— 调用方必须在阻塞池里调（红线 3，见 `commands::team_member_detail`）。
///
/// # 已知缺口：「最近完成」没有时间列
///
/// `team_task` 没有 `completed_at`（完成时间只存在审计的 `update` 事件里），所以已完成那一段
/// 只能按 `claimed_at` 倒序近似。同一个成员的两个任务起租时间相同时按 id 升序兜底 ——
/// 排序必须**稳定**，否则每次脉冲重取都会换一遍行序。
pub fn member_detail(manager: &TeamManager, member_id: &str) -> Result<MemberDetail, AppError> {
    let member = manager
        .member(member_id)
        .ok_or_else(|| AppError::NotFound(format!("member `{member_id}` is not loaded")))?;
    let tasks = manager.tasks(&member.team_id);
    let now = now_millis();
    let row = member_status_view(manager, member.clone(), &tasks, now);

    // 「在飞」+「已完成」：花名册只回答「手上有什么在飞」，详情要能回答「刚干完什么」。
    let (mut active, mut done): (Vec<TaskCard>, Vec<TaskCard>) = tasks
        .iter()
        .filter(|task| task.owner.as_deref() == Some(member_id))
        .filter(|task| is_active(task.state) || task.state == TeamTaskState::Done)
        .map(TaskCard::from_task)
        .partition(|task| is_active(task.state));
    active.sort_by(|a, b| a.id.cmp(&b.id));
    // 已完成那一段：`claimed_at` 倒序（`None` 自然排在最后），同毫秒按 id 升序兜底。
    done.sort_by(|a, b| {
        b.claimed_at
            .cmp(&a.claimed_at)
            .then_with(|| a.id.cmp(&b.id))
    });

    let tasks_truncated = active.len() + done.len() > MAX_BOARD_TASKS;
    let mut bounded: Vec<TaskCard> = active.into_iter().chain(done).collect();
    bounded.truncate(MAX_BOARD_TASKS);
    // AC5 待批队列：从**截断之后**的 `tasks` 里筛。它自己的文档说「是 `tasks` 的子集」，而
    // 截断前筛会在「> 200 个在飞任务」时产出 `tasks` 里根本没有的卡片 —— 抽屉顶部于是出现
    // 一个点不开的待批项（面板拿 id 去拉详情只会得到 `NotFound`）。判据：
    // `the_approval_queue_is_a_subset_of_the_listed_tasks`。
    let awaiting_approval: Vec<TaskCard> = bounded
        .iter()
        .filter(|task| task.state == TeamTaskState::AwaitingApproval)
        .cloned()
        .collect();

    let (records, events_truncated) =
        manager
            .store()
            .member_events(&member.team_id, member_id, MAX_MEMBER_EVENTS)?;
    let events = records
        .into_iter()
        .map(|record| MemberEventView {
            at: record.at,
            kind: record.kind,
            actor: record.actor,
            subject: record.subject,
            detail: record.detail,
        })
        .collect();

    Ok(MemberDetail {
        member: row,
        tasks_truncated,
        tasks: bounded,
        awaiting_approval,
        events,
        events_truncated,
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
        .map(|member| member_status_view(manager, member, tasks, now))
        .collect())
}

/// 花名册**一行**的构造（全仓唯一）。
///
/// 两处消费者：全量花名册（[`roster`]）与成员详情（[`member_detail`]）。分成两份推导的话，
/// 同一个人在花名册与抽屉里会得到「两种租约剩余秒」/「两种取证水位线」—— 而这类偏差只在
/// 数字不对的时候才被发现。
fn member_status_view(
    manager: &TeamManager,
    member: TeamMember,
    tasks: &[TeamTask],
    now: i64,
) -> MemberStatusView {
    MemberStatusView {
        lease_remaining_secs: lease_remaining_secs(tasks, &member.id, now),
        // 取证缺失（内存里没有该行）= 未声明。`Verified` 只能由显式声明写出来，
        // 所以缺省取 `Unverified` 是唯一不会「凭空宣布做完」的方向。
        verification: manager
            .verification(&member.id)
            .unwrap_or(DoneVerification::Unverified),
        agent_id: member.agent_id.clone(),
        terminal_id: member.terminal_id.clone(),
        workspace: member.workspace.clone(),
        channel: member.channel,
        tier: member.tier,
        member_id: member.id,
        name: member.name,
        role: member.role,
        state: member.state,
    }
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
    use crate::agent::team::types::{MemberRole, MemberSignal, Team, TeamMember};
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

    /// 花名册必须带出「打开这个成员终端」的凭据。
    ///
    /// 成员的 PTY 是 Neeko 起的（design §7.1），会话 id 只存在团队域里；前端不可能从
    /// 名字/路径推出来（红线 12）。所以 `terminal_id` 要么在这一行上，要么这个成员
    /// **没有第二种方式被看见** —— 而「只看得见队长」正是这个测试要钉住的失败模式。
    #[test]
    fn a_roster_row_carries_the_terminal_it_runs_in() {
        let manager = seeded();
        manager
            .set_member_terminal(W1, "term-1", 1)
            .expect("bind terminal");

        let view = team_status_view(&manager, TEAM).expect("status");
        let w1 = view
            .members
            .iter()
            .find(|row| row.member_id == W1)
            .expect("w1 在花名册里");

        assert_eq!(w1.terminal_id.as_deref(), Some("term-1"));
        // 另外三项是同一行的「这是谁 / 在哪干活」：缺了它们花名册只剩名字与徽标。
        assert_eq!(w1.agent_id, fixture_member(W1, TEAM).agent_id);
        assert_eq!(w1.channel, WorkerChannel::Pty);
        assert_eq!(w1.workspace, Workspace::Shared);
    }

    /// 没有进程的成员（没起来 / 起失败 / 已关掉）→ `terminal_id` 是 `None`。
    ///
    /// 前端据此**不给**「打开终端」按钮；后端不替它猜（`None` 与「id 已死」是两件事）。
    /// 同一行的其它事实照旧在 —— 缺的是进程，不是这个成员。
    #[test]
    fn a_member_without_a_process_has_no_terminal() {
        let manager = seeded();
        manager
            .add_member(TeamMember {
                terminal_id: None,
                ..fixture_member("w3@tm_1", TEAM)
            })
            .expect("w3");

        let view = team_status_view(&manager, TEAM).expect("status");
        let w3 = view
            .members
            .iter()
            .find(|row| row.member_id == "w3@tm_1")
            .expect("w3 在花名册里");
        assert!(w3.terminal_id.is_none());
        assert_eq!(w3.agent_id, "claude-code", "成员身份不因没进程而消失");
        // 对照：同一份视图里，有进程的成员仍然是 `Some`（证明这一列跟着行走，
        // 不是「全部 None」这种看起来也通过的实现）。
        assert!(view
            .members
            .iter()
            .any(|row| row.member_id == W1 && row.terminal_id.is_some()));
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
    /// **三个面必须是同一个成员数**：`team_status`（工具面）/ `team_snapshot`（面板快照）/
    /// `list_teams`（团队清单）。
    ///
    /// 各自数一遍是这类缺陷的温床：面板头数 `members.len()`（含队长）、列表行用后端口径
    /// （不含队长），于是列表写 3、点进去写 4 —— 用户看到的是同一个事实的两个答案。
    #[test]
    fn every_face_of_a_team_reports_the_same_member_count() {
        // `seeded()` 已经放了一个队长 + w1 + w2 ⇒ worker 两个。
        let manager = seeded();

        let status = team_status_view(&manager, TEAM).expect("status");
        let snapshot = team_snapshot(&manager, TEAM).expect("snapshot");
        let listed = list_teams(&manager).teams.into_iter().next().expect("一行");

        assert_eq!(status.member_count, 2, "worker 两个");
        assert_eq!(snapshot.member_count, status.member_count);
        assert_eq!(listed.member_count, status.member_count);
        // 花名册行数 = 成员数 + 队长：两个数回答两个问题，但**差值是固定的 1**。
        assert_eq!(status.members.len(), status.member_count as usize + 1);
    }

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
        assert_eq!(
            keys,
            vec!["memberCount", "members", "tasks", "tasksTruncated", "team"]
        );

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
                // 任务 id 只在队内唯一 ⇒ 卡片必须自带 `teamId`，面板才能凑出
                // `team_task_detail(teamId, taskId)` 的两个参数（不必去猜父级）。
                "teamId",
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

        let detail = task_detail(&manager, &TaskRef::new(TEAM, "t1")).expect("detail");
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

        let err = task_detail(&manager, &TaskRef::new(TEAM, "t404")).expect_err("未知任务");
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
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, now)
            .expect("claim");
        manager
            .update_task(
                &TaskRef::new(TEAM, "t1"),
                W1,
                TeamTaskState::InProgress,
                None,
                now,
            )
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
            .update_task(
                &TaskRef::new(TEAM, "t1"),
                W1,
                TeamTaskState::Done,
                Some("done"),
                now + 20,
            )
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
        let _ = task_detail(&manager, &TaskRef::new(TEAM, "t1")).expect("detail");
        let _ = member_detail(&manager, W1).expect("member detail");

        assert!(recorder.pulses().is_empty(), "读路径不得发脉冲");
        assert_eq!(manager.epoch(), before, "读路径不得改动代数");
    }

    /// 花名册的租约剩余秒由在飞任务推导（`None` 与 `Some(0)` 语义不同）。
    #[test]
    fn the_roster_derives_lease_remaining_from_the_live_task() {
        let manager = seeded();
        manager.create_task(task("t1")).expect("t1");
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, now_millis())
            .expect("claim");

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

    // ───────────────────────────────────────────────────────────────
    // 两个面的口径（`team_status` 与团队清单）
    // ───────────────────────────────────────────────────────────────

    /// **同一个队，两个面必须报同一个成员数**（机器形式）。
    ///
    /// # 靶子
    ///
    /// `team_status` 的花名册**含队长**（队长也要在面板上被看见），而团队清单行的
    /// `memberCount` **不含队长**。面板头部一度用 `members.length`、列表行用 `memberCount`
    /// —— 同一个队于是显示两个成员数，而偏差只在「刚好卡在上限」时才被当成 bug。
    ///
    /// 所以 `TeamStatusView.member_count` 与 `TeamSummary.member_count` 必须来自**同一个**
    /// 访问器（`TeamManager::member_count`），这条断言是那件事的唯一机器判据。
    #[test]
    fn the_two_faces_of_a_team_report_the_same_member_count() {
        let manager = seeded();
        // 已 `Dead` 的成员仍计入（它是上限判据的事实，见 `TeamSummary::member_count` 的文档）。
        manager.finish_member_close(W2, 5_000).expect("close w2");

        let status = team_status_view(&manager, TEAM).expect("status");
        let list = list_teams(&manager);
        let summary = list
            .teams
            .iter()
            .find(|row| row.team_id == TEAM)
            .expect("本队在清单里");

        assert_eq!(
            status.member_count, summary.member_count,
            "`team_status` 与 `team_list` 必须是同一个数（同一份推导）"
        );
        // 口径：**不含队长**（花名册含队长，所以两者恒差 1 是正常的 —— 这正是不能拿
        // `members.len()` 当成员数的原因）。
        assert_eq!(status.member_count, 2, "两个 worker（含已 Dead 的 w2）");
        assert_eq!(
            status.members.len(),
            3,
            "花名册含队长（所以 `members.length` 不能当成员数）"
        );
    }

    // ───────────────────────────────────────────────────────────────
    // 成员详情（抽屉的数据源 + AC5 待批队列）
    // ───────────────────────────────────────────────────────────────

    /// 一个手里有活、有待批、也干完过一件活的成员 —— 三个桶各一行，外加别人的一行。
    fn seeded_with_member_work() -> TeamManager {
        let manager = seeded();
        manager
            .set_member_terminal(W1, "term-w1", 1)
            .expect("terminal");
        for id in ["t_live", "t_await", "t_done", "t_other"] {
            manager.create_task(task(id)).expect("task");
        }
        manager
            .claim_task(&TaskRef::new(TEAM, "t_live"), W1, 1_000)
            .expect("claim");
        manager
            .update_task(
                &TaskRef::new(TEAM, "t_live"),
                W1,
                TeamTaskState::InProgress,
                None,
                1_100,
            )
            .expect("in_progress");
        manager
            .claim_task(&TaskRef::new(TEAM, "t_await"), W1, 1_000)
            .expect("claim");
        manager
            .update_task(
                &TaskRef::new(TEAM, "t_await"),
                W1,
                TeamTaskState::AwaitingApproval,
                None,
                1_100,
            )
            .expect("awaiting");
        manager
            .claim_task(&TaskRef::new(TEAM, "t_done"), W1, 1_000)
            .expect("claim");
        manager
            .update_task(
                &TaskRef::new(TEAM, "t_done"),
                W1,
                TeamTaskState::Done,
                Some("done"),
                1_100,
            )
            .expect("done");
        manager
            .claim_task(&TaskRef::new(TEAM, "t_other"), W2, 1_000)
            .expect("claim");
        manager
    }

    /// AC5 待批队列必须是 `tasks` 的**子集** —— 哪怕任务多到被截断。
    ///
    /// # 靶子
    ///
    /// `awaiting_approval` 若从**截断前**的 `active` 里筛，超过 [`MAX_BOARD_TASKS`] 个在飞任务
    /// 时它就会包含 `tasks` 里没有的卡片。抽屉顶部于是出现一个点不开的待批项（面板拿它的 id
    /// 去拉详情只会得到 `NotFound`），而这一条恰好违反了该字段自己的文档（「是 `tasks` 的子集」）。
    ///
    /// 造法：先塞满 [`MAX_BOARD_TASKS`] 个 `pending` 任务（排序靠前，占满截断窗口），**最后**
    /// 才造那个 `awaiting_approval` 的任务（id 排序靠后 ⇒ 一定落在截断之后）。
    #[test]
    fn the_approval_queue_is_a_subset_of_the_listed_tasks() {
        let manager = seeded();
        // `t0000`…`t0199` 是 `pending`（`is_active` 为假 ⇒ 不进 `active`），所以先造一批
        // **在飞**任务把 `active` 撑到截断线：认领之后转 `in_progress`。
        for index in 0..MAX_BOARD_TASKS {
            let id = format!("t{index:04}");
            manager.create_task(task(&id)).expect("task");
            manager
                .claim_task(&TaskRef::new(TEAM, &id), W1, 1_000)
                .expect("claim");
            manager
                .update_task(
                    &TaskRef::new(TEAM, &id),
                    W1,
                    TeamTaskState::InProgress,
                    None,
                    1_100,
                )
                .expect("in_progress");
        }
        // 待批的那一件：id 排在最后 ⇒ 截断之后。
        let last = "t_await";
        manager.create_task(task(last)).expect("task");
        manager
            .claim_task(&TaskRef::new(TEAM, last), W1, 1_000)
            .expect("claim");
        manager
            .update_task(
                &TaskRef::new(TEAM, last),
                W1,
                TeamTaskState::AwaitingApproval,
                None,
                1_100,
            )
            .expect("awaiting");

        let detail = member_detail(&manager, W1).expect("detail");
        assert!(detail.tasks_truncated, "前置条件：这一屏必须是被截断的");
        assert_eq!(detail.tasks.len(), MAX_BOARD_TASKS);

        let listed: std::collections::HashSet<&str> =
            detail.tasks.iter().map(|row| row.id.as_str()).collect();
        for row in &detail.awaiting_approval {
            assert!(
                listed.contains(row.id.as_str()),
                "待批队列里有 `tasks` 没有的卡片（`{}`）—— 抽屉会给一个点不开的项",
                row.id
            );
        }
    }

    /// 抽屉的三个块各来自哪里：花名册**同一行** + 在飞/已完成的**它自己的**任务 + AC5 待批队列。
    ///
    /// 变异验证：把 `tasks` 的 `owner == member_id` 过滤去掉 → 别人的行漏进来，第二条断言变红；
    /// 把 `awaiting_approval` 改成「板上所有待批」→ 第三条断言变红。
    #[test]
    fn a_member_detail_carries_its_row_tasks_and_approval_queue() {
        let manager = seeded_with_member_work();

        let detail = member_detail(&manager, W1).expect("detail");
        // 花名册那一行与 `team_snapshot` 是**同一份推导**（同一个人不能有两种租约剩余秒）。
        let snapshot = team_snapshot(&manager, TEAM).expect("snapshot");
        let row = snapshot
            .members
            .iter()
            .find(|row| row.member_id == W1)
            .expect("w1");
        assert_eq!(&detail.member, row, "详情里的成员行必须是花名册的同一行");
        assert_eq!(detail.member.terminal_id.as_deref(), Some("term-w1"));

        let ids: Vec<&str> = detail.tasks.iter().map(|task| task.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["t_await", "t_live", "t_done"],
            "在飞（按 id）在前、已完成在后；别人的 t_other 不许出现"
        );

        let queue: Vec<&str> = detail
            .awaiting_approval
            .iter()
            .map(|task| task.id.as_str())
            .collect();
        assert_eq!(
            queue,
            vec!["t_await"],
            "AC5 待批队列 = 在飞且 state=awaiting"
        );

        assert!(detail.events.iter().any(|event| event.kind == "claim"));
    }

    /// 事件过滤**两边都算**：`actor == 成员`（它自己认领/上报）与 `subject == 成员`
    /// （队长把它关了、系统判它的信号陈旧）
    /// —— 只按 `actor` 过滤时「队长把它关了」会从抽屉里消失。
    ///
    /// 变异验证：把 `member_events` 的过滤改成只按 `actor` → 本用例变红。
    #[test]
    fn a_member_detail_reads_events_from_both_sides_of_the_audit_row() {
        let manager = seeded();
        // `claim`：actor 是成员，subject 是任务。
        manager.create_task(task("t1")).expect("t1");
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .expect("claim");
        // `close_member`：actor 是队长，**subject 才是成员**（归档成员的唯一审计来源）。
        manager.finish_member_close(W1, 2_000).expect("close w1");

        let detail = member_detail(&manager, W1).expect("detail");
        let kinds: Vec<&str> = detail
            .events
            .iter()
            .map(|event| event.kind.as_str())
            .collect();
        assert!(
            kinds.contains(&"close_member"),
            "队长关了它这件事必须在它的抽屉里可见：{kinds:?}"
        );
        assert!(
            kinds.contains(&"claim"),
            "它自己认领的任务也要在：{kinds:?}"
        );
        // 「最新在前」：id DESC，所以归档那条排在认领前面。
        assert_eq!(kinds.first().copied(), Some("close_member"), "{kinds:?}");
        // 别人身上发生的事不许串进来。
        let w2 = member_detail(&manager, W2).expect("w2 detail");
        assert!(w2.events.is_empty(), "{}", w2.events.len());
    }

    /// 事件流**有界**：超过 [`MAX_MEMBER_EVENTS`] 时只回 50 条 + 置 `events_truncated`，
    /// 且留下的是**最新的**那 50 条（不是最老的）。
    ///
    /// 上界在 SQL 里（`LIMIT`）—— 本用例只能钉住「给出来的行数与顺序」，
    /// 「没有把全量读进内存」这一半靠代码审查（见 C21 报告的诚实面）。
    #[test]
    fn a_member_detail_is_bounded_and_flags_it() {
        let manager = seeded();
        manager
            .observe_signal(W1, MemberSignal::TurnCompleted, 1_000)
            .expect("signal");
        // 每一条 `signal` 都会写一条 `subject = 成员` 的审计（走真实写路径，不是手塞行）。
        for tick in 0..MAX_MEMBER_EVENTS {
            let at = i64::try_from(tick).expect("小整数") + 2_000;
            manager
                .observe_signal(W1, MemberSignal::TurnCompleted, at)
                .expect("signal");
        }

        let detail = member_detail(&manager, W1).expect("detail");
        assert_eq!(detail.events.len(), MAX_MEMBER_EVENTS, "事件流上界必须生效");
        assert!(detail.events_truncated, "截断必须让抽屉知道");
        let newest = detail.events.first().expect("非空").at;
        let oldest = detail.events.last().expect("非空").at;
        assert!(newest > oldest, "最新必须在前：{newest} / {oldest}");

        // 未超限时不得误报（否则「只显示最近 50 条」永远亮着）。
        let small = seeded();
        small
            .observe_signal(W1, MemberSignal::TurnCompleted, 1_000)
            .expect("signal");
        let detail = member_detail(&small, W1).expect("detail");
        assert!(!detail.events.is_empty());
        assert!(!detail.events_truncated);
    }

    /// 任务行也有上界 + 截断标记（红线 4）：脚本化的队长可以给一个人派几百个任务。
    #[test]
    fn a_member_detail_bounds_its_task_rows() {
        let manager = seeded();
        for index in 0..=MAX_BOARD_TASKS {
            let id = format!("t{index:04}");
            manager.create_task(task(&id)).expect("task");
            manager
                .claim_task(&TaskRef::new(TEAM, &id), W1, 1_000)
                .expect("claim");
            manager
                .update_task(
                    &TaskRef::new(TEAM, &id),
                    W1,
                    TeamTaskState::Done,
                    None,
                    1_100,
                )
                .expect("done");
        }

        let detail = member_detail(&manager, W1).expect("detail");
        assert_eq!(detail.tasks.len(), MAX_BOARD_TASKS);
        assert!(detail.tasks_truncated, "截断必须能说出来");
    }

    /// 未知成员 → `NotFound`，可读信息里带 id。
    #[test]
    fn an_unknown_member_detail_is_not_found() {
        let manager = seeded();
        let err = member_detail(&manager, "w404@tm_1").expect_err("未知成员");
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
        assert!(err.to_string().contains("w404@tm_1"), "{err}");
    }

    // ───────────────────────────────────────────────────────────────
    // `team_list`（重启后重开自己的队 / 关队前的清点）
    // ───────────────────────────────────────────────────────────────

    /// 一个只有团队行的内存库（`created_at` 可指定）。
    fn with_teams(teams: &[(&str, i64)]) -> TeamManager {
        let manager = TeamManager::new(TeamStore::open_in_memory().expect("in-memory store"));
        for (id, created_at) in teams {
            manager
                .create_team(Team {
                    created_at: *created_at,
                    ..fixture_team(id)
                })
                .expect("team");
        }
        manager
    }

    /// 排序：`created_at` 倒序（最近的队在最上面）。
    #[test]
    fn the_team_list_is_newest_first() {
        let manager = with_teams(&[("tm_a", 1_000), ("tm_c", 3_000), ("tm_b", 2_000)]);
        let list = list_teams(&manager);
        let ids: Vec<&str> = list
            .teams
            .iter()
            .map(|team| team.team_id.as_str())
            .collect();
        assert_eq!(ids, vec!["tm_c", "tm_b", "tm_a"]);
        assert!(!list.truncated);
    }

    /// 同毫秒建队时按 id 升序 —— 排序必须**稳定**，否则面板每次重取都换一个顺序。
    #[test]
    fn teams_created_in_the_same_millisecond_are_tied_by_id() {
        let manager = with_teams(&[("tm_b", 5_000), ("tm_a", 5_000)]);
        let ids: Vec<String> = list_teams(&manager)
            .teams
            .into_iter()
            .map(|team| team.team_id)
            .collect();
        assert_eq!(ids, vec!["tm_a".to_owned(), "tm_b".to_owned()]);
    }

    /// 空库 → 空数组（不是错误）。
    #[test]
    fn an_empty_store_lists_no_teams_and_no_truncation() {
        let manager = with_teams(&[]);
        let list = list_teams(&manager);
        assert!(list.teams.is_empty());
        assert!(!list.truncated);
    }

    /// 红线 4：列表必须有界 —— 超过 [`MAX_LISTED_TEAMS`] 时截断并置 `truncated`。
    ///
    /// 变异验证：删掉 `take(MAX_LISTED_TEAMS)` 或删掉 `truncated` 的计算时本用例变红。
    #[test]
    fn the_team_list_is_bounded_and_flagged() {
        let over = MAX_LISTED_TEAMS + 5;
        let teams: Vec<(String, i64)> = (0..over)
            .map(|index| {
                let offset = i64::try_from(index).expect("测试用的团队数远小于 i64::MAX");
                (format!("tm_{index:03}"), 1_000 + offset)
            })
            .collect();
        let refs: Vec<(&str, i64)> = teams
            .iter()
            .map(|(id, created_at)| (id.as_str(), *created_at))
            .collect();
        let manager = with_teams(&refs);

        let list = list_teams(&manager);
        assert_eq!(list.teams.len(), MAX_LISTED_TEAMS);
        assert!(list.truncated, "被截断时必须能说出来");
        // 留下的是**最近的**那 50 个（倒序取前 50）。
        assert_eq!(
            list.teams[0].team_id,
            format!("tm_{:03}", over - 1),
            "第一个必须是最新的队"
        );
        assert_eq!(
            list.teams[MAX_LISTED_TEAMS - 1].team_id,
            format!("tm_{:03}", over - MAX_LISTED_TEAMS)
        );
    }

    /// 一条摘要的字段口径：成员数**不含队长、含已 `Dead` 的成员**；任务三计数同板视图。
    ///
    /// 为什么已关闭的成员仍计入：那个数字也是 `team_options` 的「还能加几个」与
    /// `team_spawn` 的上限判据 —— 两个口径不一致时，偏差只在「刚好卡在上限」时显形。
    #[test]
    fn a_summary_counts_members_and_tasks_like_the_board_does() {
        let manager = seeded();
        manager.create_task(task("t1")).expect("t1");
        manager.create_task(task("t2")).expect("t2");
        manager
            .claim_task(&TaskRef::new(TEAM, "t1"), W1, 1_000)
            .expect("claim");
        manager
            .update_task(
                &TaskRef::new(TEAM, "t1"),
                W1,
                TeamTaskState::Done,
                None,
                2_000,
            )
            .expect("done");
        manager
            .observe_signal(W2, MemberSignal::Exited, 3_000)
            .expect("dead");

        let list = list_teams(&manager);
        let summary = &list.teams[0];
        assert_eq!(summary.team_id, TEAM);
        assert_eq!(summary.name, "T");
        assert_eq!(summary.state, TeamState::Active);
        assert_eq!(summary.closed_at, None);
        assert_eq!(summary.lead_agent_id, "claude-code");
        assert_eq!(
            summary.member_count, 2,
            "不含队长；已 Dead 的成员仍占名额（与上限判据同源）"
        );
        assert_eq!(summary.task_total, 2);
        assert_eq!(summary.task_done, 1);
        assert_eq!(summary.task_open, 1);
        assert!(
            summary.project_path.is_absolute(),
            "团队根必须是绝对路径：{:?}",
            summary.project_path
        );
    }

    /// 关闭后的队仍会出现在列表里，带 `closed_at`（面板据此显示「已归档」而不是「当前」）。
    #[test]
    fn a_closed_team_is_still_listed_with_its_closed_at() {
        let manager = seeded();
        manager.begin_team_close(TEAM, 1_000).expect("begin");
        for member_id in [W1, W2] {
            manager
                .finish_member_close(member_id, 1_000)
                .expect("close");
        }
        manager.finish_team_close(TEAM, 2_000).expect("seal");

        let summary = &list_teams(&manager).teams[0];
        assert_eq!(summary.state, TeamState::Closed);
        assert_eq!(summary.closed_at, Some(2_000));
    }
}
