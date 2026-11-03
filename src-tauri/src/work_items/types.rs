//! 工作项域值类型 —— **纯数据 + 纯函数**（持久化与 IPC 两侧共用一份）。
//!
//! 三条结构性约束（与 `agent/team/types.rs` 同一套口径）：
//!
//! 1. 本文件只放数据与**纯函数**（阶段轨派生、枚举 ↔ 落库文本、载荷截断）。阶段流转的
//!    *判定* 在 [`crate::work_items::manager`]，持久化在 [`crate::work_items::store`] ——
//!    两份判断迟早会分叉。
//! 2. 时间一律 `i64` epoch 毫秒；结构体 `camelCase`（IPC 面向），枚举 `snake_case`
//!    （变体名同时也是落库的 TEXT 值：**改名即迁移**）。
//! 3. 枚举的落库文本只有 [`Priority::as_str`] 这一族一个来源。serde 的 `rename_all` 是
//!    第二份表示，判据 `every_enum_serialises_as_its_stored_text` 把两者钉在一起 ——
//!    否则「库里写 `running`、线上发 `Running`」这类漂移没有任何编译期信号。
//!
//! # 这一层**不认识**第三方 provider
//!
//! 本文件描述的是 Local Provider 的规范模型（design §3.2.1）。GitHub / Linear 的 DTO
//! 属于 provider 层，它们要映射到这里的字段而不是相反 —— 让本地模型背着「PR 的
//! `reviewDecision`」这类字段，等于把 MVP 之外的能力写进库的 schema。

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

/// 默认阶段轨（design §11.5）。顺序即流转方向，首项是新建工作项的缺省阶段。
pub const DEFAULT_STAGES: [&str; 5] = ["Backlog", "Ready", "In Progress", "Review", "Done"];

/// 执行记录快照文案的**字符**上限（design §4.6：执行区一行一条摘要，`label` ≤ 120 字符）。
pub const RUN_LABEL_MAX_CHARS: usize = 120;

// ═══════════════════════════════════════════════════════════════════
// 枚举（落库文本 = `as_str`）
// ═══════════════════════════════════════════════════════════════════

/// 优先级（design §3.1 的 `priority.rank` 在 Local Provider 里的最小形态）。
///
/// 库里存 `p0` / `p1` / `p2` / `p3`（人可读，`sqlite3` 能直接查），`NULL` = 未设。
/// 完整形态（`{ rank, label }`）要等第三方 provider 的状态机映射一起落地 —— 那时
/// `label` 是**平台原文**（"Urgent" / "P0 - Blocker"），不该由 Local 的枚举替它决定。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Priority {
    /// 最高（阻塞他人）。
    P0,
    /// 高。
    P1,
    /// 中（缺省档位的常见值）。
    P2,
    /// 低。
    P3,
}

impl Priority {
    /// 落库 / 上线文本（唯一来源）。
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::P0 => "p0",
            Self::P1 => "p1",
            Self::P2 => "p2",
            Self::P3 => "p3",
        }
    }
}

impl TryFrom<&str> for Priority {
    type Error = anyhow::Error;

    fn try_from(text: &str) -> Result<Self, Self::Error> {
        match text {
            "p0" => Ok(Self::P0),
            "p1" => Ok(Self::P1),
            "p2" => Ok(Self::P2),
            "p3" => Ok(Self::P3),
            other => bail!("unknown priority `{other}`, expected one of p0 | p1 | p2 | p3"),
        }
    }
}

/// 执行档位（design §3.4 的 `ExecutionMode`）。
///
/// 本期只有 `Single` 有写入方；`Team` / `Flow` 的**列**先存在，是因为指针 + 快照的形状
/// 与档位无关，而「加一列」要一次迁移、「枚举加一个变体」不要。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunMode {
    /// 一个 agent 会话干完（成本最低）。
    Single,
    /// 交给团队：队长经 MCP 拆活、成员认领。
    Team,
    /// 用户预先编排的固定流程（本期无引擎）。
    Flow,
}

