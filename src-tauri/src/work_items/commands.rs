//! 工作项域的 `#[tauri::command]`（**极薄**，红线 6）。
//!
//! 八条命令：
//!
//! | 命令 | 方向 | 载荷 |
//! | --- | --- | --- |
//! | `work_item_stage_plan` | 读 | 阶段轨（`stages` + 相邻两两双向的 `transitions`）|
//! | `work_item_list` | 读 | 一个项目的全部工作项（`updated_at DESC`）|
//! | `work_item_create` | 写 | 新建（标题必填，其余缺省）|
//! | `work_item_update` | 写 | 改字段（**不能**改 stage）|
//! | `work_item_transition` | 写 | 走一步 stage（跨阶段一律拒）|
//! | `work_item_delete` | 写 | 删工作项（执行记录 CASCADE）|
//! | `work_item_run_list` | 读 | 一个工作项的执行记录（`created_at DESC`）|
//! | `work_item_run_record` | 写 | 记一条执行记录（**本期只接受 `mode = single`**）|
//!
//! 八条都只做「取 `State` → 调 manager」：校验与业务判据全在
//! [`crate::work_items::manager::WorkItemManager`]（红线 6）。本文件**不出现** SQL、
//! 不出现 `rusqlite`、不出现阶段轨推导 —— 一旦出现，就说明有一条判据绕过了 manager。
//!
//! # 为什么全部是同步 `pub fn`
//!
//! 同 `team_list` 的先例：本地 SQLite 的一行读 / 一行写是微秒级同步调用。做成 `async`
//! 只会把一次同步调用塞进异步状态机，再逼调用方决定要不要 `spawn_blocking`（红线 3 的
//! 无意义形态 —— 那条红线的对象是 git / PTY / ssh 这类秒级长 I/O）。
//!
//! # 为什么入参是**扁平** camelCase，而不是一个 `*Params` 结构体
//!
//! Tauri 的扁平参数就是 invoke 契约：前端写 `invoke('work_item_create', { projectId, … })`。
//! 把七个字段收进一个结构体，线上形状会变成 `{ params: { … } }` —— 多一层嵌套，与全仓
//! 100+ 条命令的口径不一致，而收益只是 Rust 侧少写几个 `Option<String>`。代价相同的两组
//! 参数里，选与仓内既有一致的那组。
//!
//! # 为什么没有 `.map_err(AppError::from)`
//!
//! manager 已经返回 `AppError`（业务拒绝是 `InvalidInput` / `NotFound`，库错误落 `Unknown`）。
//! 再过一次 `AppError::from` 是同类型到同类型的一跳，看起来像「命令层做了错误归一」，
//! 实际什么都没做。转换只该出现在**边界真的换类型**的地方。

use crate::common::error::AppError;
use crate::work_items::manager::WorkItemManager;
use crate::work_items::types::{
    CreateWorkItem, NewRun, RunMode, RunRef, RunRefKind, RunState, StagePlan, UpdateWorkItem,
    WorkItem, WorkItemRun,
};
use crate::AppStateWrapper;

/// 阶段轨（面板的 Stage Rail / 右键 [Move to] 的数据源）。
///
/// 不读库也不读 State：阶段轨今天是常量，但它**必须**与 `create` / `transition` 的合法性
/// 判据同源，所以出口是 [`WorkItemManager::stage_plan`] 而不是各调用点自己
/// `StagePlan::default()`。
#[tauri::command]
pub fn work_item_stage_plan() -> Result<StagePlan, AppError> {
    Ok(WorkItemManager::stage_plan())
}

/// 一个项目的全部工作项（Board / List 的数据源）。
///
/// 未知项目返回空列表而不是错误：空 inbox 是首启的合法状态。
#[tauri::command]
pub fn work_item_list(
    state: tauri::State<AppStateWrapper>,
    project_id: String,
) -> Result<Vec<WorkItem>, AppError> {
    state.work_item_manager.list(&project_id)
}

