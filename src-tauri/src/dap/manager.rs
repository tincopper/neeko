//! DAP session manager.

use std::path::PathBuf;
use std::sync::Arc;

use super::adapter::LanguageBackend;
use super::backends::BackendRegistry;
use super::breakpoints::service as breakpoint_service;
use super::breakpoints::BreakpointStore;
use super::context::DapContext;
use super::events::DapEventSink;
use super::launch;
use super::session::DapSession;
use super::sessions::SessionRegistry;
use super::source_translation;
use super::types::{
    AdapterKind, BreakpointLine, BreakpointSpec, DapSessionInfo, LaunchConfig, StackFrameDto,
    VariableDto,
};
use crate::common::executor::factory::ExecTarget;
use crate::AppError;
use crate::AppStateWrapper;

/// Manages DAP debug sessions, breakpoints, and launch configurations.
pub struct DapManager {
    /// 会话注册表（所有权 + debuggee 生命周期；per-project 查找）。
    sessions: SessionRegistry,
    /// 断点仓储（per-project 状态：断点表 + 静音位 + 装载位，单锁）。
    breakpoints: BreakpointStore,
    /// 语言编排后端注册表（`AdapterKind → backend`；锁与表同住）。
    backends: BackendRegistry,
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
            sessions: SessionRegistry::new(),
            breakpoints: BreakpointStore::new(),
            backends: BackendRegistry::new(),
        }
    }

    /// 组装用例上下文（惰性借用三个协作者 —— 门面保持对外 API 不变）。
    const fn context<'a>(&'a self, state: &'a AppStateWrapper) -> DapContext<'a> {
        DapContext {
            state,
            sessions: &self.sessions,
            breakpoints: &self.breakpoints,
            backends: &self.backends,
        }
    }

    /// 注册语言编排后端（组合根装配时调用；仅编排差异的语言需要）。
    pub fn register_backend(&self, kind: AdapterKind, backend: Arc<dyn LanguageBackend>) {
        self.backends.register(kind, backend);
    }

    /// 按语言 kind 查编排后端；未注册 → `None`（走通用 spawn 路径）。
    #[must_use]
    pub fn backend_for(&self, kind: AdapterKind) -> Option<Arc<dyn LanguageBackend>> {
        self.backends.get(kind)
    }

    // ── 断点门面（编排在 `breakpoints::service`）─────────────────────────────

    /// Set breakpoints for a file in a project（全量替换 + 落盘 + 下发活动会话）。
    ///
    /// 部分失败契约见 [`breakpoints::service::set_breakpoints`]。
    pub async fn set_breakpoints(
        &self,
        state: &AppStateWrapper,
        project_id: &str,
        file_path: &str,
        breakpoints: Vec<BreakpointLine>,
        active_session_id: Option<&str>,
    ) -> Result<Vec<BreakpointSpec>, AppError> {
        breakpoint_service::set_breakpoints(
            &self.context(state),
            project_id,
            file_path,
            breakpoints,
            active_session_id,
        )
        .await
    }

    /// Get all breakpoints for a project from memory.
    pub async fn get_breakpoints(
        &self,
        state: &AppStateWrapper,
        project_id: &str,
    ) -> Result<Vec<BreakpointSpec>, AppError> {
        breakpoint_service::get_breakpoints(&self.context(state), project_id).await
    }

    /// Get the global-mute flag for a project（`loadBreakpoints` 时与列表同取）。
    pub async fn get_breakpoints_muted(
        &self,
        state: &AppStateWrapper,
        project_id: &str,
    ) -> Result<bool, AppError> {
        breakpoint_service::get_breakpoints_muted(&self.context(state), project_id).await
    }

    /// Set the global-mute flag for a project：持久化 + 即时下发 effective 全集。
    pub async fn set_breakpoints_muted(
        &self,
        state: &AppStateWrapper,
        project_id: &str,
        muted: bool,
    ) -> Result<(), AppError> {
        breakpoint_service::set_breakpoints_muted(&self.context(state), project_id, muted).await
    }

    /// Stop a DAP session by session_id.
    ///
    /// 单条清理路径：停 DAP 会话 → 终止附属 debuggee（Java-A 测试 JVM）。
    pub async fn stop_session(&self, session_id: &str) -> Result<(), AppError> {
        // 先移出注册表（放锁），再 `shutdown`（停会话 + 杀 debuggee 都是 await）。
        let Some(entry) = self.sessions.take(session_id).await else {
            return Err(AppError::NotFound(format!(
                "Session not found: {session_id}"
            )));
        };
        entry.shutdown().await;
        Ok(())
    }

    /// Get a session by session_id, if it exists.
    pub async fn get_session(&self, session_id: &str) -> Option<Arc<DapSession>> {
        self.sessions.get(session_id).await
    }

    /// Get the active session info for a project, if any.
    ///
    /// 取 Arc 快照后**放锁**再 `info()`：`info()` 内部还锁会话自己的 status /
    /// status_message，持注册表锁跨 await 会把整张表串行化在数次 await 上。
    pub async fn active_for_project(&self, project_id: &str) -> Option<DapSessionInfo> {
        let session = self.sessions.first_for_project(project_id).await?;
        Some(session.info().await)
    }

    /// List all active DAP sessions.
    pub async fn list_sessions(&self) -> Vec<DapSessionInfo> {
        let sessions = self.sessions.snapshot().await;
        let mut out = Vec::with_capacity(sessions.len());
        for session in sessions {
            out.push(session.info().await);
        }
        out
    }

    // ── 启动门面（编排在 `launch`）───────────────────────────────────────────

    /// Start a new DAP debug session for a project with the given config.
    pub async fn start_session(
        &self,
        state: &AppStateWrapper,
        sink: Arc<dyn DapEventSink>,
        project_id: &str,
        config_name: Option<String>,
        current_file: Option<String>,
    ) -> Result<DapSessionInfo, AppError> {
        launch::start_session(
            &self.context(state),
            sink,
            project_id,
            config_name,
            current_file,
        )
        .await
    }

    /// Start a DAP debug session from a fully-specified config（编辑器内联测试调试）。
    pub async fn start_session_config(
        &self,
        state: &AppStateWrapper,
        sink: Arc<dyn DapEventSink>,
        project_id: &str,
        raw_config: LaunchConfig,
    ) -> Result<DapSessionInfo, AppError> {
        launch::start_session_config(&self.context(state), sink, project_id, raw_config).await
    }

    /// 语言编排调试入口（`plan` 三态 → 会话 / Warming / Unavailable）。
    pub async fn start_language_debug(
        &self,
        state: &AppStateWrapper,
        sink: Arc<dyn DapEventSink>,
        request: crate::dap::adapter::DebugRequest,
    ) -> Result<crate::dap::adapter::DebugStartOutcome, AppError> {
        launch::start_language_debug(&self.context(state), sink, request).await
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
    /// [`super::source_translation`] 翻译成真实文件后再比对，**授权与读取共用同一个
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
        if !session.is_stopped().await {
            return Err(super::external_source::deny());
        }
        let frames = session.stack_trace().await.map_err(|e| {
            log::debug!("[dap] external source authorization: stackTrace failed: {e}");
            super::external_source::deny()
        })?;

        let (target, _root) = state
            .resolve_project(project_id)
            .map_err(|_| super::external_source::deny())?;
        let backend = self.backend_for(session.kind());
        let resolved = source_translation::authorize_external_source(
            state,
            &target,
            backend.as_deref(),
            &frames,
            path,
        )
        .await?;
        Ok((target, resolved))
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
}