impl RunMode {
    /// 落库 / 上线文本（唯一来源）。
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Single => "single",
            Self::Team => "team",
            Self::Flow => "flow",
        }
    }
}

impl TryFrom<&str> for RunMode {
    type Error = anyhow::Error;

    fn try_from(text: &str) -> Result<Self, Self::Error> {
        match text {
            "single" => Ok(Self::Single),
            "team" => Ok(Self::Team),
            "flow" => Ok(Self::Flow),
            other => bail!("unknown run mode `{other}`, expected one of single | team | flow"),
        }
    }
}

/// 指针指向哪个执行域（design §3.4 的 `ref.kind`）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunRefKind {
    /// agent 会话（`id` = sessionId）。
    Session,
    /// 团队（`id` = teamId，`sub` = 队内 taskId）。
    Team,
    /// 固定流程的一次运行（`id` = flowRunId）。
    Flow,
}

impl RunRefKind {
    /// 落库 / 上线文本（唯一来源）。
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Session => "session",
            Self::Team => "team",
            Self::Flow => "flow",
        }
    }
}

impl TryFrom<&str> for RunRefKind {
    type Error = anyhow::Error;

    fn try_from(text: &str) -> Result<Self, Self::Error> {
        match text {
            "session" => Ok(Self::Session),
            "team" => Ok(Self::Team),
            "flow" => Ok(Self::Flow),
            other => bail!("unknown run ref kind `{other}`, expected one of session | team | flow"),
        }
    }
}

/// 快照里的执行状态（design §3.4）。
///
/// **这是缓存，不是判定**：任何「做完了没有」的问题回执行域查；`Unknown` 是合法状态
/// —— 团队被删掉时不得假装 `Failed`（`10-30` 不变量 2）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    /// 已排队，尚未开始。
    Queued,
    /// 执行中。
    Running,
    /// 等审批 / 等输入。
    Awaiting,
    /// 执行域声明完成。
    Done,
    /// 执行域声明失败。
    Failed,
    /// 执行域已不可查（团队被删、会话丢失）。
    Unknown,
}

impl RunState {
    /// 落库 / 上线文本（唯一来源）。
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Awaiting => "awaiting",
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Unknown => "unknown",
        }
    }
}

impl TryFrom<&str> for RunState {
    type Error = anyhow::Error;

    fn try_from(text: &str) -> Result<Self, Self::Error> {
        match text {
            "queued" => Ok(Self::Queued),
            "running" => Ok(Self::Running),
            "awaiting" => Ok(Self::Awaiting),
            "done" => Ok(Self::Done),
            "failed" => Ok(Self::Failed),
            "unknown" => Ok(Self::Unknown),
            other => bail!(
                "unknown run state `{other}`, expected one of \
                 queued | running | awaiting | done | failed | unknown"
            ),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
// 阶段轨（纯函数，唯一判据）
// ═══════════════════════════════════════════════════════════════════

/// 一条**可执行**的阶段流转（`from` → `to`）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageTransition {
    /// 起点 stage（与 [`StagePlan::stages`] 逐字相等）。
    pub from: String,
    /// 终点 stage。
    pub to: String,
}

/// 本地工作项的阶段轨（design §3.2.1 的 `progress`）。
///
/// **不叫 `workflow`**：执行侧的 `flow` 是「预先编排的静态图」，两者撞名会让
/// 「工作项在哪个阶段」与「流程跑到第几步」变成同一个词（design §2.1）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagePlan {
    /// 阶段顺序（索引即位置，首项是新建工作项的缺省阶段）。
    pub stages: Vec<String>,
    /// 可执行流转。缺省只连**相邻**两两且双向：跨阶段直达会让「经过 Review」变成
    /// 一句没人执行的承诺（design §11.5 的灰色圆）。
    pub transitions: Vec<StageTransition>,
}

impl Default for StagePlan {
    fn default() -> Self {
        Self::from_stages(DEFAULT_STAGES.iter().copied().map(str::to_owned).collect())
    }
}

impl StagePlan {
    /// 由阶段顺序派生出「相邻两两、双向」的流转集合。
    ///
    /// 这是本 domain 里**唯一**产生 transitions 的地方：让调用方各自拼边，等于允许
    /// 「跨阶段也合法」和「单向轨」这两种互相矛盾的轨道同时存在。
    #[must_use]
    pub fn from_stages(stages: Vec<String>) -> Self {
        let mut transitions = Vec::with_capacity(stages.len().saturating_mul(2));
        for pair in stages.windows(2) {
            let (from, to) = (pair[0].clone(), pair[1].clone());
            transitions.push(StageTransition {
                from: from.clone(),
                to: to.clone(),
            });
            transitions.push(StageTransition { from: to, to: from });
        }
        Self {
            stages,
            transitions,
        }
    }

