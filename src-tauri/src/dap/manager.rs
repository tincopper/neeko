//! DAP session manager.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;

use super::adapter;
use super::adapter::SourcePathResolution;
use super::config::{
    expand_config, load_breakpoints_file, load_launch_file, save_breakpoints_file, save_launch_file,
};
use super::discover::{discover_entries, entry_to_launch_config, EntryPoint};
use super::session::DapSession;
use super::types::{
    BreakpointSpec, DapSessionInfo, LaunchConfig, LaunchFile, SessionStatus, StackFrameDto,
    VariableDto,
};
use crate::common::executor::factory::ExecTarget;
use crate::common::executor::ProcessGuard;
use crate::AppError;
use crate::AppStateWrapper;

/// Manages DAP debug sessions, breakpoints, and launch configurations.
pub struct DapManager {
    /// Active sessions by session_id, each carrying its attached debuggee.
    sessions: Mutex<HashMap<String, ManagedSession>>,
    /// Breakpoints keyed by project_id → file → lines.
    breakpoints: Mutex<HashMap<String, HashMap<String, Vec<u32>>>>,
    /// Projects whose breakpoints were loaded from disk this process.
    bp_loaded: Mutex<HashSet<String>>,
    /// 语言编排后端注册表（§9.4 方案 C）：`kind → backend`。
    /// 仅有编排差异的语言注册（当前仅 Java）；未注册走通用 spawn 路径。
    /// 用同步 `std::sync::Mutex`：组合根装配与 kind 查询都是短临界区同步操作。
    backends: std::sync::Mutex<HashMap<String, Arc<dyn crate::dap::adapter::LanguageBackend>>>,
}

/// 会话条目：DAP 会话 + 其附属 debuggee（Java attach-first 的测试 JVM）。
///
/// 合并进单一表是刻意的：会话与 debuggee 同生共死，停止/替换只有
/// [`ManagedSession::shutdown`] 一条清理路径（原双 map 需 4 处手写同步，
/// 漏一处即 JVM 泄漏）。go/lldb 会话的 `debuggee` 为 `None`。
struct ManagedSession {
    session: Arc<DapSession>,
    /// Java attach-first 的 debuggee；`None` 表示无附属进程。
    debuggee: Option<ProcessGuard>,
}

impl ManagedSession {
    /// 先停 DAP 会话，再终止 debuggee —— attach 模式的 disconnect 只 detach、
    /// 不杀 debuggee，必须由 Neeko 兜底。
    async fn shutdown(self) {
        self.session.stop().await;
        if let Some(debuggee) = self.debuggee {
            debuggee.terminate().await;
        }
    }
}

impl Default for DapManager {
    fn default() -> Self {
        Self::new()
    }
}