/// 新建一条工作项。
///
/// 校验全在 manager：空标题 / 未知 stage / 未知 priority / 空 `projectId` 一律
/// `InvalidInput`，消息里带可选值。
#[tauri::command]
#[allow(clippy::too_many_arguments)] // 参数构成 invoke 契约（分组会改变前端 payload 形状）
pub fn work_item_create(
    state: tauri::State<AppStateWrapper>,
    project_id: String,
    title: String,
    body: Option<String>,
    stage: Option<String>,
    priority: Option<String>,
    labels: Option<Vec<String>>,
    assignee: Option<String>,
) -> Result<WorkItem, AppError> {
    state.work_item_manager.create(CreateWorkItem {
        project_id,
        title,
        body,
        stage,
        priority,
        labels,
        assignee,
    })
}

/// 改字段（**没有** `stage` 参数）。
///
/// 阶段只能经 [`work_item_transition`] 改动，否则「拖拽只允许相邻」这条合法性判据就多
/// 了一个绕过口。可空字段的清除语义见 [`UpdateWorkItem`]（空串 = 清空）。
#[tauri::command]
pub fn work_item_update(
    state: tauri::State<AppStateWrapper>,
    id: String,
    title: Option<String>,
    body: Option<String>,
    priority: Option<String>,
    labels: Option<Vec<String>>,
    assignee: Option<String>,
) -> Result<WorkItem, AppError> {
    state.work_item_manager.update(UpdateWorkItem {
        id,
        title,
        body,
        priority,
        labels,
        assignee,
    })
}

/// 走一步 stage（拖拽落列 / Stage Rail 点击 / 右键 [Move to] 三个入口共用）。
///
/// 非法流转 → `InvalidInput`，消息含当前 stage 与合法目标集合（前端可直接展示）。
#[tauri::command]
pub fn work_item_transition(
    state: tauri::State<AppStateWrapper>,
    id: String,
    to: String,
) -> Result<WorkItem, AppError> {
    state.work_item_manager.transition(&id, &to)
}

/// 删除一条工作项；它的执行记录随外键 CASCADE 一起消失。
///
/// 未知 id → `NotFound`（幂等删除被明确拒绝：静默成功会让一次「撤销」变成一次误删）。
#[tauri::command]
pub fn work_item_delete(state: tauri::State<AppStateWrapper>, id: String) -> Result<(), AppError> {
    state.work_item_manager.delete(&id)
}

/// 一个工作项的执行记录（详情面板的「执行」区块）。
///
/// 载荷只带指针 + 快照，不带团队成员 / 任务明细（红线 4 + design §4.6 的载荷约定）。
#[tauri::command]
pub fn work_item_run_list(
    state: tauri::State<AppStateWrapper>,
    work_item_id: String,
) -> Result<Vec<WorkItemRun>, AppError> {
    state.work_item_manager.runs(&work_item_id)
}

/// 记一条执行记录（`run-single` 的唯一写入方）。
///
/// # 为什么参数叫 `run_state` 而不是 `state`
///
/// `state: tauri::State<AppStateWrapper>` 已经占用了 `state` 这个名字，而**命令的参数名就是
/// 线上键**（Tauri 的扁平解码按名字取参）。两个 `state` 无法共存：前端传的 `state` 会被当成
/// 应用状态，执行状态则永远解码成缺失。所以这里改名为 `run_state`（前端传 `runState`），
/// 与 `NewRun::state` → `WorkItemRun::snapshot.state` 的域内叫法保持一致。
///
/// # 只接受 `mode = single`（本期政策，不是领域限制）
///
/// `team` / `flow` 两档今天**没有写入方**（`run-team` 依赖 `10-30` 收尾，`run-flow` 连引擎
/// 都没有）。放开等于让 UI 可以伪造一条「已派给团队」的记录 —— 而这条记录**看起来**就是
/// 权威（详情面板只会照着它渲染 mode 徽标与状态 chip），用户无从分辨。所以拒绝，并在消息里
/// 写清原因：这是一句「还没实现」，不是「你写错了」。
///
/// 未来 `run-team` 落地时**不会**放宽这里：它会走自己的命令（`team_dispatch` 一类），因为
/// 「派给团队」要做的远不止插一行记录（起队、队长会话、准入）。这条命令的边界就是「一次
/// 已经起来的 agent 会话」。
#[tauri::command]
#[allow(clippy::too_many_arguments)] // 参数构成 invoke 契约（分组会改变前端 payload 形状）
pub fn work_item_run_record(
    state: tauri::State<AppStateWrapper>,
    work_item_id: String,
    mode: String,
    ref_kind: String,
    ref_id: String,
    ref_sub: Option<String>,
    run_state: String,
    label: String,
) -> Result<WorkItemRun, AppError> {
    record_run_for(
        &state.work_item_manager,
        RunRecordArgs {
            work_item_id,
            mode,
            ref_kind,
            ref_id,
            ref_sub,
            run_state,
            label,
        },
    )
}