    /// 这个 stage 是否属于本轨（`create` 的输入校验用）。
    #[must_use]
    pub fn has_stage(&self, stage: &str) -> bool {
        self.stages.iter().any(|known| known == stage)
    }

    /// 新建工作项的缺省阶段 = 轨首项。
    ///
    /// 空轨退回 [`DEFAULT_STAGES`] 首项而不是报错：空轨是「配置坏了」，把一个可用的
    /// 缺省值换成一次失败，只会让用户连建一条工作项都做不到。
    #[must_use]
    pub fn initial_stage(&self) -> String {
        self.stages
            .first()
            .cloned()
            .unwrap_or_else(|| DEFAULT_STAGES[0].to_owned())
    }

    /// `from → to` 是否允许**直接**流转。
    ///
    /// 同阶段（`from == to`）返回 `false`：它不是一次流转，而是一次空操作 —— 允许它会让
    /// 「拖回原列」写一次 `updated_at`，列表顺序因此无故跳动。
    #[must_use]
    pub fn can_transition(&self, from: &str, to: &str) -> bool {
        self.transitions
            .iter()
            .any(|edge| edge.from == from && edge.to == to)
    }

    /// `stage` 的**直接可达**目标（按阶段顺序）。
    ///
    /// 未知 stage 返回空集合：调用方（`transition` 的拒绝消息）把它如实渲染成「没有合法
    /// 目标」，比在错误路径上再抛一次错更容易定位 —— 拒绝消息本身已经带着当前 stage。
    #[must_use]
    pub fn neighbors(&self, stage: &str) -> Vec<String> {
        self.transitions
            .iter()
            .filter(|edge| edge.from == stage)
            .map(|edge| edge.to.clone())
            .collect()
    }
}

// ═══════════════════════════════════════════════════════════════════
// 工作项
// ═══════════════════════════════════════════════════════════════════

/// 一条本地工作项（`work_item` 行）。
///
/// `stage` 是**自由文本**而不是枚举：阶段轨是可配置的（design §4.5 的
/// "Configure stages"），把它编译进枚举等于让自定义轨必须先改代码。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItem {
    /// 工作项 id，形如 `wi_<uuid v4>`。
    pub id: String,
    /// 归属项目 id（列表的唯一筛选维度：Tasks 是**项目级** inbox）。
    pub project_id: String,
    /// 标题（非空，已 trim）。
    pub title: String,
    /// 正文（markdown，可以为空；不 trim —— 正文的首行缩进有意义）。
    pub body: String,
    /// 当前 stage（属于 [`StagePlan::stages`]）。
    pub stage: String,
    /// 优先级；`None` = 未设。
    pub priority: Option<Priority>,
    /// 标签（已去空白、去空串、保序去重）。
    pub labels: Vec<String>,
    /// 负责人；`None` = 未分配。
    pub assignee: Option<String>,
    /// 创建时间（epoch 毫秒）。
    pub created_at: i64,
    /// 最后修改时间（epoch 毫秒）：`create` 时等于 `created_at`，任何写路径都必须推进它
    /// —— 列表按它倒序，不推进的表现是「刚改过的卡片沉在列表底部」。
    pub updated_at: i64,
}