impl DapManager {
    /// Create an empty DAP manager with no sessions or breakpoints.
    #[must_use]
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            breakpoints: Mutex::new(HashMap::new()),
            bp_loaded: Mutex::new(HashSet::new()),
            backends: std::sync::Mutex::new(HashMap::new()),
        }
    }

    /// 注册语言编排后端（组合根装配时调用；仅编排差异的语言需要）。
    #[allow(clippy::unwrap_used)]
    pub fn register_backend(
        &self,
        kind: &str,
        backend: Arc<dyn crate::dap::adapter::LanguageBackend>,
    ) {
        let mut backends = self.backends.lock().unwrap_or_else(|p| p.into_inner());
        backends.insert(kind.to_string(), backend);
    }

    /// 按语言 kind 查编排后端；未注册 → `None`（走通用 spawn 路径）。
    #[must_use]
    #[allow(clippy::unwrap_used)]
    pub fn backend_for(&self, kind: &str) -> Option<Arc<dyn crate::dap::adapter::LanguageBackend>> {
        self.backends
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(kind)
            .cloned()
    }

    /// List launch configs for a project from disk.
    pub fn list_configs(
        state: &AppStateWrapper,
        project_id: &str,
    ) -> Result<Vec<LaunchConfig>, AppError> {
        let path = project_path(state, project_id)?;
        Ok(load_launch_file(&path)?.configurations)
    }

    /// List configs; if empty, discover entry points and auto-write launch.json.
    pub fn list_or_discover_configs(
        state: &AppStateWrapper,
        project_id: &str,
    ) -> Result<Vec<LaunchConfig>, AppError> {
        let path = project_path(state, project_id)?;
        let existing = load_launch_file(&path)?.configurations;
        if !existing.is_empty() {
            return Ok(existing);
        }
        let entries = discover_entries(&path);
        if entries.is_empty() {
            return Ok(Vec::new());
        }
        let configurations: Vec<LaunchConfig> =
            entries.iter().map(entry_to_launch_config).collect();
        let file = LaunchFile {
            version: "0.1.0".into(),
            configurations: configurations.clone(),
        };
        // Best-effort persist so next open keeps them.
        let _ = save_launch_file(&path, &file);
        Ok(configurations)
    }

    /// Persist launch configs to disk for a project.
    pub fn save_configs(
        state: &AppStateWrapper,
        project_id: &str,
        configurations: Vec<LaunchConfig>,
    ) -> Result<(), AppError> {
        let path = project_path(state, project_id)?;
        let file = LaunchFile {
            version: "0.1.0".into(),
            configurations,
        };
        save_launch_file(&path, &file)
    }

    /// Discover entry points (main packages) for a project.
    pub fn discover_entries(
        state: &AppStateWrapper,
        project_id: &str,
    ) -> Result<Vec<EntryPoint>, AppError> {
        let path = project_path(state, project_id)?;
        Ok(discover_entries(&path))
    }

    /// Ensure disk breakpoints are in memory for this project.
    async fn ensure_breakpoints_loaded(
        &self,
        state: &AppStateWrapper,
        project_id: &str,
    ) -> Result<(), AppError> {
        {
            let loaded = self.bp_loaded.lock().await;
            if loaded.contains(project_id) {
                return Ok(());
            }
        }
        let path = project_path(state, project_id)?;
        let list = load_breakpoints_file(&path).unwrap_or_default();
        {
            let mut map = self.breakpoints.lock().await;
            let project = map.entry(project_id.to_string()).or_default();
            for b in list {
                project.entry(b.file_path).or_default().push(b.line);
            }
            for lines in project.values_mut() {
                lines.sort_unstable();
                lines.dedup();
            }
        }
        self.bp_loaded.lock().await.insert(project_id.to_string());
        Ok(())
    }

    async fn persist_breakpoints(
        &self,
        state: &AppStateWrapper,
        project_id: &str,
    ) -> Result<(), AppError> {
        let path = project_path(state, project_id)?;
        let list = self.get_breakpoints_memory(project_id).await;
        save_breakpoints_file(&path, &list)
    }

    async fn get_breakpoints_memory(&self, project_id: &str) -> Vec<BreakpointSpec> {
        let map = self.breakpoints.lock().await;
        let Some(project) = map.get(project_id) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for (file, lines) in project {
            for line in lines {
                out.push(BreakpointSpec {
                    file_path: file.clone(),
                    line: *line,
                    verified: false,
                });
            }
        }
        out.sort_by(|a, b| a.file_path.cmp(&b.file_path).then(a.line.cmp(&b.line)));
        out
    }

    /// Set breakpoints for a file in a project, persisting to disk and forwarding to the active session.
    pub async fn set_breakpoints(
        &self,
        state: &AppStateWrapper,
        project_id: &str,
        file_path: &str,
        lines: Vec<u32>,
        active_session_id: Option<&str>,
    ) -> Result<Vec<BreakpointSpec>, AppError> {
        self.ensure_breakpoints_loaded(state, project_id).await?;
        {
            let mut map = self.breakpoints.lock().await;
            let project = map.entry(project_id.to_string()).or_default();
            if lines.is_empty() {
                project.remove(file_path);
            } else {
                project.insert(file_path.to_string(), lines.clone());
            }
        }
        // Persist even if adapter set fails — UI state is source of truth offline.
        if let Err(e) = self.persist_breakpoints(state, project_id).await {
            log::warn!("[DAP] failed to persist breakpoints: {e}");
        }

        if let Some(sid) = active_session_id {
            if let Some(session) = self.get_session(sid).await {
                let (adapter_path, note) = match state.resolve_project(project_id) {
                    Ok((target, _)) => {
                        // live toggle 没有启动链路的 classpath 上下文，只能靠缓存命中。
                        // 断点身份翻译由语言后端承担：按**会话的适配器族**反查编排后端
                        // （Go/Lldb 会话恒走原样透传），不在此硬编码语言名。
                        let backend = self.backend_for(session.kind().as_str());
                        self.adapter_source_path(backend.as_deref(), state, &target, &[], file_path)
                            .await
                    }
                    // 环境解析失败：不改变既有行为，按规范身份下发（下游会给出自己的错误）。
                    Err(_) => (Some(PathBuf::from(file_path)), None),
                };
                if let Some(note) = &note {
                    session.emit_output("console", note);
                }
                let Some(adapter_path) = adapter_path else {
                    // 不可解析：不下发（伪路径会被适配器静默丢弃），回传规范身份 + 未验证。
                    return Ok(lines
                        .into_iter()
                        .map(|line| BreakpointSpec {
                            file_path: file_path.to_string(),
                            line,
                            verified: false,
                        })
                        .collect());
                };
                let returned = session
                    .set_breakpoints_for_file(&adapter_path.to_string_lossy(), &lines)
                    .await?;
                // 回传前端的一律是**规范身份**（前端用它匹配 tab / 黄线）。
                return Ok(returned
                    .into_iter()
                    .map(|bp| BreakpointSpec {
                        file_path: file_path.to_string(),
                        ..bp
                    })
                    .collect());
            }
        }

        Ok(lines
            .into_iter()
            .map(|line| BreakpointSpec {
                file_path: file_path.to_string(),
                line,
                verified: false,
            })
            .collect())
    }

    /// Translate one canonical source identity into a path the adapter can resolve.
    ///
    /// Returns `(Some(path), None)` when resolved, or `(None, Some(note))` when it is not —
    /// the caller decides whether to skip the breakpoint or surface the note.
    ///
    /// 语言差异（`jdt://…` → 真实路径）由 [`LanguageBackend::adapter_source_path`] 承担；
    /// `backend` 为 `None` 的语言（Go / Lldb）走原样透传（行为与既有状态一致）。
    async fn adapter_source_path(
        &self,
        backend: Option<&dyn crate::dap::adapter::LanguageBackend>,
        state: &AppStateWrapper,
        target: &ExecTarget,
        classpath: &[String],
        identity: &str,
    ) -> (Option<PathBuf>, Option<String>) {
        let resolution = match backend {
            Some(backend) => {
                backend
                    .adapter_source_path(state, target, classpath, identity)
                    .await
            }
            // 无编排后端的语言：无身份翻译，原样即适配器可读路径。
            None => crate::dap::adapter::SourcePathResolution::Adapter(PathBuf::from(identity)),
        };
        match resolution {
            SourcePathResolution::Adapter(path) => (Some(path), None),
            SourcePathResolution::Unresolvable { reason } => (
                None,
                Some(format!("Skipped the breakpoint(s) in {identity}: {reason}")),
            ),
        }
    }

    /// Translate a whole breakpoint set for the adapter (**adapter copy only**).
    ///
    /// Persistence and the payload returned to the frontend keep the canonical identity —
    /// only what reaches the DAP adapter is rewritten (java-debug accepts a real file path or a
    /// `jdt://…?<JDT handle>` uri, and Neeko cannot mint the handle).
    ///
    /// Unresolvable identities are **dropped** rather than forwarded: a pseudo-path is silently
    /// discarded by the adapter (`verified:false`) and the user only sees "the breakpoint never
    /// hit". Each such identity yields one note, emitted into the Debug Console once the session
    /// exists. An identity is translated once — a file usually has several breakpoint lines.
    async fn adapter_breakpoints(
        &self,
        backend: Option<&dyn crate::dap::adapter::LanguageBackend>,
        state: &AppStateWrapper,
        target: &ExecTarget,
        classpath: &[String],
        breakpoints: &[BreakpointSpec],
    ) -> (Vec<BreakpointSpec>, Vec<String>) {
        let mut translated: Vec<BreakpointSpec> = Vec::with_capacity(breakpoints.len());
        let mut notes: Vec<String> = Vec::new();
        let mut resolved: HashMap<String, Option<PathBuf>> = HashMap::new();

        for breakpoint in breakpoints {
            let path = match resolved.get(&breakpoint.file_path) {
                Some(cached) => cached.clone(),
                None => {
                    let (path, note) = self
                        .adapter_source_path(
                            backend,
                            state,
                            target,
                            classpath,
                            &breakpoint.file_path,
                        )
                        .await;
                    if let Some(note) = note {
                        notes.push(note);
                    }
                    resolved.insert(breakpoint.file_path.clone(), path.clone());
                    path
                }
            };
            if let Some(path) = path {
                translated.push(BreakpointSpec {
                    file_path: path.to_string_lossy().to_string(),
                    line: breakpoint.line,
                    verified: breakpoint.verified,
                });
            }
        }
        (translated, notes)
    }

    /// Get all breakpoints for a project from memory.
    pub async fn get_breakpoints(
        &self,
        state: &AppStateWrapper,
        project_id: &str,
    ) -> Result<Vec<BreakpointSpec>, AppError> {
        self.ensure_breakpoints_loaded(state, project_id).await?;
        Ok(self.get_breakpoints_memory(project_id).await)
    }

    /// Start a new DAP debug session for a project with the given config.
    pub async fn start_session(
        &self,
        state: &AppStateWrapper,
        app: tauri::AppHandle,
        project_id: &str,
        config_name: Option<String>,
        current_file: Option<String>,
    ) -> Result<DapSessionInfo, AppError> {
        let path = project_path(state, project_id)?;

        // Prefer existing launch.json; if empty, discover and materialize.
        let mut file = load_launch_file(&path)?;
        if file.configurations.is_empty() {
            let entries = discover_entries(&path);
            if !entries.is_empty() {
                file.configurations = entries.iter().map(entry_to_launch_config).collect();
                let _ = save_launch_file(&path, &file);
            }
        }

        let raw = if let Some(name) = config_name {
            file.configurations
                .into_iter()
                .find(|c| c.name == name)
                .ok_or_else(|| AppError::NotFound(format!("Launch config not found: {name}")))?
        } else {
            // Prefer config matching current file's package if possible.
            let configs = file.configurations;
            pick_config_for_file(&configs, current_file.as_deref(), &path)
                .or_else(|| configs.into_iter().next())
                .ok_or_else(|| {
                    AppError::Dap(
                        "No launch configurations and no entry points found \
                         (expected Go cmd/*/main.go or Rust src/main.rs)."
                            .into(),
                    )
                })?
        };

        self.launch_session(
            state,
            app,
            project_id,
            raw,
            current_file.as_deref(),
            SessionRoute::spawn(),
        )
        .await
    }

    /// Shared launch tail: stop existing project sessions, expand the config,
    /// attach breakpoints, start the session and register it.
    ///
    /// `endpoint` 选择会话形态：
    /// - `None` → 传统路径：解析 adapter 二进制并 spawn 子进程（go / lldb / Java-A）；
    /// - `Some(addr)` → 外部端点路径：直连 Neeko **不拥有**的 DAP 服务器（B'，服务器
    ///   长在 JDTLS JVM 内），不 spawn、无进程守卫、可用性由调用方的能力探测负责。
    ///
    /// `debuggee`（Java A 的测试 JVM 清理句柄）随会话在同一插入点落库，保证
    /// 「条目存在 ⟺ debuggee 被其持有」；函数任一路径提前返回时，句柄 drop 即触发
    /// `ProcessGuard` 的 RAII 终止，不泄漏 JVM（外部端点路径恒为 `None`）。
    async fn launch_session(
        &self,
        state: &AppStateWrapper,
        app: tauri::AppHandle,
        project_id: &str,
        raw_config: LaunchConfig,
        current_file: Option<&str>,
        route: SessionRoute<'_>,
    ) -> Result<DapSessionInfo, AppError> {
        // One active session per project.
        self.stop_project_sessions(project_id).await;

        let path = project_path(state, project_id)?;
        let env = state.project_environment(project_id)?;
        let target = env.to_exec_target();

        let SessionRoute { debuggee, endpoint } = route;
        let config = expand_config(&raw_config, &path, current_file);
        let bps = self.get_breakpoints(state, project_id).await?;
        // 断点身份 → 适配器可读的**真实文件路径**（java-debug 只认真实文件或带 JDT handle 的
        // `jdt://` uri，而 handle 取不到）。只翻**适配器副本**：持久化与回传前端仍是规范身份。
        // 语言差异由该语言的编排后端承担（Go/Lldb 无后端 → 原样透传）。
        let backend = self.backend_for(&config.type_);
        let (adapter_bps, breakpoint_notes) = self
            .adapter_breakpoints(backend.as_deref(), state, &target, &config.classpath, &bps)
            .await;

        let session = match endpoint {
            // 外部 DAP 端点（B'）：不 spawn、不查 adapter 覆盖、不看 is_available。
            Some(addr) => {
                DapSession::connect(
                    addr,
                    app,
                    project_id.to_string(),
                    path.to_string_lossy().to_string(),
                    config,
                    adapter_bps,
                )
                .await?
            }
            None => {
                // 用户显式 adapter 二进制覆盖（config `dap.adapterBinaries.<kind>`，对齐
                // Zed `dap.$ADAPTER.binary`）：resolve_spawn 用它而非默认探测。
                let kind = adapter::plugin_for(&config.type_)?.kind();
                let adapter_binary = load_dap_adapter_override(state, kind);
                DapSession::start(
                    app,
                    project_id.to_string(),
                    path.to_string_lossy().to_string(),
                    target,
                    config,
                    adapter_bps,
                    adapter_binary,
                )
                .await?
            }
        };

        // 未能翻译的断点必须**可见**：否则用户只看到"断点没命中"，无从判断是源码不可得
        // 还是断点本身错（B' 下适配器只会静默回 verified:false）。
        for note in &breakpoint_notes {
            session.emit_output("console", note);
        }

        let info = session.info().await;
        // 会话与 debuggee 同一插入点落库（原子）：消除「先插会话、后挂
        // debuggee」之间的并发停止泄漏窗口。
        self.sessions.lock().await.insert(
            session.session_id.clone(),
            ManagedSession { session, debuggee },
        );
        Ok(info)
    }

    /// Start a DAP debug session from a fully-specified config, bypassing
    /// launch.json entirely (editor inline test debug: synthetic lldb launch
    /// with program = test binary parsed from `cargo test --no-run` output).
    pub async fn start_session_config(
        &self,
        state: &AppStateWrapper,
        app: tauri::AppHandle,
        project_id: &str,
        raw_config: LaunchConfig,
    ) -> Result<DapSessionInfo, AppError> {
        self.launch_session(
            state,
            app,
            project_id,
            raw_config,
            None,
            SessionRoute::spawn(),
        )
        .await
    }

    /// 语言编排调试入口：按 `request` 的语言 kind 查编排后端（§9.4 方案 C），
    /// `backend.plan` 决策（Launch / Warming / Unavailable）→ `launch_session` 起会话。
    ///
    /// - Java A（attach-first）：plan 已 spawn 测试 JVM 并解析 jdwp 端口，route 携带
    ///   debuggee guard + 输出通道；本函数起 attach 会话后挂载 JVM 输出泵（管道关闭
    ///   ⟺ JVM 退出 ⟺ 会话结束，对齐原 `start_java_via_host` 的 `pump_output` 语义）。
    /// - Java B'（jdtls）：plan 已做能力探测（Ready/Warming/Unavailable），
    ///   Ready 时 route 携带外部端点，直连（`DapSession::connect`）。
    ///
    /// **不自动换引擎**（design §2.5）：不可用只返回 `DebugStartOutcome::Unavailable`，
    /// 由前端按 `statically_detectable` 决定询问还是报错。
    pub async fn start_language_debug(
        &self,
        state: &AppStateWrapper,
        app: tauri::AppHandle,
        request: crate::dap::adapter::DebugRequest,
    ) -> Result<crate::dap::adapter::DebugStartOutcome, AppError> {
        let (project_id, kind) = match &request {
            crate::dap::adapter::DebugRequest::JavaAttach { project_id, .. }
            | crate::dap::adapter::DebugRequest::JavaJdtls { project_id, .. } => {
                (project_id.clone(), "java")
            }
        };
        let backend = self.backend_for(kind).ok_or_else(|| {
            AppError::Dap(format!("no orchestration backend for debug kind {kind}"))
        })?;
        let plan = backend.plan(state, &request).await?;

        match plan {
            crate::dap::adapter::SessionPlan::Launch {
                route,
                config,
                notes,
            } => {
                let (debuggee, endpoint, output_rx) = match route {
                    crate::dap::adapter::SessionRoutePlan::Spawn {
                        debuggee,
                        debuggee_output,
                    } => (debuggee, None, debuggee_output),
                    crate::dap::adapter::SessionRoutePlan::Connect { endpoint } => {
                        (None, Some(endpoint), None)
                    }
                };
                let route = SessionRoute {
                    debuggee,
                    endpoint: endpoint.as_deref(),
                };
                let info = self
                    .launch_session(state, app, &project_id, *config, None, route)
                    .await?;
                // 未能翻译的断点必须**可见**（B' 适配器只会静默回 verified:false）。
                for note in &notes {
                    if let Some(session) = self.get_session(&info.session_id).await {
                        session.emit_output("console", note);
                    }
                }
                // 附属 debuggee 输出泵（Java-A 的测试 JVM）：管道关闭 ⟺ JVM 退出 ⟺
                // 会话结束。用户 Stop / 适配器 terminated 已收尾时，`finish_terminated`
                // 的幂等守卫让收尾成为 no-op。
                if let Some(output_rx) = output_rx {
                    if let Some(session) = self.get_session(&info.session_id).await {
                        let emit_session = Arc::clone(&session);
                        let exit_session = Arc::clone(&session);
                        tokio::spawn(async move {
                            super::launch_support::pump_output(
                                output_rx,
                                move |category, line| emit_session.emit_output(category, line),
                                move || async move {
                                    exit_session.debuggee_exited("Debuggee exited").await;
                                },
                            )
                            .await;
                        });
                    }
                }
                Ok(crate::dap::adapter::DebugStartOutcome::Session { session: info })
            }
            crate::dap::adapter::SessionPlan::Warming { detail } => {
                Ok(crate::dap::adapter::DebugStartOutcome::Warming { detail })
            }
            crate::dap::adapter::SessionPlan::Unavailable {
                message,
                statically_detectable,
            } => Ok(crate::dap::adapter::DebugStartOutcome::Unavailable {
                message,
                statically_detectable,
            }),
        }
    }

    /// Stop a DAP session by session_id.
    ///
    /// 单条清理路径：停 DAP 会话 → 终止附属 debuggee（Java-A 测试 JVM）。
    pub async fn stop_session(&self, session_id: &str) -> Result<(), AppError> {
        let entry = {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(session_id)
        };
        if let Some(entry) = entry {
            // 单条清理路径：停 DAP 会话 → 终止 debuggee。
            entry.shutdown().await;
            Ok(())
        } else {
            Err(AppError::NotFound(format!(
                "Session not found: {session_id}"
            )))
        }
    }

    /// Stop all DAP sessions for a project.
    pub async fn stop_project_sessions(&self, project_id: &str) {
        let to_stop: Vec<ManagedSession> = {
            let mut sessions = self.sessions.lock().await;
            let ids: Vec<String> = sessions
                .iter()
                .filter(|(_, m)| m.session.project_id == project_id)
                .map(|(id, _)| id.clone())
                .collect();
            ids.into_iter()
                .filter_map(|id| sessions.remove(&id))
                .collect()
        };
        for entry in to_stop {
            entry.shutdown().await;
        }
    }

    /// Get a session by session_id, if it exists.
    pub async fn get_session(&self, session_id: &str) -> Option<Arc<DapSession>> {
        self.sessions
            .lock()
            .await
            .get(session_id)
            .map(|m| Arc::clone(&m.session))
    }

    /// Get the active session info for a project, if any.
    pub async fn active_for_project(&self, project_id: &str) -> Option<DapSessionInfo> {
        let sessions = self.sessions.lock().await;
        for m in sessions.values() {
            if m.session.project_id == project_id {
                return Some(m.session.info().await);
            }
        }
        None
    }

    /// List all active DAP sessions.
    pub async fn list_sessions(&self) -> Vec<DapSessionInfo> {
        let sessions = self.sessions.lock().await;
        let mut out = Vec::new();
        for m in sessions.values() {
            out.push(m.session.info().await);
        }
        out
    }

    // ── 会话级操作（统一走 require_session；命令层只透传 id）─────────────────

    /// 按 id 取会话，缺失即 `NotFound` —— 会话级操作的**唯一**查找路径
    /// （命令层不再各自重复 `get_session` + 组错误）。
    async fn require_session(&self, session_id: &str) -> Result<Arc<DapSession>, AppError> {
        self.get_session(session_id)
            .await
            .ok_or_else(|| AppError::NotFound(format!("Session not found: {session_id}")))
    }

    /// 向会话发送控制动作（`continue` / `next` / `stepIn` / …）。
    pub async fn control(&self, session_id: &str, action: &str) -> Result<(), AppError> {
        self.require_session(session_id)
            .await?
            .control(action)
            .await
    }

    /// 当前暂停点的调用栈。
    pub async fn stack_trace(&self, session_id: &str) -> Result<Vec<StackFrameDto>, AppError> {
        self.require_session(session_id).await?.stack_trace().await
    }

    /// 按 `sourceReference` 取回虚拟源码（适配器侧不落盘的源码）。
    pub async fn source_content(
        &self,
        session_id: &str,
        source_reference: i64,
    ) -> Result<String, AppError> {
        self.require_session(session_id)
            .await?
            .source_content(source_reference)
            .await
    }

    /// 外部源码只读读取的**授权 + 解析**（凭据 = 「调试器正停在这份源码上」）。
    ///
    /// 会话存在 → 项目匹配 → 处于 Stopped → 请求的源码命中当前调用栈。
    ///
    /// **为什么要解析**：适配器给的 `Source.path` 未必是文件路径 ——
    /// B'（JDTLS 内 java-debug）对 JDK / 依赖类返回 `jdt://contents/…?<handle>`（`Source.path`
    /// 也是它），A（自写 host）返回 `java-src-cache` 解压路径，前端还可能传规范身份
    /// `jdt:/<module>/<pkg>/<Name>.java` —— 三者指向**同一份源码**。故统一经
    /// [`crate::dap::java_source_path`] 翻译成真实文件后再比对，**授权与读取共用同一个
    /// 解析结果**（否则会出现"授权通过但打开失败"）。
    ///
    /// 匹配两条路径：帧路径**原样**命中（A 路径 / 项目内文件），或**翻译后**与请求的翻译结果
    /// 一致（B' 的 `jdt://…` 帧 ↔ 前端身份）。翻译失败时按原样落回，交给「必须绝对路径」
    /// 的判定 fail-closed。
    ///
    /// 缺会话沿用 `require_session` 的统一 `NotFound`（模块契约：会话级操作只有这一条查找
    /// 路径）；**路径授权**相关的一切失败（项目不符 / 未停止 / 取栈失败 / 不可解析 / 不匹配）
    /// 统一返回同一拒绝错误，不暴露「该路径是否属于当前停止点」——差异化文案会把本命令变成
    /// 路径探针。栈帧重取即真相，无需授权状态表。
    pub async fn resolve_external_source(
        &self,
        state: &AppStateWrapper,
        project_id: &str,
        session_id: &str,
        path: &str,
    ) -> Result<(ExecTarget, PathBuf), AppError> {
        let session = self.require_session(session_id).await?;
        if session.project_id != project_id {
            return Err(super::external_source::deny());
        }
        if session.info().await.status != SessionStatus::Stopped.as_str() {
            return Err(super::external_source::deny());
        }
        let frames = session.stack_trace().await.map_err(|e| {
            log::debug!("[dap] external source authorization: stackTrace failed: {e}");
            super::external_source::deny()
        })?;

        let (target, _root) = state
            .resolve_project(project_id)
            .map_err(|_| super::external_source::deny())?;
        let backend = self.backend_for(session.kind().as_str());
        let resolved = self
            .authorize_external_source(state, &target, backend.as_deref(), &frames, path)
            .await?;
        Ok((target, resolved))
    }

    /// 外部源码的**授权 + 解析**核心：帧列表由调用方提供 ⇒ **可脱离真实会话单测**。
    ///
    /// 本函数是"能不能读这份源码"的唯一判定点，因此刻意只依赖三样输入：`state`（取翻译端口）、
    /// `target`（执行环境）、`frames`（调停点真相）。`DapManager` 只负责取会话与栈（会话所有权），
    /// 判定与翻译在此，二者都可被 `#[cfg(test)]` 用合成帧 + fake 端口覆盖。
    async fn authorize_external_source(
        &self,
        state: &AppStateWrapper,
        target: &ExecTarget,
        backend: Option<&dyn crate::dap::adapter::LanguageBackend>,
        frames: &[StackFrameDto],
        path: &str,
    ) -> Result<PathBuf, AppError> {
        let resolved = self
            .translated_source_path(backend, state, target, path)
            .await;

        // 解析结果必须是**绝对路径**才可读：相对路径（含拼根前的项目内相对路径）会落回
        // 项目内，绕过「外部源码」语义 —— 直接拒绝，不上溯。
        if !resolved.is_absolute() {
            return Err(super::external_source::deny());
        }

        // 帧侧同样翻译成真实路径，再交给纯判定：**授权策略在 `external_source`**
        // （可取栈帧 / 翻译的编排留在这里）。按**唯一路径**去重后再翻译：一个栈里同一
        // 文件常有多个帧，重复翻译等于重复的 `spawn_blocking` 往返。
        let mut translated_frames: HashMap<&str, PathBuf> = HashMap::with_capacity(frames.len());
        for frame in frames {
            let Some(raw) = frame.source_path.as_deref() else {
                continue;
            };
            translated_frames.insert(
                raw,
                self.translated_source_path(backend, state, target, raw)
                    .await,
            );
        }
        let frame_sources: Vec<super::external_source::FrameSource<'_>> = translated_frames
            .iter()
            .map(|(raw, resolved)| super::external_source::FrameSource { raw, resolved })
            .collect();

        if super::external_source::is_authorized(path, &resolved, &frame_sources) {
            return Ok(resolved);
        }
        Err(super::external_source::deny())
    }

    /// 翻译身份 → 真实路径；不可解析时**原样返回**（由调用方按「必须绝对路径」fail-closed）。
    async fn translated_source_path(
        &self,
        backend: Option<&dyn crate::dap::adapter::LanguageBackend>,
        state: &AppStateWrapper,
        target: &ExecTarget,
        identity: &str,
    ) -> PathBuf {
        self.adapter_source_path(backend, state, target, &[], identity)
            .await
            .0
            .unwrap_or_else(|| PathBuf::from(identity))
    }

    /// 指定栈帧的变量（作用域展开后的一层）。
    pub async fn variables(
        &self,
        session_id: &str,
        frame_id: i64,
    ) -> Result<Vec<VariableDto>, AppError> {
        self.require_session(session_id)
            .await?
            .scopes_variables(frame_id)
            .await
    }

    /// `variablesReference` 的子变量（懒展开）。
    pub async fn variables_by_reference(
        &self,
        session_id: &str,
        reference: i64,
    ) -> Result<Vec<VariableDto>, AppError> {
        self.require_session(session_id)
            .await?
            .variables_by_reference(reference)
            .await
    }

    /// 求值表达式（`frame_id` 为空时走会话默认帧）。
    pub async fn evaluate(
        &self,
        session_id: &str,
        expression: &str,
        frame_id: Option<i64>,
    ) -> Result<String, AppError> {
        self.require_session(session_id)
            .await?
            .evaluate(expression, frame_id)
            .await
    }

    /// 适配器在**项目环境**（Local / WSL / SSH）内是否可用。
    ///
    /// 环境解析是编排层职责，命令层只透传 —— 与 `commands` 的 `dap_check_adapter`
    /// 一一对应。
    pub async fn check_adapter(
        state: &AppStateWrapper,
        project_id: &str,
        adapter_type: &str,
    ) -> Result<bool, AppError> {
        let target = state.project_environment(project_id)?.to_exec_target();
        Ok(adapter::adapter_available(adapter_type, &target).await)
    }
}

