//! 工作项域业务规则 —— 阶段流转合法性、时间戳推进、执行记录。
//!
//! # 同步 API（不是疏漏）
//!
//! 本地工作项落 SQLite，每个操作都是「一行读 / 一行写」的短事务。做成 `async` 只会把
//! 一次微秒级的同步调用塞进异步状态机，再逼调用方决定要不要 `spawn_blocking`（红线 3 的
//! 无意义形态）。真正需要阻塞池的是**长 I/O**（git、PTY、ssh），不是本地库。
//!
//! # 时间戳由「注入」而非「现取」
//!
//! 每条写路径都有一个私有 `*_at` 变体：公开方法用 [`now_millis`]，测试传自己的时钟。
//! 这让「`update` 必须推进 `updated_at`」这条断言不需要 `sleep`（sleep 会让这类测试
//! 在 CI 上又慢又偶发红）。
//!
//! # 错误口径
//!
//! 返回 [`AppError`]（同 `agent/team/manager.rs`）：业务拒绝是 `InvalidInput` / `NotFound`，
//! 库错误经 `From<anyhow::Error>` 落成 `Unknown`。**不要**在这一层 `unwrap` 任何东西 ——
//! 本域没有必需的不变量（`Now` 取不到时间也只会退化成 0）。

use crate::common::error::AppError;
use crate::work_items::store::WorkItemStore;
use crate::work_items::types::{
    truncate_label, CreateWorkItem, NewRun, Priority, RunSnapshot, StagePlan, UpdateWorkItem,
    WorkItem, WorkItemRun,
};

/// 工作项管理器：本域**唯一**的写入口。
pub struct WorkItemManager {
    store: WorkItemStore,
}

impl WorkItemManager {
    /// 包装一个 store。
    ///
    /// 与 [`WorkItemStore::with_pool`] 同一条前置条件：调用方必须已在这个池上跑过迁移链。
    #[must_use]
    pub const fn with_store(store: WorkItemStore) -> Self {
        Self { store }
    }

    /// 共享库（供组合根与测试）。
    #[must_use]
    pub const fn store(&self) -> &WorkItemStore {
        &self.store
    }

    /// 阶段轨（**唯一来源**）：`create` 的缺省阶段、`create` / `transition` 的合法性判定、
    /// 以及 `work_item_stage_plan` 这条命令读的都是它。
    ///
    /// 做成关了 manager 的关联函数而不是各调用点自己 `StagePlan::default()`：阶段轨将来
    /// 可配置（design §4.5 的 "Configure stages"），到那天只有这里需要长出血肉。
    /// 各写各的，就会出现「面板显示 5 个阶段、后端只认 4 个」。
    #[must_use]
    pub fn stage_plan() -> StagePlan {
        StagePlan::default()
    }

    // ═══════════════════════════════════════════════════════════════════
    // 读
    // ═══════════════════════════════════════════════════════════════════

    /// 一个项目的工作项（最近改过的在前）。
    pub fn list(&self, project_id: &str) -> Result<Vec<WorkItem>, AppError> {
        Ok(self.store.list(project_id)?)
    }

    /// 一个工作项（详情面板 / 跳转用）。
    pub fn get(&self, id: &str) -> Result<WorkItem, AppError> {
        self.require(id)
    }

    /// 一个工作项的执行记录（最新一条在前）。
    ///
    /// **不校验父项存在**：空列表就是「没有执行记录」的正确答案，而父项是否还在由
    /// `list` / `get` 负责回答。为一次已删除工作项弹 `NotFound` 只会让详情面板在删除的
    /// 同帧里多一条无意义的错误 toast。
    pub fn runs(&self, work_item_id: &str) -> Result<Vec<WorkItemRun>, AppError> {
        Ok(self.store.list_runs(work_item_id)?)
    }

    // ═══════════════════════════════════════════════════════════════════
    // 写（公开入口 → 注入时间的私有实现）
    // ═══════════════════════════════════════════════════════════════════

    /// 新建一条工作项。
    ///
    /// 拒绝：空标题（trim 后）、未知 stage、未知 priority、空 project_id。
    pub fn create(&self, input: CreateWorkItem) -> Result<WorkItem, AppError> {
        self.create_at(input, now_millis())
    }