/// 一次执行（`work_item_run` 行）：**WorkItem 是意图，Run 是执行**。
///
/// 只存「指针 + 轻量快照」：真相源在执行域，本行不得承载成员 / 团队任务明细
/// （design §3.4 的三方案对比，红线 4）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemRun {
    /// 执行记录 id，形如 `run_<uuid v4>`。
    pub id: String,
    /// 派生它的工作项。
    pub work_item_id: String,
    /// 执行档位。
    pub mode: RunMode,
    /// 指针：真相源在执行域，本字段只用于跳转与反查。
    ///
    /// Rust 侧叫 `run_ref`（`ref` 是关键字），线上键仍是 `ref` —— design §3.4 与前端
    /// 都按 `ref` 读，改键名等于改 IPC 契约。
    #[serde(rename = "ref")]
    pub run_ref: RunRef,
    /// 只读快照：离线渲染与列表徽标用，**永远不参与判定**。
    pub snapshot: RunSnapshot,
    /// 记录时间（epoch 毫秒）。
    pub created_at: i64,
}

/// 执行域里的指针（`{ kind, id, sub }`）。
///
/// 三个字段而不是三个变体：`session` / `team` / `flow` 的差别只有「去哪查」，而三种
/// 变体各自带一个必填 id 会让每一次「跳转」都要重新匹配一遍。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRef {
    /// 指向哪个域。
    pub kind: RunRefKind,
    /// 该域里的标识（sessionId / teamId / flowRunId）。
    pub id: String,
    /// 域内二级标识（团队的 `taskId` 等），可空。
    pub sub: Option<String>,
}

/// 执行状态快照（design §3.4）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSnapshot {
    /// 抓取时的状态。
    pub state: RunState,
    /// 原域文案（如「空闲 ⚠ 未声明」），≤ [`RUN_LABEL_MAX_CHARS`] 字符。
    pub label: String,
    /// 抓取时间（epoch 毫秒）：UI 拿它算陈旧度。
    pub captured_at: i64,
}

/// 把快照文案压到 [`RUN_LABEL_MAX_CHARS`] 个**字符**。
///
/// 按字符而不是字节切：`label` 是给人看的原文（「空闲 ⚠ 未声明」），按字节切会把多字节
/// 字符拦腰截断，写进库的就不是合法文本了。
///
/// 不加省略号：这是**载荷上界**（红线 4），视觉省略归 UI。在存量数据里塞一个由后端决定
/// 的省略号，会让「原文长度」在两侧口径不同。
#[must_use]
pub fn truncate_label(label: &str) -> String {
    label.chars().take(RUN_LABEL_MAX_CHARS).collect()
}

// ═══════════════════════════════════════════════════════════════════
// 写入口的输入
// ═══════════════════════════════════════════════════════════════════
//
// 这几个结构体是**域内**输入（命令层装配 → manager 校验），不跨 IPC：线上键是扁平的
// camelCase 参数（`invoke('work_item_create', { projectId, title, … })`），把它们塞进
// params 结构体会多一层嵌套（`{ params: { … } }`），与全仓 100+ 命令的口径不一致。
// 校验（空标题、未知 stage / priority、标签规范化）一律在 manager —— 那是唯一能同时
// 服务 UI 与未来 provider 写回路径的地方。

/// `create` 的输入。可空字段的 `None` = 缺省值（`body=""`、`labels=[]`、`stage=轨首项`）。
#[derive(Clone, Debug)]
pub struct CreateWorkItem {
    /// 归属项目 id（空串被拒）。
    pub project_id: String,
    /// 标题（trim 后为空被拒）。
    pub title: String,
    /// 正文；`None` = 空正文。
    pub body: Option<String>,
    /// 初始 stage；`None` = 轨首项。
    pub stage: Option<String>,
    /// 优先级文本（`p0`..`p3`）；`None` / 空串 = 未设。
    pub priority: Option<String>,
    /// 标签；`None` = 空集合。
    pub labels: Option<Vec<String>>,
    /// 负责人；`None` / 空串 = 未分配。
    pub assignee: Option<String>,
}

