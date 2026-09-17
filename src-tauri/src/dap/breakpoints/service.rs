//! 断点全链路编排：IPC → 内存仓储 → 磁盘 → 适配器，以及静音切换的即时下发。
//!
//! ## 职责边界
//!
//! - **状态**在 [`super::store`]（单锁仓储、单飞装载）；
//! - **过滤规则**在 [`super::effective`]（`effective = enabled && !muted`，唯一过滤点）；
//! - **本模块**只做编排：什么时候装载、什么时候落盘、往哪个会话下发、失败怎么处理。
//!
//! ## 两条下发路径（都必须走同一个过滤点）
//!
//! | 路径 | 入口 | 载荷来源 |
//! |---|---|---|
//! | 实时 | [`set_breakpoints`] | `effective_lines` |
//! | 启动/重跑 | `source_translation::adapter_breakpoints`（由 `launch` 调用） | 同一过滤函数 |
//! | 静音切换 | [`sync_to_session`] | `effective_lines`（全集） |
//!
//! 只堵实时路径 ⇒ mute 后 Rerun 会经启动路径把全部断点重新下发命中（打穿 mute 语义）。

use std::path::PathBuf;

use super::effective_breakpoints;
use crate::dap::config;
use crate::dap::context::DapContext;
use crate::dap::project_context;
use crate::dap::session::DapSession;
use crate::dap::source_translation;
use crate::dap::types::{BreakpointLine, BreakpointSpec};
use crate::AppError;

/// 项目全量断点（内存；`file, line` 升序）。
pub(crate) async fn snapshot(ctx: &DapContext<'_>, project_id: &str) -> Vec<BreakpointSpec> {
    ctx.breakpoints.snapshot(project_id).await
}

/// 确保磁盘断点已并入内存（每个项目、每个进程一次）。
///
/// 磁盘 IO 交给仓储在**锁外**执行，且必须搬进阻塞线程池（Gate #3）：WSL 项目的
/// 根可能是 `\\wsl$\…` UNC 路径，同步读会占住 tokio worker 直到重定向返回。
/// 仓储负责"判定 + 认领"同一临界区（消除 check-then-act 丢更新）。
pub(crate) async fn ensure_loaded(ctx: &DapContext<'_>, project_id: &str) -> Result<(), AppError> {
    // 先解析项目根：未知项目立刻 `NotFound`，不把仓储标成"已装载"。
    let path = project_context::project_path(ctx.state, project_id)?;
    ctx.breakpoints
        .ensure_loaded(project_id, || {
            crate::common::runtime::run_blocking_result(move || {
                config::load_breakpoints_file(&path)
            })
        })
        .await
}

/// 项目断点全量落盘（`breakpoints.json`）。
async fn persist(ctx: &DapContext<'_>, project_id: &str) -> Result<(), AppError> {
    let path = project_context::project_path(ctx.state, project_id)?;
    // 一次快照拿全（断点 + 静音位同源），避免两次取锁之间被改写。
    let (files, muted) = ctx.breakpoints.snapshot_with_mute(project_id).await;
    let list: Vec<BreakpointSpec> = files.into_iter().flat_map(|(_, specs)| specs).collect();
    // 落盘同样走阻塞线程池（同一原因）。
    crate::common::runtime::run_blocking_result(move || {
        config::save_breakpoints_file(&path, &list, muted)
    })
    .await
}

/// 单文件断点（含 enabled）全量读取（内存）；排序按行号。
async fn file_snapshot(
    ctx: &DapContext<'_>,
    project_id: &str,
    file_path: &str,
) -> Vec<BreakpointSpec> {
    ctx.breakpoints.file_snapshot(project_id, file_path).await
}

/// **实时路径**的有效适配器载荷：只取 `enabled && !muted` 的行。
///
/// [`set_breakpoints`]（实时）与 [`sync_to_session`]（mute 切换）共用；
/// 与启动/重跑路径同走 [`effective_breakpoints`] 单一过滤点。
async fn effective_lines(ctx: &DapContext<'_>, project_id: &str, file_path: &str) -> Vec<u32> {
    let file_specs = file_snapshot(ctx, project_id, file_path).await;
    let muted = ctx.breakpoints.muted(project_id).await;
    effective_breakpoints(&file_specs, muted)
        .iter()
        .map(|b| b.line)
        .collect()
}