    fn create_at(&self, input: CreateWorkItem, now: i64) -> Result<WorkItem, AppError> {
        let project_id = input.project_id.trim().to_owned();
        if project_id.is_empty() {
            return Err(AppError::InvalidInput(
                "`project_id` must not be empty".to_owned(),
            ));
        }
        let title = input.title.trim().to_owned();
        if title.is_empty() {
            return Err(AppError::InvalidInput(
                "`title` must not be empty".to_owned(),
            ));
        }

        let plan = Self::stage_plan();
        let stage = match input.stage {
            Some(raw) => Self::require_stage(&plan, raw.trim())?,
            None => plan.initial_stage(),
        };

        let item = WorkItem {
            id: new_work_item_id(),
            project_id,
            title,
            // 正文不 trim：markdown 的首行缩进 / 尾部空行都是有意义的输入。
            body: input.body.unwrap_or_default(),
            stage,
            priority: parse_priority(input.priority.as_deref())?,
            labels: normalize_labels(input.labels.unwrap_or_default()),
            assignee: input.assignee.and_then(non_empty),
            created_at: now,
            updated_at: now,
        };
        self.store.insert(&item)?;
        Ok(item)
    }

    /// 改字段（**不能**改 stage，那是 [`Self::transition`] 的活）。
    pub fn update(&self, input: UpdateWorkItem) -> Result<WorkItem, AppError> {
        self.update_at(input, now_millis())
    }

    fn update_at(&self, input: UpdateWorkItem, now: i64) -> Result<WorkItem, AppError> {
        let mut item = self.require(&input.id)?;

        if let Some(raw) = input.title {
            let title = raw.trim().to_owned();
            if title.is_empty() {
                return Err(AppError::InvalidInput(
                    "`title` must not be empty".to_owned(),
                ));
            }
            item.title = title;
        }
        if let Some(body) = input.body {
            item.body = body;
        }
        if let Some(raw) = input.priority {
            item.priority = parse_priority(Some(raw.as_str()))?;
        }
        if let Some(labels) = input.labels {
            item.labels = normalize_labels(labels);
        }
        if let Some(assignee) = input.assignee {
            // 空串 = 清空（见 [`UpdateWorkItem`] 的清除语义）。
            item.assignee = non_empty(assignee);
        }

        item.updated_at = now;
        if !self.store.update(&item)? {
            // 读到了又写不到 = 期间被删（或库被换掉）。如实报 NotFound，不假装保存成功。
            return Err(AppError::NotFound(format!(
                "work item `{}` disappeared before it could be updated",
                item.id
            )));
        }
        Ok(item)
    }

    /// 走一步阶段流转（**唯一**能改 stage 的入口）。
    ///
    /// 拒绝：未知目标 stage、跨阶段直跳、原地不动。消息里带当前 stage 与合法目标集合 ——
    /// 前端可以直接把它渲染成「你只能去 Ready / Review」。
    pub fn transition(&self, id: &str, to: &str) -> Result<WorkItem, AppError> {
        self.transition_at(id, to, now_millis())
    }

    fn transition_at(&self, id: &str, to: &str, now: i64) -> Result<WorkItem, AppError> {
        let mut item = self.require(id)?;
        let plan = Self::stage_plan();
        let to = to.trim();
        if !plan.can_transition(&item.stage, to) {
            return Err(AppError::InvalidInput(format!(
                "work item `{id}` cannot move from `{}` to `{to}` (allowed: {})",
                item.stage,
                render_targets(&plan, &item.stage)
            )));
        }

        item.stage = to.to_owned();
        item.updated_at = now;
        if !self.store.update(&item)? {
            return Err(AppError::NotFound(format!(
                "work item `{id}` disappeared before it could transition"
            )));
        }
        Ok(item)
    }