/// Prefer a launch config whose program path is a parent of the current file.
fn pick_config_for_file(
    configs: &[LaunchConfig],
    current_file: Option<&str>,
    workspace: &std::path::Path,
) -> Option<LaunchConfig> {
    let file = current_file?;
    let file_path = std::path::Path::new(file);
    let mut best: Option<(usize, LaunchConfig)> = None;
    for cfg in configs {
        let Some(prog) = cfg.program.as_ref() else {
            continue;
        };
        let expanded = super::config::expand_variables(prog, workspace, current_file);
        let prog_path = std::path::Path::new(&expanded);
        if file_path.starts_with(prog_path) {
            let score = expanded.len();
            if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
                best = Some((score, cfg.clone()));
            }
        }
    }
    best.map(|(_, c)| c)
}

fn project_path(state: &AppStateWrapper, project_id: &str) -> Result<PathBuf, AppError> {
    let pm = state.project_manager.lock().map_err(AppError::from)?;
    let project = pm
        .get_project(project_id)
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {project_id}")))?;
    Ok(project.path.clone())
}

/// 读取 config `dap.adapterBinaries.<kind>`（对齐 Zed `dap.$ADAPTER.binary`）：
/// 用户显式指定的 adapter 二进制（如自定义 codelldb / lldb-dap / dlv），
/// 存在则覆盖默认探测。配置缺省 / 空串 / 读取失败 → None（走默认探测）。
fn load_dap_adapter_override(
    state: &AppStateWrapper,
    kind: crate::dap::types::AdapterKind,
) -> Option<String> {
    let config = state.storage_manager.load_config().ok()?;
    let path = format!("/dap/adapterBinaries/{}", kind.as_str());
    config
        .pointer(&path)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// 会话形态：`spawn`（子进程：go / lldb / Java-A）或 `connect`（外部 DAP 端点：B'）。
///
/// 收进单一结构体，避免 `launch_session` 的参数继续膨胀（clippy `too_many_arguments`），
/// 也让"是否拥有子进程"这一点在调用点就显式。
struct SessionRoute<'a> {
    /// A（自写 host）的测试 JVM 清理句柄；仅 spawn 形态使用。
    debuggee: Option<ProcessGuard>,
    /// 外部 DAP 端点（`127.0.0.1:<port>`）；`None` 表示 spawn 形态。
    endpoint: Option<&'a str>,
}