/// `update` 的输入（**没有 `stage` 字段**）。
///
/// # 可空字段的清除语义：空串 = 清空
///
/// Tauri 的扁平参数解码无法区分「没传」与「传了 `null`」（两者都落成 `Option::None`），
/// 所以「清空一个可空字段」在线上只能用**空串**表达。这不是偷懒：把一个清不掉的字段
/// 伪装成可编辑字段，才是真的缺陷（用户清掉负责人 → 保存 → 负责人还在）。
/// 清单：`priority = ""` → 未设；`assignee = ""` → 未分配；`labels = []` → 空集合；
/// `title = ""` → 被拒（标题是必填）；`body = ""` → 清空正文（合法）。
#[derive(Clone, Debug)]
pub struct UpdateWorkItem {
    /// 要改的工作项 id。
    pub id: String,
    /// 新标题；`None` = 不改。
    pub title: Option<String>,
    /// 新正文；`None` = 不改。
    pub body: Option<String>,
    /// 新优先级文本；`None` = 不改，`Some("")` = 清空。
    pub priority: Option<String>,
    /// 新标签（整批替换）；`None` = 不改。
    pub labels: Option<Vec<String>>,
    /// 新负责人；`None` = 不改，`Some("")` = 清空。
    pub assignee: Option<String>,
}

/// `record_run` 的输入（一次执行落库）。
///
/// 本期**没有**对应命令：写入方是 `run-single`（design §8.1 的 MVP 第三项），它在本域
/// 之外。先把形状定下来，是因为 `work_item_run` 的读取面（列表徽标、跳转）已经上线，
/// 没有写入方的读模型只能靠手工插库验证。
#[derive(Clone, Debug)]
pub struct NewRun {
    /// 派生它的工作项（不存在则 `NotFound`）。
    pub work_item_id: String,
    /// 执行档位。
    pub mode: RunMode,
    /// 执行域指针。
    pub run_ref: RunRef,
    /// 抓取到的状态。
    pub state: RunState,
    /// 原域文案（超长会被截到 [`RUN_LABEL_MAX_CHARS`]）。
    pub label: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 缺省的边 = 相邻两两、双向，没有跨阶段直达，也没有自环。
    #[test]
    fn default_plan_connects_only_adjacent_stages() {
        let plan = StagePlan::default();
        assert_eq!(
            plan.stages,
            DEFAULT_STAGES.map(str::to_owned).to_vec(),
            "阶段轨必须逐字等于 DEFAULT_STAGES"
        );
        assert_eq!(
            plan.transitions.len(),
            2 * (DEFAULT_STAGES.len() - 1),
            "4 个相邻关口 × 双向 = 8 条边；任何别的数字都意味着跨阶段或自环"
        );
        let pairs: Vec<(&str, &str)> = plan
            .transitions
            .iter()
            .map(|edge| (edge.from.as_str(), edge.to.as_str()))
            .collect();
        for stage in &plan.stages {
            assert!(
                !pairs.contains(&(stage.as_str(), stage.as_str())),
                "`{stage}` 不该有自环"
            );
        }
    }

    /// 正反两个方向都通过 —— 拖回上一列是合法动作（design §11.5 的灰色圆只挡跨阶段）。
    #[test]
    fn adjacent_transitions_work_in_both_directions() {
        let plan = StagePlan::default();
        for pair in DEFAULT_STAGES.windows(2) {
            assert!(
                plan.can_transition(pair[0], pair[1]),
                "{} -> {} 必须允许",
                pair[0],
                pair[1]
            );
            assert!(
                plan.can_transition(pair[1], pair[0]),
                "{} -> {} 必须允许",
                pair[1],
                pair[0]
            );
        }
    }

    /// 跨阶段直达被拒：必须一步步经过中间 stage。
    #[test]
    fn skipping_a_stage_is_rejected() {
        let plan = StagePlan::default();
        assert!(!plan.can_transition("Backlog", "Review"));
        assert!(!plan.can_transition("Backlog", "Done"));
        assert!(!plan.can_transition("In Progress", "Done"));
        assert!(!plan.can_transition("Ready", "Review"));
        // 反例的反照面：相邻的一步必须仍然通过，否则上面几条会被「全都拒」蒙过去。
        assert!(plan.can_transition("Ready", "In Progress"));
    }