/// Set breakpoints for a file in a project, persisting to disk and forwarding to the active session.
///
/// 语义：`breakpoints` 是该文件**全量替换**（含 disabled 位）；持久化全量；
/// 下发只取 effective（`enabled && !muted`，评审 P1 的单一过滤点）。
///
/// **部分失败契约**（前端据此决定是否回滚 UI）：
/// - 内存 + 磁盘**先**写入且不回滚 —— UI 是离线真相，落盘失败只记 `warn`（不算失败）；
/// - `Err` 只可能来自**下发**（会话侧 `setBreakpoints` 失败）。此时内存/磁盘已是新值，
///   前端**不应**把断点回滚成旧值，否则两边分叉；
/// - 身份不可翻译（含非 UTF-8 路径）不算失败：不下发、回传规范身份 + `verified:false`，
///   原因经 Debug Console 的 note 告知。
pub(crate) async fn set_breakpoints(
    ctx: &DapContext<'_>,
    project_id: &str,
    file_path: &str,
    breakpoints: Vec<BreakpointLine>,
    active_session_id: Option<&str>,
) -> Result<Vec<BreakpointSpec>, AppError> {
    ensure_loaded(ctx, project_id).await?;
    ctx.breakpoints
        .set_file(project_id, file_path, breakpoints)
        .await;
    // Persist even if adapter set fails — UI state is source of truth offline.
    if let Err(e) = persist(ctx, project_id).await {
        log::warn!("[DAP] failed to persist breakpoints: {e}");
    }

    let session = match active_session_id {
        Some(sid) => ctx.sessions.get(sid).await,
        None => None,
    };
    // 无活动会话（或已结束）→ 只回传内存态：UI 是离线真相。
    let Some(session) = session else {
        return Ok(file_snapshot(ctx, project_id, file_path).await);
    };
    let lines = effective_lines(ctx, project_id, file_path).await;
    // 身份不可翻译 → 不下发（伪路径会被适配器静默丢弃），回传规范身份 + 未验证
    // （带 enabled）；诊断 note 已由 `push_file_breakpoints` 落到 Debug Console。
    let Some(returned) =
        push_file_breakpoints(ctx, &session, project_id, file_path, &lines).await?
    else {
        return Ok(file_snapshot(ctx, project_id, file_path).await);
    };
    Ok(returned)
}

/// Get all breakpoints for a project from memory.
pub(crate) async fn get_breakpoints(
    ctx: &DapContext<'_>,
    project_id: &str,
) -> Result<Vec<BreakpointSpec>, AppError> {
    ensure_loaded(ctx, project_id).await?;
    Ok(snapshot(ctx, project_id).await)
}

/// Get the global-mute flag for a project（`loadBreakpoints` 时与列表同取）。
pub(crate) async fn get_breakpoints_muted(
    ctx: &DapContext<'_>,
    project_id: &str,
) -> Result<bool, AppError> {
    ensure_loaded(ctx, project_id).await?;
    Ok(ctx.breakpoints.muted(project_id).await)
}

/// Set the global-mute flag for a project：持久化 + 即时下发 effective 全集。
///
/// mute=true → 载荷为空（全部扣留，单个 enabled 原样保留）；
/// mute=false → 恢复各文件 enabled 子集（此前单点禁用的保持禁用）。
pub(crate) async fn set_breakpoints_muted(
    ctx: &DapContext<'_>,
    project_id: &str,
    muted: bool,
) -> Result<(), AppError> {
    ensure_loaded(ctx, project_id).await?;
    ctx.breakpoints.set_muted(project_id, muted).await;
    if let Err(e) = persist(ctx, project_id).await {
        log::warn!("[DAP] failed to persist muted flag: {e}");
    }
    sync_to_session(ctx, project_id).await;
    Ok(())
}