    /// 删除一条工作项（它的执行记录靠外键 CASCADE 一起消失）。
    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        if self.store.delete(id)? {
            Ok(())
        } else {
            Err(AppError::NotFound(format!(
                "work item `{id}` is not stored"
            )))
        }
    }

    /// 记一条执行记录（`WorkItemRun`）。
    ///
    /// 本期无命令暴露：写入方是 `run-single`（design §8.1）。读取面（列表徽标 + 跳转）
    /// 已经上线，所以这条形状先定下来，`run-single` 落地时只接线、不改表。
    pub fn record_run(&self, input: NewRun) -> Result<WorkItemRun, AppError> {
        self.record_run_at(input, now_millis())
    }

    fn record_run_at(&self, input: NewRun, now: i64) -> Result<WorkItemRun, AppError> {
        // 先问父项：直接插会让外键报错，而「work item 不存在」是一句用户能懂的话，
        // 「FOREIGN KEY constraint failed」不是。
        if self.store.get(&input.work_item_id)?.is_none() {
            return Err(AppError::NotFound(format!(
                "work item `{}` is not stored",
                input.work_item_id
            )));
        }

        let run = WorkItemRun {
            id: new_run_id(),
            work_item_id: input.work_item_id,
            mode: input.mode,
            run_ref: input.run_ref,
            snapshot: RunSnapshot {
                state: input.state,
                // 与 store 的截断同一个函数：返回给调用方的对象必须与落库的那一行逐字相同，
                // 否则「面板显示 130 字、重启后 120 字」—— 两份真相源。
                label: truncate_label(&input.label),
                captured_at: now,
            },
            created_at: now,
        };
        self.store.insert_run(&run)?;
        Ok(run)
    }

    // ═══════════════════════════════════════════════════════════════════
    // 内部
    // ═══════════════════════════════════════════════════════════════════

    /// 读一条必须存在的工作项。
    fn require(&self, id: &str) -> Result<WorkItem, AppError> {
        self.store
            .get(id)?
            .ok_or_else(|| AppError::NotFound(format!("work item `{id}` is not stored")))
    }

    /// `stage` 必须属于阶段轨；拒绝消息带上可选值（用户看得懂、前端不必再查一次轨）。
    ///
    /// 关联函数而不是方法：判据只与阶段轨有关，与哪个 manager 实例无关（`unused_self` 的
    /// 反面也是一条契约 —— 换掉 store 不会改变哪些 stage 合法）。
    fn require_stage(plan: &StagePlan, stage: &str) -> Result<String, AppError> {
        if plan.has_stage(stage) {
            Ok(stage.to_owned())
        } else {
            Err(AppError::InvalidInput(format!(
                "unknown stage `{stage}` (allowed: {})",
                plan.stages.join(" | ")
            )))
        }
    }
}

/// 当前时间（epoch 毫秒）。
///
/// 与 `agent::team::manager::now_millis` 同形但**不复用**：hub 域不该 import 执行域
/// （design §3.4 的单向依赖）。六行重复换掉一条跨域依赖是划算的。
fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// 新工作项 id：`wi_<uuid v4>`。
fn new_work_item_id() -> String {
    format!("wi_{}", uuid::Uuid::new_v4())
}

/// 新执行记录 id：`run_<uuid v4>`。
fn new_run_id() -> String {
    format!("run_{}", uuid::Uuid::new_v4())
}

/// 线上 `priority` 文本 → 枚举。
///
/// 空串等价于「未设」：前端的 select 在「无优先级」档位传的是 `""`（`None` 在扁平参数里
/// 表示「没传这个参数」，两件事不能混）。
fn parse_priority(raw: Option<&str>) -> Result<Option<Priority>, AppError> {
    let Some(text) = raw.map(str::trim).filter(|text| !text.is_empty()) else {
        return Ok(None);
    };
    Priority::try_from(text)
        .map(Some)
        .map_err(|err| AppError::InvalidInput(err.to_string()))
}

/// 空白即「没有」（负责人 / 优先级共用的清除语义）。
fn non_empty(raw: String) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_owned())
    }
}

/// 标签规范化：去空白、丢空串、保序去重。
///
/// 去重在这里而不是在 UI：同一次编辑的两次 IPC（拖拽 + 保存）会让库里出现重复标签，
/// 而列表按 `labels` 逐条出 chip —— 重复就是重复的 chip。
fn normalize_labels(labels: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(labels.len());
    for label in labels {
        let label = label.trim();
        if label.is_empty() || out.iter().any(|known| known == label) {
            continue;
        }
        out.push(label.to_owned());
    }
    out
}