    /// 未知 stage（两个方向都要拒）：输入错误不能被当成「没有边」以外的东西。
    #[test]
    fn unknown_stages_are_rejected() {
        let plan = StagePlan::default();
        assert!(!plan.can_transition("Nope", "Ready"));
        assert!(!plan.can_transition("Ready", "Nope"));
        assert!(!plan.can_transition("Nope", "Nope"));
        assert!(plan.neighbors("Nope").is_empty());
        assert!(!plan.has_stage("Nope"));
        assert!(plan.has_stage("In Progress"));
    }

    /// 同阶段不是流转（空操作会让列表顺序无故跳动）。
    #[test]
    fn a_stage_to_itself_is_not_a_transition() {
        let plan = StagePlan::default();
        for stage in &plan.stages {
            assert!(!plan.can_transition(stage, stage));
        }
    }

    /// 直接可达目标按阶段顺序给出（拒绝消息与 Stage Rail 都读它）。
    #[test]
    fn neighbors_are_the_direct_targets_in_stage_order() {
        let plan = StagePlan::default();
        assert_eq!(plan.neighbors("Backlog"), vec!["Ready".to_owned()]);
        assert_eq!(
            plan.neighbors("In Progress"),
            vec!["Ready".to_owned(), "Review".to_owned()]
        );
        assert_eq!(
            plan.neighbors("Review"),
            vec!["In Progress".to_owned(), "Done".to_owned()]
        );
        assert_eq!(plan.neighbors("Done"), vec!["Review".to_owned()]);
    }

    /// 缺省阶段 = 轨首项；空轨退回文档里的首项而不是让 create 失败。
    #[test]
    fn the_initial_stage_is_the_head_of_the_track() {
        assert_eq!(StagePlan::default().initial_stage(), DEFAULT_STAGES[0]);
        assert_eq!(
            StagePlan::from_stages(vec!["Todo".to_owned(), "Doing".to_owned()]).initial_stage(),
            "Todo"
        );
        assert_eq!(
            StagePlan::from_stages(Vec::new()).initial_stage(),
            DEFAULT_STAGES[0]
        );
    }

    /// 自定义轨同样只连相邻两两 —— 规则属于派生函数，不属于缺省值。
    #[test]
    fn a_custom_track_gets_the_same_adjacency_rule() {
        let plan = StagePlan::from_stages(vec![
            "Todo".to_owned(),
            "Doing".to_owned(),
            "Shipped".to_owned(),
        ]);
        assert_eq!(plan.transitions.len(), 4);
        assert!(plan.can_transition("Todo", "Doing"));
        assert!(plan.can_transition("Shipped", "Doing"));
        assert!(!plan.can_transition("Todo", "Shipped"));
    }

    /// 载荷上界按**字符**切，且短文案一个字都不动。
    #[test]
    fn truncate_label_respects_the_payload_bound() {
        let short = "空闲 ⚠ 未声明";
        assert_eq!(truncate_label(short), short);

        let exact = "a".repeat(RUN_LABEL_MAX_CHARS);
        assert_eq!(truncate_label(&exact), exact);

        let long = "中".repeat(RUN_LABEL_MAX_CHARS + 10);
        let cut = truncate_label(&long);
        assert_eq!(cut.chars().count(), RUN_LABEL_MAX_CHARS);
        // 按字节切会留下 40 个非法序列，按字符切不会。
        assert_eq!(cut.len(), RUN_LABEL_MAX_CHARS * "中".len());
    }