/// 把项目的 effective 全集即时下发到其活动会话（mute 切换后调用）。
///
/// mute=true → 每文件载荷为空（全部扣留，单个 enabled 原样保留）；
/// mute=false → 恢复各文件 enabled 子集。与实时 toggle 同走
/// [`effective_breakpoints`] 过滤（评审 P1）。
async fn sync_to_session(ctx: &DapContext<'_>, project_id: &str) {
    let Some(session) = ctx.sessions.first_for_project(project_id).await else {
        return;
    };
    // 一次快照拿全（断点 + 静音位同源）后即放锁：per-file 循环里有
    // `adapter_source_path` / `set_breakpoints_for_file` 的 await，持锁跨 await
    // 会把项目断点变更在整个 mute 同步期间串行化（tokio Mutex 不会死锁，但没必要）。
    let (snapshot, muted) = ctx.breakpoints.snapshot_with_mute(project_id).await;
    for (file, file_specs) in snapshot {
        let effective: Vec<u32> = effective_breakpoints(&file_specs, muted)
            .iter()
            .map(|b| b.line)
            .collect();
        // 单个文件下发失败不影响同项目其余文件（静音切换是尽力而为的批量同步）。
        if let Err(e) = push_file_breakpoints(ctx, &session, project_id, &file, &effective).await {
            log::warn!("[DAP] failed to sync breakpoints for {file}: {e}");
        }
    }
}

/// 会话下发的适配器路径：按**会话的适配器族**反查编排后端做身份翻译。
///
/// live toggle 与静默切换都没有启动链路的 classpath 上下文，只能靠缓存命中
/// （`classpath` 传空）。语言差异由语言后端承担 —— Go/Lldb 会话恒走原样透传，
/// 不在此硬编码语言名。
async fn adapter_path_for_session(
    ctx: &DapContext<'_>,
    session: &DapSession,
    project_id: &str,
    identity: &str,
) -> (Option<PathBuf>, Option<String>) {
    match ctx.state.resolve_project(project_id) {
        Ok((target, _)) => {
            let backend = ctx.backends.get(session.kind());
            source_translation::adapter_source_path(
                backend.as_deref(),
                ctx.state,
                &target,
                &[],
                identity,
            )
            .await
        }
        // 环境解析失败：不改变既有行为，按规范身份下发（下游会给出自己的错误）。
        Err(_) => (Some(PathBuf::from(identity)), None),
    }
}

/// 把「一个文件的有效断点」下发到会话：翻译 → note → 下发 → 回传规范身份。
///
/// 单一实现：实时 toggle 与静默切换此前各自手抄一遍这段（含 note 语义与
/// 规范身份回传），改动失败语义或新增语言时必漏改其中一处。
///
/// 返回 `Ok(None)` = 身份不可翻译 → **不下发**（伪路径会被适配器静默丢弃），
/// 调用方按自己的语义回退；`Ok(Some(specs))` = 适配器回传的断点（已改写回
/// 规范身份，前端用它匹配 tab / 黄线）。
async fn push_file_breakpoints(
    ctx: &DapContext<'_>,
    session: &DapSession,
    project_id: &str,
    file_path: &str,
    lines: &[u32],
) -> Result<Option<Vec<BreakpointSpec>>, AppError> {
    let (adapter_path, note) = adapter_path_for_session(ctx, session, project_id, file_path).await;
    if let Some(note) = &note {
        session.emit_output("console", note);
    }
    let Some(adapter_path) = adapter_path else {
        return Ok(None);
    };
    // **不降级**：非 UTF-8 路径经 `to_string_lossy` 会变成另一个路径，
    // 适配器只会静默回 `verified:false`。显式拒绝 + 诊断（与启动路径同口径）。
    let Some(adapter_path) = adapter_path.to_str() else {
        session.emit_output(
            "console",
            &format!(
                "Skipped the breakpoint(s) in {file_path}: the resolved path is not valid \
                 UTF-8 and cannot be sent to the debug adapter"
            ),
        );
        return Ok(None);
    };
    let returned = session
        .set_breakpoints_for_file(adapter_path, lines)
        .await?;
    Ok(Some(
        returned
            .into_iter()
            .map(|bp| BreakpointSpec {
                file_path: file_path.to_string(),
                ..bp
            })
            .collect(),
    ))
}