/// `work_item_run_record` 的扁平入参（命令层装配 → 本文件的转换函数 → manager）。
///
/// 收成一个结构体只为让 [`record_run_for`] 的参数表不重复第二遍：**线上仍是扁平 camelCase**，
/// 本结构体不出现在 invoke 契约里（同 `CreateWorkItem` 的说明）。
struct RunRecordArgs {
    work_item_id: String,
    mode: String,
    ref_kind: String,
    ref_id: String,
    ref_sub: Option<String>,
    run_state: String,
    label: String,
}

/// 线上字符串 → 域内枚举 + 命令层的政策闸门，然后交给 manager 落库。
///
/// 抽成独立函数不是为了「可测性」这一个理由：命令体里带 `tauri::State`，而本仓没有
/// `tauri::test`（全仓无先例，造不出 `State`）。校验留在命令体内就等于**没有测试**，
/// 而这里恰好有一条会被误判为「已上线」的政策（`mode = single`）。
fn record_run_for(manager: &WorkItemManager, args: RunRecordArgs) -> Result<WorkItemRun, AppError> {
    let mode = parse_run_mode(&args.mode)?;
    if mode != RunMode::Single {
        return Err(AppError::InvalidInput(format!(
            "run mode `{}` is not implemented yet: only `single` runs can be recorded",
            mode.as_str()
        )));
    }

    let kind = parse_ref_kind(&args.ref_kind)?;
    // 指针与档位必须配对：`single` 的执行域**只有**一个终端 tab，写成 `team` 会得到一条
    // 跳不到任何地方、却在列表里宣称「已派给团队」的记录。
    if kind != RunRefKind::Session {
        return Err(AppError::InvalidInput(format!(
            "`single` runs point at a session tab, got ref kind `{}`",
            kind.as_str()
        )));
    }

    let ref_id = args.ref_id.trim().to_owned();
    if ref_id.is_empty() {
        // 空指针 = 一条永远跳不过去的记录（详情面板的 [Open] 会变成死按钮）。
        return Err(AppError::InvalidInput(
            "`ref_id` must not be empty".to_owned(),
        ));
    }

    manager.record_run(NewRun {
        work_item_id: args.work_item_id,
        mode,
        run_ref: RunRef {
            kind,
            id: ref_id,
            // 空白二级指针等于没有（同 manager 的 `assignee` 清除语义）。
            sub: args
                .ref_sub
                .map(|raw| raw.trim().to_owned())
                .filter(|raw| !raw.is_empty()),
        },
        state: parse_run_state(&args.run_state)?,
        label: args.label,
    })
}

/// 线上档位文本 → [`RunMode`]（未知值 `InvalidInput`，消息含可选值）。
fn parse_run_mode(raw: &str) -> Result<RunMode, AppError> {
    RunMode::try_from(raw.trim()).map_err(|err| AppError::InvalidInput(err.to_string()))
}

/// 线上指针种类文本 → [`RunRefKind`]。
fn parse_ref_kind(raw: &str) -> Result<RunRefKind, AppError> {
    RunRefKind::try_from(raw.trim()).map_err(|err| AppError::InvalidInput(err.to_string()))
}