/// 合法目标集合的渲染（空集合说「无」而不是留一个空串）。
fn render_targets(plan: &StagePlan, stage: &str) -> String {
    let targets = plan.neighbors(stage);
    if targets.is_empty() {
        "none".to_owned()
    } else {
        targets.join(" | ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::work_items::types::{RunMode, RunRef, RunRefKind, RunState, DEFAULT_STAGES};

    const T0: i64 = 1_700_000_000_000;

    fn manager() -> WorkItemManager {
        WorkItemManager::with_store(WorkItemStore::open_in_memory().unwrap())
    }

    fn create_input(title: &str) -> CreateWorkItem {
        CreateWorkItem {
            project_id: "p1".to_owned(),
            title: title.to_owned(),
            body: None,
            stage: None,
            priority: None,
            labels: None,
            assignee: None,
        }
    }

    fn update_input(id: &str) -> UpdateWorkItem {
        UpdateWorkItem {
            id: id.to_owned(),
            title: None,
            body: None,
            priority: None,
            labels: None,
            assignee: None,
        }
    }

    fn new_run(work_item_id: &str) -> NewRun {
        NewRun {
            work_item_id: work_item_id.to_owned(),
            mode: RunMode::Single,
            run_ref: RunRef {
                kind: RunRefKind::Session,
                id: "sess-1".to_owned(),
                sub: None,
            },
            state: RunState::Running,
            label: "空闲".to_owned(),
        }
    }

    /// 缺省的 stage 是轨首项，`created_at` 与 `updated_at` 同时刻，未设的可空字段是 `None`。
    #[test]
    fn create_defaults_to_the_first_stage() {
        let manager = manager();
        let item = manager.create_at(create_input("修个 bug"), T0).unwrap();

        assert!(
            item.id.starts_with("wi_"),
            "id 形如 wi_<uuid>，实际：{}",
            item.id
        );
        assert_eq!(item.stage, DEFAULT_STAGES[0]);
        assert_eq!(item.title, "修个 bug");
        assert_eq!(item.body, "", "缺省正文是空串而不是 NULL");
        assert_eq!(item.priority, None);
        assert!(item.labels.is_empty());
        assert_eq!(item.assignee, None);
        assert_eq!((item.created_at, item.updated_at), (T0, T0));
        assert_eq!(manager.get(&item.id).unwrap(), item, "写进去的要读得回来");
    }

    /// 空标题被拒（前后空白不算标题）。
    #[test]
    fn create_rejects_a_blank_title() {
        let manager = manager();
        let err = manager
            .create_at(create_input("   \t "), T0)
            .expect_err("空标题必须失败");
        assert!(
            matches!(err, AppError::InvalidInput(ref message) if message.contains("title")),
            "实际：{err:?}"
        );
    }

    /// 空 project_id 被拒：工作项是项目级事实，没有「不属于任何项目」的合法形态。
    #[test]
    fn create_rejects_an_empty_project_id() {
        let manager = manager();
        let mut input = create_input("T");
        input.project_id = "  ".to_owned();
        let err = manager
            .create_at(input, T0)
            .expect_err("空项目 id 必须失败");
        assert!(
            matches!(err, AppError::InvalidInput(ref message) if message.contains("project_id")),
            "实际：{err:?}"
        );
    }

    /// 未知 stage 被拒，且消息里带可选值（前端不必再拉一次阶段轨）。
    #[test]
    fn create_rejects_an_unknown_stage_listing_the_allowed_ones() {
        let manager = manager();
        let mut input = create_input("T");
        input.stage = Some("Doing".to_owned());
        let err = manager
            .create_at(input, T0)
            .expect_err("未知 stage 必须失败");
        let message = format!("{err:?}");
        assert!(message.contains("Doing"), "实际：{message}");
        for stage in DEFAULT_STAGES {
            assert!(message.contains(stage), "缺少可选值 {stage}：{message}");
        }
    }

    /// 标题 trim、标签去空白去重、优先级解析、空白负责人 → 未分配。
    #[test]
    fn create_normalises_its_inputs() {
        let manager = manager();
        let mut input = create_input("  带空白的标题  ");
        input.stage = Some(" Ready ".to_owned());
        input.priority = Some(" p1 ".to_owned());
        input.labels = Some(vec![
            " bug ".to_owned(),
            "bug".to_owned(),
            String::new(),
            "   ".to_owned(),
            "ui".to_owned(),
        ]);
        input.assignee = Some("   ".to_owned());

        let item = manager.create_at(input, T0).unwrap();
        assert_eq!(item.title, "带空白的标题");
        assert_eq!(item.stage, "Ready");
        assert_eq!(item.priority, Some(Priority::P1));
        assert_eq!(item.labels, vec!["bug".to_owned(), "ui".to_owned()]);
        assert_eq!(item.assignee, None, "空白负责人等于未分配");
    }

    /// 未知优先级文本被拒（不接受 `P0` 这种大小写变体：落库口径是小写）。
    #[test]
    fn create_rejects_an_unknown_priority() {
        let manager = manager();
        let mut input = create_input("T");
        input.priority = Some("P0".to_owned());
        let err = manager
            .create_at(input, T0)
            .expect_err("未知优先级必须失败");
        assert!(
            matches!(err, AppError::InvalidInput(ref message) if message.contains("p0")),
            "消息要列出可选值，实际：{err:?}"
        );
    }

    /// `update` 推进 `updated_at`，`created_at` 一动不动（时间戳由注入给出，不 sleep）。
    #[test]
    fn update_advances_updated_at_and_keeps_created_at() {
        let manager = manager();
        let created = manager.create_at(create_input("T"), T0).unwrap();

        let mut input = update_input(&created.id);
        input.title = Some("改过的标题".to_owned());
        let updated = manager.update_at(input, T0 + 5).unwrap();

        assert_eq!(updated.created_at, T0, "创建时间是不可变的");
        assert_eq!(updated.updated_at, T0 + 5);
        assert!(created.created_at <= created.updated_at);
        assert!(created.updated_at <= updated.updated_at);
        assert_eq!(manager.get(&created.id).unwrap(), updated);
    }

    /// `update` **改不了 stage**：这是编译期事实（`UpdateWorkItem` 没有该字段），
    /// 这条用例把它钉成行为契约 —— 绕过 transition 就等于绕过流转合法性。
    #[test]
    fn update_leaves_the_stage_alone() {
        let manager = manager();
        let created = manager.create_at(create_input("T"), T0).unwrap();

        let mut input = update_input(&created.id);
        input.title = Some("T2".to_owned());
        input.priority = Some("p3".to_owned());
        let updated = manager.update_at(input, T0 + 1).unwrap();

        assert_eq!(updated.stage, created.stage);
    }

    /// 不存在的 id → `NotFound`（不是静默成功，也不是 panic）。
    #[test]
    fn update_reports_not_found_for_an_unknown_id() {
        let manager = manager();
        let err = manager
            .update_at(update_input("wi_missing"), T0)
            .expect_err("未知 id 必须失败");
        assert!(matches!(err, AppError::NotFound(_)), "实际：{err:?}");
    }

    /// 空串 = 清空可空字段（Tauri 的扁平解码无法区分「没传」与「传了 null」）。
    #[test]
    fn update_clears_nullable_fields_with_an_empty_string() {
        let manager = manager();
        let mut input = create_input("T");
        input.priority = Some("p2".to_owned());
        input.assignee = Some("tincopper".to_owned());
        input.labels = Some(vec!["bug".to_owned()]);
        let created = manager.create_at(input, T0).unwrap();

        let mut input = update_input(&created.id);
        input.priority = Some(String::new());
        input.assignee = Some("   ".to_owned());
        input.labels = Some(Vec::new());
        let updated = manager.update_at(input, T0 + 1).unwrap();

        assert_eq!(updated.priority, None);
        assert_eq!(updated.assignee, None);
        assert!(updated.labels.is_empty());
    }

    /// 流转一次一步、可回退、且推进 `updated_at`。
    #[test]
    fn transition_walks_one_stage_at_a_time() {
        let manager = manager();
        let created = manager.create_at(create_input("T"), T0).unwrap();

        let ready = manager.transition_at(&created.id, "Ready", T0 + 1).unwrap();
        assert_eq!(ready.stage, "Ready");
        assert_eq!(ready.updated_at, T0 + 1);

        let back = manager
            .transition_at(&created.id, "Backlog", T0 + 2)
            .unwrap();
        assert_eq!(
            back.stage, "Backlog",
            "回到上一阶段是合法动作（不是单向轨）"
        );

        let again = manager.transition_at(&created.id, "Ready", T0 + 3).unwrap();
        assert_eq!(again.stage, "Ready");
        assert!(again.created_at <= again.updated_at);
    }

    /// 跨阶段直跳被拒，消息里带当前 stage 与合法目标集合。
    #[test]
    fn transition_rejects_a_skipped_stage_with_the_allowed_targets() {
        let manager = manager();
        let created = manager.create_at(create_input("T"), T0).unwrap();

        let err = manager
            .transition_at(&created.id, "Review", T0 + 1)
            .expect_err("跨阶段必须失败");
        let message = format!("{err:?}");
        assert!(
            message.contains("Backlog"),
            "当前 stage 必须在消息里：{message}"
        );
        assert!(
            message.contains("(allowed: Ready)"),
            "合法目标集合必须是相邻的那一个：{message}"
        );
        assert_eq!(
            manager.get(&created.id).unwrap().stage,
            DEFAULT_STAGES[0],
            "被拒的流转不得改库"
        );
    }

    /// 未知目标 / 原地不动都按非法流转拒绝。
    #[test]
    fn transition_rejects_unknown_and_identical_targets() {
        let manager = manager();
        let created = manager.create_at(create_input("T"), T0).unwrap();

        let err = manager
            .transition_at(&created.id, "Nope", T0 + 1)
            .expect_err("未知 stage 必须失败");
        assert!(matches!(err, AppError::InvalidInput(_)));

        let err = manager
            .transition_at(&created.id, DEFAULT_STAGES[0], T0 + 2)
            .expect_err("原地不动不是流转");
        assert!(matches!(err, AppError::InvalidInput(_)));
    }

    /// 不存在的 id → `NotFound`。
    #[test]
    fn transition_reports_not_found_for_an_unknown_id() {
        let manager = manager();
        let err = manager
            .transition_at("wi_missing", "Ready", T0)
            .expect_err("未知 id 必须失败");
        assert!(matches!(err, AppError::NotFound(_)), "实际：{err:?}");
    }

    /// 删除：第一次成功，第二次 `NotFound`（幂等被拒绝，不是静默成功）。
    #[test]
    fn delete_reports_not_found_on_the_second_call() {
        let manager = manager();
        let created = manager.create_at(create_input("T"), T0).unwrap();

        manager.delete(&created.id).unwrap();
        let err = manager.delete(&created.id).expect_err("重复删除必须失败");
        assert!(matches!(err, AppError::NotFound(_)), "实际：{err:?}");
    }

    /// 执行记录必须挂在存在的工作项上，且指针 + 快照原样落库。
    #[test]
    fn record_run_persists_the_pointer_and_the_snapshot() {
        let manager = manager();
        let created = manager.create_at(create_input("T"), T0).unwrap();

        let run = manager.record_run_at(new_run(&created.id), T0 + 7).unwrap();
        assert!(run.id.starts_with("run_"), "id 形如 run_<uuid>：{}", run.id);
        assert_eq!(run.work_item_id, created.id);
        assert_eq!(run.mode, RunMode::Single);
        assert_eq!(run.run_ref.kind, RunRefKind::Session);
        assert_eq!(run.snapshot.state, RunState::Running);
        assert_eq!(run.snapshot.captured_at, T0 + 7, "快照时间 = 记录时间");
        assert_eq!(manager.runs(&created.id).unwrap(), vec![run]);
    }

    /// 不存在的父项 → `NotFound`（而不是外键的英文报错）。
    #[test]
    fn record_run_reports_not_found_for_an_unknown_work_item() {
        let manager = manager();
        let err = manager
            .record_run_at(new_run("wi_missing"), T0)
            .expect_err("未知工作项必须失败");
        assert!(
            matches!(err, AppError::NotFound(ref message) if message.contains("wi_missing")),
            "实际：{err:?}"
        );
    }

    /// 快照文案被截到边界，且**返回对象与落库那一行逐字相同**（两份真相源的反例）。
    #[test]
    fn record_run_truncates_the_label_and_returns_what_it_stored() {
        let manager = manager();
        let created = manager.create_at(create_input("T"), T0).unwrap();

        let mut input = new_run(&created.id);
        input.label = "空闲 ⚠ 未声明".repeat(40);
        let returned = manager.record_run_at(input, T0).unwrap();

        assert_eq!(
            returned.snapshot.label.chars().count(),
            crate::work_items::types::RUN_LABEL_MAX_CHARS
        );
        assert_eq!(manager.runs(&created.id).unwrap(), vec![returned]);
    }

    /// 没有执行记录的工作项返回空列表，且删除后同样是空（不报错）。
    #[test]
    fn runs_of_an_unknown_work_item_are_empty() {
        let manager = manager();
        assert!(manager.runs("wi_missing").unwrap().is_empty());

        let created = manager.create_at(create_input("T"), T0).unwrap();
        manager.record_run_at(new_run(&created.id), T0 + 1).unwrap();
        manager.delete(&created.id).unwrap();
        assert!(
            manager.runs(&created.id).unwrap().is_empty(),
            "父项删掉后执行记录必须一起消失（CASCADE）"
        );
    }

    /// 阶段轨的唯一来源：命令与判定读的是同一份。
    #[test]
    fn the_stage_plan_is_a_single_source() {
        let plan = WorkItemManager::stage_plan();
        assert_eq!(plan.stages, DEFAULT_STAGES.map(str::to_owned).to_vec());
        assert!(plan.can_transition("Ready", "In Progress"));
    }

    /// 时间戳的真实来源不会悄悄退回 1970（`SystemTime` 早于 epoch 时才退 0）。
    #[test]
    fn now_millis_keeps_the_epoch_zero_as_an_unreachable_fallback() {
        assert!(now_millis() > 0);
    }
}