#[cfg(test)]
mod tests {
    //! service 的单测**不需要 `DapManager`**：三个协作者就地构造，上下文只是借用。
    //! 需要活动会话的用例直接把 `DapSession::connect` 的会话塞进本地注册表。
    use super::*;
    use crate::dap::testing::{bp, DapFixture, FakeAdapter};
    use crate::dap::types::BreakpointLine;

    fn line(line: u32, enabled: bool) -> BreakpointLine {
        BreakpointLine { line, enabled }
    }

    /// 假适配器收到的第 `n` 次 `setBreakpoints` 的行号（升序）。
    fn pushed_lines(adapter: &FakeAdapter, n: usize) -> Vec<u64> {
        let requests = adapter.breakpoint_requests();
        let mut lines: Vec<u64> = requests[n]
            .pointer("/breakpoints")
            .and_then(|v| v.as_array())
            .expect("breakpoints array")
            .iter()
            .filter_map(|b| b.get("line").and_then(serde_json::Value::as_u64))
            .collect();
        lines.sort_unstable();
        lines
    }

    /// **实时路径**（评审 P1）：内存全量保留 disabled，但下发载荷只取 `enabled && !muted`。
    /// 变异验证：删掉 `effective_breakpoints` 过滤 ⇒ 本用例红。
    #[tokio::test]
    async fn effective_lines_respects_disabled_and_muted() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let f = DapFixture::new(&tmp);
        let ctx = f.ctx();

        ctx.breakpoints
            .set_file(
                &f.project_id,
                "/proj/a.go",
                vec![line(10, true), line(20, false)],
            )
            .await;
        assert_eq!(
            effective_lines(&ctx, &f.project_id, "/proj/a.go").await,
            vec![10],
            "只下发 enabled 行"
        );