/// 线上快照状态文本 → [`RunState`]。
fn parse_run_state(raw: &str) -> Result<RunState, AppError> {
    RunState::try_from(raw.trim()).map_err(|err| AppError::InvalidInput(err.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::work_items::store::WorkItemStore;
    use crate::work_items::types::DEFAULT_STAGES;

    /// 一个空项目上的 manager（走内存库，不碰用户的 `~/.neeko`）。
    fn manager() -> WorkItemManager {
        WorkItemManager::with_store(WorkItemStore::open_in_memory().expect("内存库"))
    }

    fn create_item(manager: &WorkItemManager) -> String {
        manager
            .create(CreateWorkItem {
                project_id: "p1".to_owned(),
                title: "修个 bug".to_owned(),
                body: None,
                stage: None,
                priority: None,
                labels: None,
                assignee: None,
            })
            .expect("建工作项")
            .id
    }

    /// `run-single` 的入参：一条指向终端 tab 的 `single` 记录。
    fn args(work_item_id: &str) -> RunRecordArgs {
        RunRecordArgs {
            work_item_id: work_item_id.to_owned(),
            mode: "single".to_owned(),
            ref_kind: "session".to_owned(),
            ref_id: "tab_abc".to_owned(),
            ref_sub: None,
            run_state: "running".to_owned(),
            label: "OpenCode".to_owned(),
        }
    }

    /// 阶段轨命令与 manager 的判据同源（Stage Rail 显示 5 个阶段，后端就认这 5 个）。
    #[test]
    fn the_stage_plan_command_returns_the_documented_track() {
        let plan = work_item_stage_plan().expect("常量阶段轨不该失败");
        assert_eq!(plan.stages, DEFAULT_STAGES.map(str::to_owned).to_vec());
        assert!(plan.can_transition("Backlog", "Ready"));
        assert!(!plan.can_transition("Backlog", "Done"));
    }

    /// `single` 档能落库：指针是**终端 tab id**，快照是调用方当时看到的状态，且读得回来。
    #[test]
    fn a_single_run_is_recorded_with_the_tab_id_as_its_pointer() {
        let manager = manager();
        let item_id = create_item(&manager);

        let run = record_run_for(&manager, args(&item_id)).expect("single 档应当落库");

        assert_eq!(run.work_item_id, item_id);
        assert_eq!(run.mode, RunMode::Single);
        assert_eq!(
            run.run_ref,
            RunRef {
                kind: RunRefKind::Session,
                id: "tab_abc".to_owned(),
                sub: None,
            },
            "single 档的 ref.id 是终端 tab id（可激活的稳定定位点），不是 PTY session id"
        );
        assert_eq!(run.snapshot.state, RunState::Running);
        assert_eq!(run.snapshot.label, "OpenCode");
        assert_eq!(manager.runs(&item_id).unwrap(), vec![run]);
    }

    /// `team` / `flow` 被**明确**拒绕，且消息里说的是「还没实现」而不是「参数写错了」。
    ///
    /// 放开的后果不是一条脏数据：详情面板只会照着记录渲染 mode 徽标与状态 chip，
    /// 一条伪造的 `team` 记录在 UI 上与真的「已派给团队」无法区分。
    #[test]
    fn team_and_flow_runs_are_rejected_as_not_implemented() {
        let manager = manager();
        let item_id = create_item(&manager);

        for mode in ["team", "flow"] {
            let mut input = args(&item_id);
            input.mode = mode.to_owned();
            input.ref_kind = mode.to_owned();
            let err = record_run_for(&manager, input).expect_err("只有 single 档可以落库");
            let message = format!("{err:?}");
            assert!(matches!(err, AppError::InvalidInput(_)), "实际：{message}");
            assert!(message.contains(mode), "消息要点名档位：{message}");
            assert!(
                message.contains("not implemented"),
                "这是一句「还没实现」，不是「你写错了」：{message}"
            );
        }

        assert!(
            manager.runs(&item_id).unwrap().is_empty(),
            "被拒的写入不得留下任何记录"
        );
    }

    /// 未知 workItemId → `NotFound`（manager 的判据在这里再钉一次：命令层不得把它变成
    /// `Unknown` 或一句外键报错）。
    #[test]
    fn recording_a_run_for_an_unknown_work_item_is_not_found() {
        let manager = manager();
        let err = record_run_for(&manager, args("wi_missing")).expect_err("未知工作项必须失败");
        assert!(
            matches!(err, AppError::NotFound(ref message) if message.contains("wi_missing")),
            "实际：{err:?}"
        );
    }

    /// `single` 与别的指针不配对时被拒：一条跳到不了任何地方的 `team` 记录比没有记录更糟。
    #[test]
    fn a_single_run_must_point_at_a_session() {
        let manager = manager();
        let item_id = create_item(&manager);

        let mut input = args(&item_id);
        input.ref_kind = "team".to_owned();
        let err = record_run_for(&manager, input).expect_err("single 档只能指向会话");
        assert!(
            matches!(err, AppError::InvalidInput(ref message) if message.contains("session tab")),
            "实际：{err:?}"
        );

        let mut input = args(&item_id);
        input.ref_id = "   ".to_owned();
        let err = record_run_for(&manager, input).expect_err("空指针必须失败");
        assert!(
            matches!(err, AppError::InvalidInput(ref message) if message.contains("ref_id")),
            "实际：{err:?}"
        );
        assert!(manager.runs(&item_id).unwrap().is_empty());
    }

    /// 未知枚举文本一律 `InvalidInput` 且带可选值（前端可以原样展示给用户）。
    #[test]
    fn unknown_wire_words_are_rejected_with_the_allowed_set() {
        let manager = manager();
        let item_id = create_item(&manager);

        let mut input = args(&item_id);
        input.mode = "solo".to_owned();
        let err = record_run_for(&manager, input).expect_err("未知档位必须失败");
        assert!(
            matches!(err, AppError::InvalidInput(ref message) if message.contains("solo") && message.contains("single")),
            "实际：{err:?}"
        );

        let mut input = args(&item_id);
        input.ref_kind = "tab".to_owned();
        let err = record_run_for(&manager, input).expect_err("未知指针种类必须失败");
        assert!(
            matches!(err, AppError::InvalidInput(ref message) if message.contains("tab")),
            "实际：{err:?}"
        );

        let mut input = args(&item_id);
        input.run_state = "busy".to_owned();
        let err = record_run_for(&manager, input).expect_err("未知状态必须失败");
        assert!(
            matches!(err, AppError::InvalidInput(ref message) if message.contains("busy")),
            "实际：{err:?}"
        );
    }

    /// 空白二级指针 / 前后空白都被归一（`sub: None` 而不是 `Some("")`）。
    #[test]
    fn the_pointer_is_trimmed_and_blank_sub_becomes_none() {
        let manager = manager();
        let item_id = create_item(&manager);

        let mut input = args(&item_id);
        input.ref_id = "  tab_abc  ".to_owned();
        input.ref_sub = Some("   ".to_owned());
        let run = record_run_for(&manager, input).expect("落库");

        assert_eq!(run.run_ref.id, "tab_abc");
        assert_eq!(run.run_ref.sub, None);
    }

    /// **注册判据**：`work_item_run_record` 必须在 `neeko_invoke_handler!` 里。
    ///
    /// 漏一行的症状是前端 `command not found`，而两条常规测试都绕过它：命令测试直接
    /// 调函数（注册与否无关），前端测试用 mock `invoke`（不需要命令真的存在）。
    /// 注册表是宏表不是类型，编译器不会替你数（同 `agent/team/commands.rs` 的判据）。
    #[test]
    fn the_run_record_command_is_registered_in_the_invoke_handler() {
        let registry = include_str!("../lib.rs");
        assert!(
            registry.contains(concat!("work_items::commands::work_item_run", "_record,")),
            "work_item_run_record 没注册：前端 invoke 会得到 command not found"
        );
    }

    /// 红线 9 的机器判据：域根只允许 `pub mod` / `pub use`。
    ///
    /// 挂在命令层是因为它是**域级**结构约束，而 `mod.rs` 自己不能再放测试（放了就不再是
    /// 「只有声明」）。多行 `pub use` 会被 rustfmt 折行，所以按 `;` 切语句而不是按行切。
    #[test]
    fn the_module_root_only_declares_and_reexports() {
        let source = include_str!("mod.rs");
        let code: String = source
            .lines()
            .map(str::trim)
            .filter(|line| !line.starts_with("//"))
            .collect::<Vec<_>>()
            .join(" ");
        for statement in code.split(';') {
            let statement = statement.trim();
            if statement.is_empty() {
                continue;
            }
            assert!(
                statement.starts_with("pub mod ") || statement.starts_with("pub use "),
                "mod.rs 只允许 mod 声明与 pub use（红线 9），发现：{statement}"
            );
        }
    }
}
