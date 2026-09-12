//! DAP session manager.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;

use super::adapter;
use super::config::{
    expand_config, load_breakpoints_file, load_launch_file, save_breakpoints_file, save_launch_file,
};
use super::discover::{discover_entries, entry_to_launch_config, EntryPoint};
use super::java_debuggee::JavaDebuggee;
use super::session::DapSession;
use super::types::{
    BreakpointSpec, DapSessionInfo, JavaDebugTarget, LaunchConfig, LaunchFile, SessionStatus,
    StackFrameDto, VariableDto,
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
        }
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
                return session.set_breakpoints_for_file(file_path, &lines).await;
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

        self.launch_session(state, app, project_id, raw, current_file.as_deref(), None)
            .await
    }

    /// Shared launch tail: stop existing project sessions, expand the config,
    /// attach breakpoints, start the session and register it.
    ///
    /// `debuggee`（Java attach-first 的测试 JVM 清理句柄）随会话在同一插入点
    /// 落库，保证「条目存在 ⟺ debuggee 被其持有」；函数任一路径提前返回时，
    /// 句柄 drop 即触发 `ProcessGuard` 的 RAII 终止，不泄漏 JVM。
    async fn launch_session(
        &self,
        state: &AppStateWrapper,
        app: tauri::AppHandle,
        project_id: &str,
        raw_config: LaunchConfig,
        current_file: Option<&str>,
        debuggee: Option<ProcessGuard>,
    ) -> Result<DapSessionInfo, AppError> {
        // One active session per project.
        self.stop_project_sessions(project_id).await;

        let path = project_path(state, project_id)?;
        let env = state.project_environment(project_id)?;
        let target = env.to_exec_target();

        let config = expand_config(&raw_config, &path, current_file);
        let bps = self.get_breakpoints(state, project_id).await?;
        // 用户显式 adapter 二进制覆盖（config `dap.adapterBinaries.<kind>`，对齐
        // Zed `dap.$ADAPTER.binary`）：resolve_spawn 用它而非默认探测。
        let kind = adapter::plugin_for(&config.type_)?.kind();
        let adapter_binary = load_dap_adapter_override(state, kind);

        let session = DapSession::start(
            app,
            project_id.to_string(),
            path.to_string_lossy().to_string(),
            target,
            config,
            bps,
            adapter_binary,
        )
        .await?;

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
        self.launch_session(state, app, project_id, raw_config, None, None)
            .await
    }

    /// Java attach-first 全流程：spawn 测试 JVM（Console Launcher +
    /// jdwp suspend=y，`command` 由前端构造）→ 解析 jdwp 监听端口 → 起
    /// JavaAdapter 的 DAP attach 会话 → 跟踪 JVM 随会话清理。
    ///
    /// `command` 形态（buildJavaDebugCommand 的产物）：
    ///   `java -agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=0
    ///    -jar junit-platform-console-standalone.jar -c <FQCN> -m '<FQCN#method>'
    ///    --reports-dir=<dir>`
    /// `address=0` 让 JVM 自选空闲端口并打印
    /// `Listening for transport dt_socket at address: <port>`（stdout），
    /// host 侧 attach 走 SocketAttachingConnector（无 classPaths 校验）。
    ///
    /// `classpath` 为 debuggee 的运行时 classpath 条目（前端
    /// `buildJavaClasspathEntries` 产物）：随 attach 载荷的 `sourcePaths` 送达
    /// host，供其解析第三方库 / JDK 源码（见 `adapter::java`）。
    pub async fn start_java_attach(
        &self,
        state: &AppStateWrapper,
        app: tauri::AppHandle,
        project_id: &str,
        target: &JavaDebugTarget,
    ) -> Result<DapSessionInfo, AppError> {
        let JavaDebugTarget {
            command,
            cwd,
            test_name,
            classpath,
        } = target;
        if command.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "java debug command must not be empty".into(),
            ));
        }
        if cwd.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "java debug cwd must not be empty".into(),
            ));
        }
        let (target, project_root) = state.resolve_project(project_id)?;
        let dir = super::launch_support::resolve_build_dir(&target, &project_root, cwd).await?;
        // Windows 本地经 cmd /C：POSIX 单引号转 cmd 双引号（对齐 debug_build_test_binary）。
        let command = if matches!(target, ExecTarget::Local) && cfg!(windows) {
            super::launch_support::windows_cmd_quote(command)
        } else {
            command.clone()
        };
        let (shell, args) = super::launch_support::build_shell_argv(&command);

        // ── 1-3. spawn 测试 JVM → 解析 jdwp 端口 → 输出泵 + 清理句柄 ───────────
        // 进程生命周期内聚在 JavaDebuggee（失败路径自带清理）。
        let JavaDebuggee {
            port,
            output_rx: mut java_out_rx,
            guard,
        } = JavaDebuggee::launch(&target, shell, &args, dir.as_str()).await?;

        // ── 4. attach 会话（JavaAdapter.build_launch_args 消费 port）───────────
        let config = LaunchConfig {
            name: format!("Debug test: {test_name}"),
            type_: "java".into(),
            request: "attach".into(),
            program: None,
            cwd: Some(dir),
            args: vec![],
            mode: None,
            port: Some(port),
            pre_launch_task: None,
            stop_on_entry: Some(false),
            classpath: classpath.clone(),
        };
        // guard 随会话条目落库 → 停止/替换/进程退出统一收敛（单一清理路径）。
        match self
            .launch_session(state, app, project_id, config, None, Some(guard))
            .await
        {
            Ok(info) => {
                // JVM 管道输出 → DAP output 事件（与 adapter proc_out 同形，
                // 前端按 stdout/stderr 分类渲染进 Debug Console）。
                if let Some(session) = self.get_session(&info.session_id).await {
                    tokio::spawn(async move {
                        while let Some((category, line)) = java_out_rx.recv().await {
                            session.emit_output(&category, &line).await;
                        }
                    });
                }
                Ok(info)
            }
            // 会话启动失败（如 host jar 缺失）→ guard 在 launch_session 内 drop，
            // `ProcessGuard::drop` 触发 kill，防 debuggee JVM 泄漏。
            Err(e) => Err(e),
        }
    }

    /// Stop a DAP session by session_id.
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

    /// 外部源码只读读取的授权校验（凭据 = 「调试器正停在该文件」）。
    ///
    /// 会话存在 → 项目匹配 → 处于 Stopped → `path` 命中当前调用栈某一帧路径。
    ///
    /// 缺会话沿用 `require_session` 的统一 `NotFound`（模块契约：会话级操作只有
    /// 这一条查找路径）；**路径授权**相关的一切失败（项目不符 / 未停止 / 取栈失败 /
    /// 路径不匹配）统一返回同一拒绝错误，不暴露「该路径是否属于当前停止点」——
    /// 差异化文案会把本命令变成路径探针。栈帧重取即真相，无需授权状态表。
    pub async fn assert_stopped_at_path(
        &self,
        project_id: &str,
        session_id: &str,
        path: &str,
    ) -> Result<(), AppError> {
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
        if super::external_source::frame_paths_match(&frames, path) {
            Ok(())
        } else {
            Err(super::external_source::deny())
        }
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

#[cfg(test)]
mod tests {
    use super::*;
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
    /// 外部源码授权（`assert_stopped_at_path`）也不例外：它只对**路径授权**失败
    /// 做统一拒绝，缺会话仍走 `NotFound`。
    #[tokio::test]
    async fn session_ops_map_missing_id_to_not_found() {
        let manager = DapManager::new();
        let all_errors = vec![
            manager.control("missing", "continue").await.is_err(),
            manager.stack_trace("missing").await.is_err(),
            manager.variables("missing", 1).await.is_err(),
            manager.variables_by_reference("missing", 1).await.is_err(),
            manager.evaluate("missing", "x", None).await.is_err(),
            manager.source_content("missing", 1).await.is_err(),
            manager
                .assert_stopped_at_path("p1", "missing", "/opt/lib/x.rs")
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
                .assert_stopped_at_path("p1", "missing", "/opt/lib/x.rs")
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