        ctx.breakpoints.set_muted(&f.project_id, true).await;
        assert!(
            effective_lines(&ctx, &f.project_id, "/proj/a.go")
                .await
                .is_empty(),
            "mute 下实时载荷必须为空"
        );
    }

    /// 实时下发：载荷只含 enabled 行；回传的是**适配器视图但身份已改写回规范身份**。
    ///
    /// 契约说明：回传**不是**内存全量 —— disabled 行不进适配器，适配器自然也不会回它。
    /// 前端的 `mergeBreakpointEntries(next, returned)` 用本地 `next`（全量，含 enabled 位）
    /// 与回传做**合并**，所以禁用条目在客户端保留、`verified` 由后端覆盖。
    /// 本用例把这条契约钉死在两侧：下发只含 effective、回传身份必须可被前端匹配。
    #[tokio::test]
    async fn set_breakpoints_pushes_effective_lines_and_returns_canonical_identity() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let f = DapFixture::new(&tmp);
        let ctx = f.ctx();
        let adapter = FakeAdapter::start().await;
        let session_id = f.with_session(&adapter).await;

        // 断言"内存里 preserved 全量"（前端合并的输入是内存，不是回传）。
        let returned = set_breakpoints(
            &ctx,
            &f.project_id,
            "/proj/a.go",
            vec![line(10, true), line(20, false)],
            Some(&session_id),
        )
        .await
        .expect("set");

        assert_eq!(pushed_lines(&adapter, 0), vec![10], "disabled 行不得下发");
        assert_eq!(adapter.breakpoint_requests().len(), 1);
        assert_eq!(
            snapshot(&ctx, &f.project_id).await.len(),
            2,
            "内存必须保留 disabled 位（前端合并依赖它）"
        );
        assert_eq!(returned.len(), 1, "回传是适配器视图（只含下发的行）");
        assert_eq!(returned[0].line, 10);
        assert!(
            returned.iter().all(|b| b.file_path == "/proj/a.go"),
            "回传身份必须是规范身份（不是适配器路径），否则前端匹配不上 tab: {returned:?}"
        );
    }

    /// mute 切换必须**即时下发空载荷**到活动会话，unmute 恢复 enabled 子集。
    ///
    /// 这条路径（`set_breakpoints_muted` → `sync_to_session`）在端口/上下文抽出前
    /// 无任何用例覆盖。
    #[tokio::test]
    async fn mute_toggle_syncs_empty_payload_to_live_session() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let f = DapFixture::new(&tmp);
        let ctx = f.ctx();
        let adapter = FakeAdapter::start().await;
        let session_id = f.with_session(&adapter).await;

        set_breakpoints(
            &ctx,
            &f.project_id,
            "/proj/a.go",
            vec![line(10, true)],
            Some(&session_id),
        )
        .await
        .expect("set");
        assert_eq!(pushed_lines(&adapter, 0), vec![10]);

        set_breakpoints_muted(&ctx, &f.project_id, true)
            .await
            .expect("mute");
        assert_eq!(
            adapter.breakpoint_requests().len(),
            2,
            "mute 必须触发即时下发"
        );
        assert!(
            pushed_lines(&adapter, 1).is_empty(),
            "mute 下实时载荷必须为空"
        );

        set_breakpoints_muted(&ctx, &f.project_id, false)
            .await
            .expect("unmute");
        assert_eq!(
            pushed_lines(&adapter, 2),
            vec![10],
            "unmute 必须恢复 enabled 子集"
        );
    }

    /// 磁盘值只在首次访问并入一次；此后内存是真相（不会被磁盘旧值回灌）。
    ///
    /// 回归背景：旧实现"锁外读盘 + 无差别 insert"会在并发路径上用磁盘旧值覆盖
    /// 用户刚设的断点（丢更新）。
    #[tokio::test]
    async fn disk_values_merge_once_and_memory_wins_afterwards() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let f = DapFixture::new(&tmp);
        let ctx = f.ctx();
        let project_dir = tmp.path().join("proj");
        crate::dap::config::save_breakpoints_file(&project_dir, &[bp("/proj/a.go", 10)], false)
            .expect("seed");

        let loaded = get_breakpoints(&ctx, &f.project_id).await.expect("load");
        assert_eq!(loaded.iter().map(|b| b.line).collect::<Vec<_>>(), vec![10]);

        set_breakpoints(
            &ctx,
            &f.project_id,
            "/proj/a.go",
            vec![line(20, true)],
            None,
        )
        .await
        .expect("set");

        let after = get_breakpoints(&ctx, &f.project_id).await.expect("get");
        assert_eq!(
            after.iter().map(|b| b.line).collect::<Vec<_>>(),
            vec![20],
            "内存写入必须胜出（磁盘旧值不得回灌）: {after:?}"
        );
    }

    /// 坏掉的 `breakpoints.json` 必须可见（上抛），不伪装成"没有断点"。
    #[tokio::test]
    async fn corrupt_breakpoints_file_surfaces_error() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let f = DapFixture::new(&tmp);
        let ctx = f.ctx();
        let dir = tmp.path().join("proj/.neeko");
        std::fs::create_dir_all(&dir).expect("mkdir");
        std::fs::write(dir.join("breakpoints.json"), "{ not json").expect("write");

        let err = get_breakpoints(&ctx, &f.project_id)
            .await
            .expect_err("坏文件必须可见");
        assert!(matches!(err, AppError::Dap(_)), "got {err:?}");
    }

    /// 未知项目：`NotFound`（不把仓储标成"已装载"）。
    #[tokio::test]
    async fn unknown_project_maps_to_not_found() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let f = DapFixture::new(&tmp);
        let ctx = f.ctx();

        assert!(matches!(
            get_breakpoints(&ctx, "missing").await,
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            set_breakpoints(&ctx, "missing", "/a.go", Vec::new(), None).await,
            Err(AppError::NotFound(_))
        ));
    }
}