#[cfg(test)]
impl DapManager {
    /// 测试专用 seam：走**外部端点**形态起会话（不 spawn 进程，握手对着假适配器完成）。
    ///
    /// 生产路径的 `SessionRoute` 由 `launch::start_session(_config)` / `start_language_debug`
    /// 构造；这里让测试也能用同一个内核，避免测试各自复刻编排。
    pub(crate) async fn launch_via_endpoint(
        &self,
        state: &AppStateWrapper,
        sink: Arc<dyn DapEventSink>,
        project_id: &str,
        config: LaunchConfig,
        endpoint: &str,
    ) -> Result<DapSessionInfo, AppError> {
        launch::launch_session(
            &self.context(state),
            sink,
            project_id,
            config,
            None,
            launch::SessionRoute {
                debuggee: None,
                endpoint: Some(endpoint),
            },
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // AppState 夹具 / 假适配器 / 事件记录器由 `dap::testing` 提供（跨模块共用）。
    use crate::dap::testing::{
        go_launch_config, isolated_state, plain_project_state, FakeAdapter, RecordingSink,
    };
    // 断点夹具与翻译模块的单测共享（见 `dap::testing` / `dap::source_translation`）。
    use crate::dap::config::load_breakpoints_file;

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

    /// disabled 位与 muted 位随 `breakpoints.json` roundtrip（重启后禁用/静音仍在）。
    #[tokio::test]
    async fn set_breakpoints_persists_disabled_and_muted() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_id) = plain_project_state(&tmp);
        let manager = &state.dap_manager;

        manager
            .set_breakpoints(
                &state,
                &project_id,
                "/proj/a.go",
                vec![
                    BreakpointLine {
                        line: 10,
                        enabled: true,
                    },
                    BreakpointLine {
                        line: 20,
                        enabled: false,
                    },
                ],
                None,
            )
            .await
            .expect("set");
        manager
            .set_breakpoints_muted(&state, &project_id, true)
            .await
            .expect("mute");

        // 落盘 0.2.0：enabled + muted 都在。
        let loaded = load_breakpoints_file(&tmp.path().join("proj")).expect("load");
        assert_eq!(loaded.breakpoints.len(), 2);
        assert!(loaded
            .breakpoints
            .iter()
            .any(|b| b.line == 20 && !b.enabled));
        assert!(loaded.muted);

        // 读回：内存态与磁盘一致。
        assert!(manager
            .get_breakpoints_muted(&state, &project_id)
            .await
            .expect("get"));
        // unmute roundtrip。
        manager
            .set_breakpoints_muted(&state, &project_id, false)
            .await
            .expect("unmute");
        assert!(!manager
            .get_breakpoints_muted(&state, &project_id)
            .await
            .expect("get"));
    }