impl SessionRoute<'_> {
    /// 传统 spawn 形态（go / lldb / Java-A）。
    const fn spawn() -> Self {
        Self {
            debuggee: None,
            endpoint: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dap::adapter::java::capability::JavaDebugCapability;
    use crate::session::StorageManager;

    /// 隔离的 `AppStateWrapper`：StorageManager 指向临时目录 —— 严禁用默认 `~/.neeko`，
    /// 否则 project 的 auto-save 会覆盖用户数据。与 `browser/url_validator` 测试同款。
    fn isolated_state(tmp: &tempfile::TempDir) -> AppStateWrapper {
        let storage = StorageManager::with_dir(tmp.path().join(".neeko")).expect("storage");
        let store = Arc::new(crate::library::LibraryStore::open_in_memory().expect("library"));
        AppStateWrapper::new_with_storage_and_library(storage, store)
    }

    /// 所有会话级操作共用 `require_session` → 缺失 id 必须统一映射为 `NotFound`。
    ///
    /// 命令层只透传 id，错误语义**在此层唯一确定**；前端据此区分「会话已结束」与
    /// 「参数非法」。若将来有人绕过 `require_session` 各自拼错误，本用例即红 ——
    /// 外部源码授权（`resolve_external_source`）也不例外：它只对**路径授权**失败
    /// 做统一拒绝，缺会话仍走 `NotFound`。
    #[tokio::test]
    async fn session_ops_map_missing_id_to_not_found() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);
        let manager = DapManager::new();
        let all_errors = vec![
            manager.control("missing", "continue").await.is_err(),
            manager.stack_trace("missing").await.is_err(),
            manager.variables("missing", 1).await.is_err(),
            manager.variables_by_reference("missing", 1).await.is_err(),
            manager.evaluate("missing", "x", None).await.is_err(),
            manager.source_content("missing", 1).await.is_err(),
            manager
                .resolve_external_source(&state, "p1", "missing", "/opt/lib/x.rs")
                .await
                .is_err(),
        ];
        assert_eq!(all_errors, vec![true; 7]);

        // 错误类型必须是 NotFound（而非 InvalidInput / Unknown）
        assert!(matches!(
            manager.control("missing", "continue").await,
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            manager.source_content("missing", 1).await,
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            manager
                .resolve_external_source(&state, "p1", "missing", "/opt/lib/x.rs")
                .await,
            Err(AppError::NotFound(_))
        ));
    }

    /// 环境解析在编排层：未知项目 → `project_environment` 的 `NotFound` 原样上抛，
    /// 不静默降级为「不可用」。
    #[tokio::test]
    async fn check_adapter_propagates_unknown_project_as_not_found() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);

        assert!(matches!(
            DapManager::check_adapter(&state, "no-such-project", "go").await,
            Err(AppError::NotFound(_))
        ));
    }

    struct FakeCapability(JavaDebugCapability);

    #[async_trait::async_trait]
    impl crate::dap::adapter::java::capability::JavaDebugCapabilityProvider for FakeCapability {
        async fn probe(
            &self,
            _project_path: &str,
            _test_class: &str,
            _project_name_candidate: Option<&str>,
        ) -> JavaDebugCapability {
            self.0.clone()
        }
    }

    /// 注册一个项目并注入指定探测结果，返回 (state, project_id)。
    fn java_route_state(
        tmp: &tempfile::TempDir,
        capability: JavaDebugCapability,
    ) -> (AppStateWrapper, String) {
        java_route_state_named(tmp, "proj", capability)
    }

    /// 与 [`java_route_state`] 同，但可指定项目目录名（回归"目录名会被当成项目名"的场景）。
    fn java_route_state_named(
        tmp: &tempfile::TempDir,
        dir_name: &str,
        capability: JavaDebugCapability,
    ) -> (AppStateWrapper, String) {
        let state = isolated_state(tmp);
        // 替换组合根装配的真实 Java 后端为 fake（探测结果由测试注入）。
        state.dap_manager.register_backend(
            "java",
            Arc::new(crate::dap::adapter::java::JavaBackend::new(
                Arc::new(FakeCapability(capability)),
                Arc::new(FakeSourcePath {
                    resolutions: vec![],
                }),
            )),
        );
        let project_dir = tmp.path().join(dir_name);
        std::fs::create_dir_all(&project_dir).expect("mkdir");
        let project = state
            .project_manager
            .lock()
            .expect("project_manager")
            .add_project(project_dir.clone(), None, None, None)
            .expect("add_project");
        (state, project.id)
    }

    /// 注入式源路径 fake：不构造 LSP/JDK，按身份直接给出结论；未列出的身份原样透传
    /// （模拟普通文件路径）。
    struct FakeSourcePath {
        resolutions: Vec<(String, SourcePathResolution)>,
    }

    #[async_trait::async_trait]
    impl crate::dap::adapter::java::source_path::JavaSourcePathProvider for FakeSourcePath {
        async fn adapter_source_path(
            &self,
            _target: &ExecTarget,
            _classpath: &[String],
            identity: &str,
        ) -> SourcePathResolution {
            self.resolutions
                .iter()
                .find(|(known, _)| known == identity)
                .map_or_else(
                    || SourcePathResolution::Adapter(PathBuf::from(identity)),
                    |(_, resolution)| resolution.clone(),
                )
        }
    }

    /// 就绪探测结果（断点翻译测试只需注入源路径 fake，能力探测恒就绪）。
    fn ready_capability() -> JavaDebugCapability {
        JavaDebugCapability::Ready {
            port: 1,
            module_paths: vec![],
            class_paths: vec!["/cp".into()],
            project_name: None,
        }
    }

    /// 注册项目 + 注入源路径结论。
    fn source_path_state(
        tmp: &tempfile::TempDir,
        resolutions: Vec<(&str, SourcePathResolution)>,
    ) -> (AppStateWrapper, String) {
        let (state, project_id) = java_route_state(tmp, ready_capability());
        state.dap_manager.register_backend(
            "java",
            Arc::new(crate::dap::adapter::java::JavaBackend::new(
                Arc::new(FakeCapability(ready_capability())),
                Arc::new(FakeSourcePath {
                    resolutions: resolutions
                        .into_iter()
                        .map(|(identity, resolution)| (identity.to_string(), resolution))
                        .collect(),
                }),
            )),
        );
        (state, project_id)
    }

    fn bp(file_path: &str, line: u32) -> BreakpointSpec {
        BreakpointSpec {
            file_path: file_path.to_string(),
            line,
            verified: false,
        }
    }

    /// 合成一个栈帧（`source_path` = adapter 原样给的路径/uri）。
    fn dap_frame(source_path: &str) -> StackFrameDto {
        StackFrameDto {
            id: 1,
            name: "frame".into(),
            source_path: Some(source_path.to_string()),
            line: 1,
            column: 0,
            source_name: None,
            source_reference: None,
        }
    }

    /// **B' 现场（可脱离会话单测）**：帧给 `jdt://…` uri、请求给规范身份 `jdt:/…`，
    /// 两者原样永不相等，只有翻译收敛到同一真实文件后才授权通过。
    #[tokio::test]
    async fn external_source_authorizes_when_translations_converge() {
        const REAL: &str = "/h/.neeko/java-src-cache/jdk-src-21/java.base/java/io/PrintStream.java";
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, _project) = source_path_state(
            &tmp,
            vec![
                (
                    "jdt:/java.base/java/io/PrintStream.java",
                    SourcePathResolution::Adapter(PathBuf::from(REAL)),
                ),
                (
                    "jdt://contents/java.base/java.io/PrintStream.class?=api/x",
                    SourcePathResolution::Adapter(PathBuf::from(REAL)),
                ),
            ],
        );
        let frames = [dap_frame(
            "jdt://contents/java.base/java.io/PrintStream.class?=api/x",
        )];

        let backend = state.dap_manager.backend_for("java");
        let resolved = state
            .dap_manager
            .authorize_external_source(
                &state,
                &ExecTarget::Local,
                backend.as_deref(),
                &frames,
                "jdt:/java.base/java/io/PrintStream.java",
            )
            .await
            .expect("翻译收敛后必须授权");
        assert_eq!(resolved, PathBuf::from(REAL));
    }

    /// 请求的源码**不在当前栈帧**里 → 拒绝（fail-closed：绝不越权读别的文件）。
    #[tokio::test]
    async fn external_source_denies_when_no_frame_matches() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, _project) = source_path_state(&tmp, vec![]);
        let frames = [dap_frame("/proj/src/A.java")];

        let backend = state.dap_manager.backend_for("java");
        let err = state
            .dap_manager
            .authorize_external_source(
                &state,
                &ExecTarget::Local,
                backend.as_deref(),
                &frames,
                "/other/B.java",
            )
            .await
            .expect_err("未命中帧必须拒绝");
        assert!(
            err.to_string()
                .contains("not a readable external debug stop"),
            "{err}"
        );
    }

    /// 解析成**相对路径** → 拒绝（相对路径拼根后会落回项目内，绕过「外部源码」语义）。
    #[tokio::test]
    async fn external_source_denies_relative_resolution() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, _project) = source_path_state(&tmp, vec![]);
        let frames = [dap_frame("src/rel.java")];

        let backend = state.dap_manager.backend_for("java");
        assert!(
            state
                .dap_manager
                .authorize_external_source(
                    &state,
                    &ExecTarget::Local,
                    backend.as_deref(),
                    &frames,
                    "src/rel.java",
                )
                .await
                .is_err(),
            "相对路径不得作为外部源码授权"
        );
    }

    /// 原样命中（A 路径 / 项目内文件，翻译即透传）→ 授权。
    #[tokio::test]
    async fn external_source_authorizes_on_raw_match() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, _project) = source_path_state(&tmp, vec![]);
        let frames = [dap_frame("/opt/lib/x.rs")];

        let backend = state.dap_manager.backend_for("java");
        let resolved = state
            .dap_manager
            .authorize_external_source(
                &state,
                &ExecTarget::Local,
                backend.as_deref(),
                &frames,
                "/opt/lib/x.rs",
            )
            .await
            .expect("原样命中必须授权");
        assert_eq!(resolved, PathBuf::from("/opt/lib/x.rs"));
    }

    /// JDK 源码身份被改写成**真实路径**；普通文件路径原样透传；规范身份（= 持久化与
    /// 回传前端用的那份）不被改动。
    #[tokio::test]
    async fn adapter_breakpoints_rewrite_only_the_adapter_copy() {
        let tmp = tempfile::tempdir().expect("tempdir");
        const REAL: &str =
            "/home/u/.neeko/java-src-cache/jdk-src-21.0.12.1/java.base/java/io/PrintStream.java";
        let (state, _project) = source_path_state(
            &tmp,
            vec![(
                "jdt:/java.base/java/io/PrintStream.java",
                SourcePathResolution::Adapter(PathBuf::from(REAL)),
            )],
        );

        let input = vec![
            bp("jdt:/java.base/java/io/PrintStream.java", 1167),
            bp("jdt:/java.base/java/io/PrintStream.java", 1200),
            bp("/proj/src/test/java/com/demo/CalcTest.java", 9),
        ];
        let (translated, notes) = DapManager::new()
            .adapter_breakpoints(
                state.dap_manager.backend_for("java").as_deref(),
                &state,
                &ExecTarget::Local,
                &[],
                &input,
            )
            .await;

        assert!(notes.is_empty(), "全部可解析不得产生诊断: {notes:?}");
        assert_eq!(translated.len(), 3);
        for breakpoint in &translated {
            assert!(
                !breakpoint.file_path.starts_with("jdt:"),
                "伪路径绝不允许下发: {}",
                breakpoint.file_path
            );
        }
        assert_eq!(translated[0].file_path, REAL);
        assert_eq!(translated[0].line, 1167);
        assert_eq!(translated[1].line, 1200);
        assert_eq!(
            translated[2].file_path,
            "/proj/src/test/java/com/demo/CalcTest.java"
        );
        // 输入（规范身份）不得被就地改写。
        assert_eq!(
            input[0].file_path,
            "jdt:/java.base/java/io/PrintStream.java"
        );
    }

    /// 不可解析 → **剔除**（不发伪路径）+ 每个身份只报一次（同一文件多行不刷屏）。
    #[tokio::test]
    async fn adapter_breakpoints_drop_unresolvable_and_note_once_per_identity() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, _project) = source_path_state(
            &tmp,
            vec![(
                "jdt:/java.base/java/io/PrintStream.java",
                SourcePathResolution::Unresolvable {
                    reason: "the JDK source archive is missing".into(),
                },
            )],
        );

        let input = vec![
            bp("jdt:/java.base/java/io/PrintStream.java", 1167),
            bp("jdt:/java.base/java/io/PrintStream.java", 1200),
            bp("/proj/src/Demo.java", 3),
        ];
        let (translated, notes) = DapManager::new()
            .adapter_breakpoints(
                state.dap_manager.backend_for("java").as_deref(),
                &state,
                &ExecTarget::Local,
                &[],
                &input,
            )
            .await;

        assert_eq!(translated.len(), 1, "只有可解析的那条能下发");
        assert_eq!(translated[0].file_path, "/proj/src/Demo.java");
        assert_eq!(notes.len(), 1, "同一身份只报一次: {notes:?}");
        assert!(
            notes[0].contains("jdt:/java.base/java/io/PrintStream.java"),
            "诊断要带上用户认得的身份: {}",
            notes[0]
        );
        assert!(notes[0].contains("the JDK source archive is missing"));
    }

    /// 已注册项目 + 未知 adapter 类型 → 走完 `project_environment` → `to_exec_target` →
    /// `adapter_available` 全链路，确定性得 `false`（未知 kind 不触碰文件系统/环境，
    /// 因此不受本机是否装了 dlv / lldb 影响）。
    #[tokio::test]
    async fn check_adapter_resolves_project_env_then_reports_unavailable() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let project_dir = tmp.path().join("proj");
        std::fs::create_dir_all(&project_dir).expect("mkdir");
        let state = isolated_state(&tmp);
        let project = state
            .project_manager
            .lock()
            .expect("project_manager")
            .add_project(project_dir, None, None, None)
            .expect("add_project");

        let result = DapManager::check_adapter(&state, &project.id, "no-such-adapter").await;
        assert!(matches!(result, Ok(false)), "got {result:?}");
    }
}