    /// 枚举的 serde 表示必须逐字等于落库文本 —— 否则库里与线上会用两套词汇。
    #[test]
    fn every_enum_serialises_as_its_stored_text() {
        let priorities = [Priority::P0, Priority::P1, Priority::P2, Priority::P3];
        for value in priorities {
            let text = value.as_str();
            assert_eq!(serde_json::to_value(value).unwrap(), json!(text));
            assert_eq!(Priority::try_from(text).unwrap(), value);
        }

        let modes = [RunMode::Single, RunMode::Team, RunMode::Flow];
        for value in modes {
            let text = value.as_str();
            assert_eq!(serde_json::to_value(value).unwrap(), json!(text));
            assert_eq!(RunMode::try_from(text).unwrap(), value);
        }

        let kinds = [RunRefKind::Session, RunRefKind::Team, RunRefKind::Flow];
        for value in kinds {
            let text = value.as_str();
            assert_eq!(serde_json::to_value(value).unwrap(), json!(text));
            assert_eq!(RunRefKind::try_from(text).unwrap(), value);
        }

        let states = [
            RunState::Queued,
            RunState::Running,
            RunState::Awaiting,
            RunState::Done,
            RunState::Failed,
            RunState::Unknown,
        ];
        for value in states {
            let text = value.as_str();
            assert_eq!(serde_json::to_value(value).unwrap(), json!(text));
            assert_eq!(RunState::try_from(text).unwrap(), value);
        }
    }

    /// 非法文本返回错误而不是 panic —— 库里出现脏值时，读路径必须能说清哪一列。
    #[test]
    fn unknown_enum_text_is_an_error_not_a_panic() {
        assert!(Priority::try_from("p9").is_err());
        assert!(
            Priority::try_from("P0").is_err(),
            "大小写不宽容（落库口径是小写）"
        );
        assert!(RunMode::try_from("").is_err());
        assert!(RunState::try_from("blocked").is_err());
        assert!(RunRefKind::try_from("team_task").is_err());
        assert!(RunMode::try_from("single").is_ok());
    }

    /// 前端读的是 `item.projectId` / `item.updatedAt`（同 `agent/team/types.rs`）。
    #[test]
    fn work_item_uses_camel_case_wire_keys() {
        let item = WorkItem {
            id: "wi_1".into(),
            project_id: "p1".into(),
            title: "Title".into(),
            body: "body".into(),
            stage: "Backlog".into(),
            priority: Some(Priority::P2),
            labels: vec!["bug".into()],
            assignee: Some("me".into()),
            created_at: 1,
            updated_at: 2,
        };
        let json = serde_json::to_value(&item).unwrap();
        let mut keys: Vec<&str> = json
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "assignee",
                "body",
                "createdAt",
                "id",
                "labels",
                "priority",
                "projectId",
                "stage",
                "title",
                "updatedAt",
            ]
        );
        assert_eq!(json["priority"], json!("p2"));
        assert_eq!(item, serde_json::from_value(json).unwrap());
    }

    /// 执行记录的线上形状：`ref`（关键字改名）+ `snapshot.capturedAt`。
    #[test]
    fn work_item_run_exposes_ref_and_captured_at() {
        let run = WorkItemRun {
            id: "run_1".into(),
            work_item_id: "wi_1".into(),
            mode: RunMode::Single,
            run_ref: RunRef {
                kind: RunRefKind::Session,
                id: "sess-1".into(),
                sub: None,
            },
            snapshot: RunSnapshot {
                state: RunState::Running,
                label: "空闲".into(),
                captured_at: 7,
            },
            created_at: 8,
        };
        let json = serde_json::to_value(&run).unwrap();
        assert_eq!(json["mode"], json!("single"));
        assert_eq!(json["ref"]["kind"], json!("session"));
        assert_eq!(json["ref"]["id"], json!("sess-1"));
        assert_eq!(json["snapshot"]["state"], json!("running"));
        assert_eq!(json["snapshot"]["capturedAt"], json!(7));
        assert_eq!(json["createdAt"], json!(8));
        assert_eq!(json["workItemId"], json!("wi_1"));
        assert_eq!(run, serde_json::from_value(json).unwrap());
    }

    /// 阶段轨的线上键：`stages` + `transitions[{from,to}]`。
    #[test]
    fn stage_plan_uses_camel_case_wire_keys() {
        let json = serde_json::to_value(StagePlan::default()).unwrap();
        assert_eq!(
            json["stages"].as_array().unwrap().len(),
            DEFAULT_STAGES.len()
        );
        assert_eq!(json["transitions"][0]["from"], json!("Backlog"));
        assert_eq!(json["transitions"][0]["to"], json!("Ready"));
    }
}