    /// 停止会话（门面契约）：从注册表移除 + 走唯一清理路径；重复停止是 `NotFound`。
    #[tokio::test]
    async fn stop_session_unregisters_and_is_idempotent_on_missing_id() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_id) = plain_project_state(&tmp);
        let adapter = FakeAdapter::start().await;
        let info = launch_via_fake_adapter(
            &state,
            RecordingSink::new(),
            &project_id,
            &adapter,
            go_launch_config("Go"),
        )
        .await
        .expect("launch");

        state
            .dap_manager
            .stop_session(&info.session_id)
            .await
            .expect("stop");
        assert!(state
            .dap_manager
            .get_session(&info.session_id)
            .await
            .is_none());
        assert!(state.dap_manager.list_sessions().await.is_empty());
        assert!(
            adapter.seen_commands().iter().any(|c| c == "disconnect"),
            "清理路径必须 disconnect: {:?}",
            adapter.seen_commands()
        );
        assert!(matches!(
            state.dap_manager.stop_session(&info.session_id).await,
            Err(AppError::NotFound(_))
        ));
    }

    // ── 编排链路端到端（假适配器 + 事件记录器）────────────────────────────────
    // 这些用例在 `DapEventSink` 端口抽出之前**无法编写**：构造会话要么需要
    // `tauri::AppHandle`（不能在 `#[cfg(test)]` 常驻），要么需要真实 dlv/lldb。
    // 现在用 `FakeAdapter`（TCP 上说 DAP 帧协议）覆盖会话建立 / 断点下发 /
    // mute 同步 / 停止清理整条链路。

    /// 走外部端点形态起会话（不 spawn 进程，握手对着假适配器完成）。
    async fn launch_via_fake_adapter(
        state: &AppStateWrapper,
        sink: Arc<dyn DapEventSink>,
        project_id: &str,
        adapter: &FakeAdapter,
        config: LaunchConfig,
    ) -> Result<DapSessionInfo, AppError> {
        state
            .dap_manager
            .launch_via_endpoint(state, sink, project_id, config, adapter.addr())
            .await
    }

    /// 外部源码授权链路（会话 + 栈帧 + 翻译）端到端：停在帧上才授权。
    #[tokio::test]
    async fn resolve_external_source_authorizes_only_on_current_frame() {
        use crate::dap::testing::{go_launch_config, wait_until};

        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_id) = plain_project_state(&tmp);
        // 平台绝对路径：`/opt/lib/...` 在 Windows 上无盘符前缀，Rust
        // `Path::is_absolute()` 返回 false，授权守卫（!is_absolute → deny）
        // 必拒；用 tempdir 推导，Windows（盘符）/ Unix 均为绝对路径
        // （与 source_translation.rs 单测同一修法）。
        let lib = tmp.path().join("lib").join("third_party.go");
        let lib_str = lib.to_string_lossy().to_string();
        let other_str = tmp
            .path()
            .join("lib")
            .join("other.go")
            .to_string_lossy()
            .to_string();
        let sink = RecordingSink::new();
        let adapter = FakeAdapter::start().await;
        adapter.set_stack_frames(vec![serde_json::json!({
            "id": 1,
            "name": "main",
            "line": 3,
            "column": 1,
            "source": { "path": lib_str.clone() },
        })]);
        let info = launch_via_fake_adapter(
            &state,
            sink.clone(),
            &project_id,
            &adapter,
            go_launch_config("Go"),
        )
        .await
        .expect("launch");

        // 未停止 → 拒绝（授权前置条件之一）。
        assert!(state
            .dap_manager
            .resolve_external_source(&state, &project_id, &info.session_id, &lib_str)
            .await
            .is_err());

        // stopped 事件经端口同步记录（`set_status` 内投递），故断言端口即可。
        adapter.emit_stopped();
        wait_until(|| sink.statuses().iter().any(|s| s == "stopped")).await;

        let manager = &state.dap_manager;
        // 命中帧 → 授权；未命中帧 → 拒绝（fail-closed）。
        let (_, resolved) = manager
            .resolve_external_source(&state, &project_id, &info.session_id, &lib_str)
            .await
            .expect("命中帧必须授权");
        assert_eq!(resolved, lib);
        assert!(manager
            .resolve_external_source(&state, &project_id, &info.session_id, &other_str)
            .await
            .is_err());
    }
}
