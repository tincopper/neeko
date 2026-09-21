//! LSP session manager: lifecycle, plugin discovery, diagnostics, and auto-start policies.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use tauri::Emitter;

use crate::common::runtime::AppRuntime;
use crate::AppError;

use super::diag_bus::{DiagnosticBus, DiagnosticEvent};
use super::plugin::{LspAutoStart, LspPlugin, LspPluginRegistry, LspSettings};
use super::plugin_manager::LspPluginManager;
use super::profile::detect_project_profile_with_markers;
use super::session::{do_send_request, emit_session_error, LspSession};
use super::session_factory::{IpcSessionFactory, SessionBuildRequest, SessionFactory};
use super::session_store::LspSessionStore;
use super::transport::{IpcTransport, LspTransport};
use super::types::{LspServerInfo, LspServerLogEntry, LspSessionInfo, LSP_PROFILE_EVENT};

// ── Re-exports ─────────────────────────────────────────────────────────

pub use super::profile::ProjectLanguageProfile;

// ── Constants ───────────────────────────────────────────────────────────

/// Maximum restart attempts before giving up on a session.
const MAX_RESTART_COUNT: u32 = 5;
/// Base delay for exponential backoff (ms).
const RESTART_BASE_DELAY_MS: u64 = 500;
/// Default: after a project is deactivated, wait this long before closing sessions.
const DEFAULT_DEACTIVATE_STOP_SECS: u64 = 30 * 60;

/// 请求失败后允许对会话做的事 —— 区分**用户意图请求**与**观察请求**。
///
/// 拆成策略而不是再挂一个 bool：`is_probe` 已经表示"单飞桶语义"，两者正交，
/// 两个 bool 并列会让调用点无法自解释。新增调用场景时扩展本枚举即可（开闭）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RequestPolicy {
    /// 用户意图请求（导航 / 补全 / 定义…）：失败即重启会话后重试（既有行为）。
    RestartOnFailure,
    /// 观察请求（能力探测…）：失败只报错，**不重启、不新建**会话。
    Never,
}

/// Compute the restart delay with exponential backoff.
const fn compute_restart_delay(attempt: u32, base_ms: u64) -> Duration {
    Duration::from_millis(base_ms * 2_u64.saturating_pow(attempt))
}
/// Whether a session should be restarted based on current attempt count.
#[must_use]
pub const fn should_restart(current_count: u32, max_count: u32) -> bool {
    current_count < max_count
}

fn session_key(project_path: &str, language_id: &str) -> String {
    format!("{}:{}", project_path, language_id)
}

/// didOpen 归一决策（抽纯函数以便直接单测两条关键路径：重复 didOpen / 版本回退）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DidOpenAction {
    /// 登记表无记录：直接 didOpen。
    PlainOpen,
    /// 登记表已有记录：先补 didClose 再 didOpen。
    ///
    /// `version_regressed`：本次版本**低于**登记版本 —— 真实回退（告警级）；
    /// 相等（编辑器在后端代开后以同版本接管，常见 v0==v0）或更高则非回退
    /// （debug 级记录，不误报）。
    Reopen { version_regressed: bool },
}

/// 由「登记表 previous 版本 + 本次版本」得出 didOpen 归一决策。
#[must_use]
const fn did_open_action(previous: Option<i64>, version: i64) -> DidOpenAction {
    match previous {
        None => DidOpenAction::PlainOpen,
        Some(prev) => DidOpenAction::Reopen {
            version_regressed: version < prev,
        },
    }
}

/// 会话关闭语义：决定要不要向状态栏宣告"该语言的会话就此结束"。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionCloseNotice {
    /// 会话结束（用户停止 / 项目停用 / 应用退出）：推 `stopped`。
    Announce,
    /// 会话即将被同 project+language 的新会话**替换**（重启）：静默。
    /// 详见 [`LspManager::close_session_for_restart`]。
    Silent,
}

// ── LspManager ──────────────────────────────────────────────────────────

/// Coordinates LSP session lifecycle, plugin management, and project profiles.
///
/// Owns an [`LspSessionStore`] for session state and an [`LspPluginManager`]
/// for plugin discovery. Cross-domain operations (e.g., deactivate closing
/// sessions) are orchestrated here.
pub struct LspManager {
    /// Business async executor (never bare `tokio::spawn`).
    runtime: Arc<AppRuntime>,
    /// Session lifecycle and document tracking.
    session_store: LspSessionStore,
    /// Plugin discovery, registration, and project execution targets.
    plugin_manager: LspPluginManager,
    /// Diagnostic event bus for pub/sub.
    diag_bus: DiagnosticBus,
    /// Tauri AppHandle for event emission.
    app_handle: Mutex<Option<tauri::AppHandle>>,
    /// Session assembly port (DIP): manager orchestrates lifecycle, the port owns
    /// transport/session construction. Swappable in tests to cover failure paths
    /// without a Tauri runtime.
    session_factory: Arc<dyn SessionFactory>,
    /// Cached language profiles per project path.
    profiles: Mutex<HashMap<String, ProjectLanguageProfile>>,
    /// Generation counter per project path to cancel pending deactivate timers.
    deactivate_gens: Mutex<HashMap<String, u64>>,
    /// Seconds after deactivation before closing sessions (from settings).
    deactivate_stop_secs: Mutex<u64>,
    /// Definition-target uris pre-authorized for out-of-root reads (per session).
    preauth: Mutex<super::preauth::PreauthorizedTargets>,
    /// Per-key creation gates: serialize concurrent `get_or_create_session`
    /// for the same (project, language) so only one slow `LspSession::new`
    /// runs at a time. Lives on the manager rather than the store: the store
    /// owns pure session state (kept API-stable), while creation
    /// serialization is a manager-level orchestration concern. parking_lot
    /// (no poisoning) because the gate is held across the spawn.
    creation_locks: parking_lot::Mutex<HashMap<String, Arc<parking_lot::Mutex<()>>>>,
}

impl LspManager {
    /// Create a manager that schedules work on the given business runtime.
    #[must_use]
    pub fn new(runtime: Arc<AppRuntime>) -> Self {
        Self::with_session_factory(runtime, Arc::new(IpcSessionFactory))
    }

    /// Create a manager with an injected session-assembly port.
    ///
    /// 测试据此在不依赖 Tauri 运行时（`tauri::AppHandle` 无法常驻 `#[cfg(test)]`）
    /// 的前提下驱动 `get_or_create_session` 的成功 / 失败路径。
    #[must_use]
    pub(crate) fn with_session_factory(
        runtime: Arc<AppRuntime>,
        session_factory: Arc<dyn SessionFactory>,
    ) -> Self {
        let diag_bus = DiagnosticBus::new();

        Self {
            runtime,
            session_store: LspSessionStore::new(),
            plugin_manager: LspPluginManager::new(),
            diag_bus,
            app_handle: Mutex::new(None),
            session_factory,
            profiles: Mutex::new(HashMap::new()),
            deactivate_gens: Mutex::new(HashMap::new()),
            deactivate_stop_secs: Mutex::new(DEFAULT_DEACTIVATE_STOP_SECS),
            preauth: Mutex::new(super::preauth::PreauthorizedTargets::new()),
            creation_locks: parking_lot::Mutex::new(HashMap::new()),
        }
    }

    /// Record which environment a project path uses (for PATH/binary checks).
    pub fn set_project_exec_target(
        &self,
        project_path: &str,
        target: crate::common::executor::factory::ExecTarget,
    ) {
        self.plugin_manager
            .set_project_exec_target(project_path, target);
    }

    /// Execution target previously recorded for a project path.
    pub fn project_exec_target(
        &self,
        project_path: &str,
    ) -> Option<crate::common::executor::factory::ExecTarget> {
        self.plugin_manager.project_exec_target(project_path)
    }

    /// Require a recorded execution target, or return a clear LSP error.
    pub fn require_project_exec_target(
        &self,
        project_path: &str,
    ) -> Result<crate::common::executor::factory::ExecTarget, AppError> {
        self.plugin_manager
            .require_project_exec_target(project_path)
    }

    /// Convenience constructor for tests / simple call sites.
    #[must_use]
    pub fn new_default() -> Self {
        Self::new(AppRuntime::shared_default())
    }

    /// Business executor used for session spawn / timers (Scheme C).
    pub fn runtime(&self) -> Arc<AppRuntime> {
        Arc::clone(&self.runtime)
    }

    /// Resolve language id for a file path from the live plugin registry (custom first).
    pub fn resolve_language_for_path(&self, file_path: &str) -> Option<String> {
        self.plugin_manager.resolve_language_for_path(file_path)
    }

    /// Apply LSP settings from config.json (`lsp` object).
    pub fn apply_settings(&self, settings: &LspSettings) {
        if let Err(e) = self._apply_settings_internal(settings) {
            log::warn!("[LSP] Failed to apply settings: {}", e);
        }
    }

    fn _apply_settings_internal(&self, settings: &LspSettings) -> Result<(), AppError> {
        *self
            .deactivate_stop_secs
            .lock()
            .map_err(|e| AppError::Lsp(e.to_string()))? =
            settings.deactivate_stop_minutes.saturating_mul(60).max(60);

        let policy = LspAutoStart::parse(&settings.auto_start);
        self.plugin_manager.set_default_auto_start(policy);

        self.plugin_manager.apply_settings(settings)?;

        Ok(())
    }

    /// Apply LSP settings from a full app config JSON value.
    pub fn apply_settings_from_json(&self, config: &serde_json::Value) {
        let settings = config
            .get("lsp")
            .cloned()
            .and_then(|v| serde_json::from_value::<LspSettings>(v).ok())
            .unwrap_or_default();
        self.apply_settings(&settings);
    }

    /// Get the extension-to-language map from the plugin registry.
    pub fn extension_map(&self) -> Vec<super::plugin::LspExtensionMapEntry> {
        self.plugin_manager.extension_map()
    }

    /// Extension conflicts from the live registry (later registration wins).
    pub fn extension_conflicts(&self) -> Vec<super::plugin::LspExtensionConflict> {
        self.plugin_manager.extension_conflicts()
    }

    /// Access the diagnostic bus (for hooking up transport subscribers).
    pub const fn diag_bus(&self) -> &DiagnosticBus {
        &self.diag_bus
    }

    /// Access the plugin manager.
    pub const fn plugin_manager(&self) -> &LspPluginManager {
        &self.plugin_manager
    }

    /// Server binary name for a language id from the live plugin registry.
    pub fn plugin_server_binary(&self, language_id: &str) -> Option<String> {
        self.plugin_manager.plugin_server_binary(language_id)
    }

    /// Register a custom LSP plugin at runtime (e.g. from user settings).
    pub fn register_plugin(&self, plugin: LspPlugin) {
        self.plugin_manager.register_plugin(plugin);
    }

    /// Register an open document for session restart recovery.
    pub fn register_open_document(
        &self,
        project_path: &str,
        language_id: &str,
        uri: &str,
        text: &str,
        version: i64,
    ) {
        let key = session_key(project_path, language_id);
        self.session_store.register_open_document(
            key,
            super::session_store::OpenDocument {
                uri: uri.to_string(),
                language_id: language_id.to_string(),
                text: text.to_string(),
                version,
            },
        );
    }

    /// Record definition-target uris as pre-authorized for out-of-root reads.
    pub fn record_definition_targets(
        &self,
        project_path: &str,
        language_id: &str,
        uris: &[String],
    ) {
        if uris.is_empty() {
            return;
        }
        if let Ok(mut preauth) = self.preauth.lock() {
            preauth.record(project_path, language_id, uris);
        }
    }

    /// Whether the uri is a pre-authorized definition target for this session.
    #[must_use]
    pub fn is_preauthorized(&self, project_path: &str, language_id: &str, uri: &str) -> bool {
        self.preauth
            .lock()
            .map(|preauth| preauth.is_authorized(project_path, language_id, uri))
            .unwrap_or(false)
    }

    /// Check whether a document is already registered as open for this session.
    pub fn is_document_open(&self, project_path: &str, language_id: &str, uri: &str) -> bool {
        let key = session_key(project_path, language_id);
        self.session_store.is_document_open(&key, uri)
    }

    /// 前端视图声明持有该文档（挂载时）。
    pub fn claim_document(&self, project_path: &str, language_id: &str, uri: &str) {
        self.session_store
            .claim_document(session_key(project_path, language_id), uri.to_string());
    }

    /// 前端视图释放持有（最后一个视图卸载时）。
    pub fn release_document(&self, project_path: &str, language_id: &str, uri: &str) {
        self.session_store
            .release_document(&session_key(project_path, language_id), uri);
    }

    /// 该文档是否正被编辑器视图持有 —— 持有期间后端**不得**代开（否则会用磁盘文本
    /// 覆盖编辑器未保存的缓冲区，服务器随即按旧文本报出错位诊断）。
    #[must_use]
    pub fn is_editor_owned(&self, project_path: &str, language_id: &str, uri: &str) -> bool {
        self.session_store
            .is_editor_owned(&session_key(project_path, language_id), uri)
    }

    /// 已登记版本号（未登记为 `None`）—— 鉴定「第二个 client 的独立计数器」用。
    #[must_use]
    pub fn open_document_version(
        &self,
        project_path: &str,
        language_id: &str,
        uri: &str,
    ) -> Option<i64> {
        let key = session_key(project_path, language_id);
        self.session_store.open_document_version(&key, uri)
    }

    /// `textDocument/didOpen` 的**唯一出口**：必要时先补 `didClose`，再发送、再登记。
    ///
    /// 为什么收敛到一处（2026-09-21 实证）：后端曾有第三条 didOpen 路径（`lsp_request`
    /// 的内联代开）绕过登记，造成同一 uri 两条 didOpen、且服务器与客户端的文档版本分叉
    /// —— 服务器用 v1 推诊断，客户端文档是 v0，被 `@codemirror/lsp-client` 的版本门整批
    /// 丢弃，表现为「Problems 面板有诊断、编辑器没有波浪线/灯泡」。任何新增的 didOpen
    /// 发送者都必须走本方法，禁止自行拼参数直发。
    pub fn send_did_open(
        &self,
        project_path: &str,
        language_id: &str,
        uri: &str,
        text: &str,
        version: i64,
    ) -> Result<(), AppError> {
        let previous = self.open_document_version(project_path, language_id, uri);
        log::debug!(
            "[LSP] didOpen {} v={} (previous={:?})",
            uri,
            version,
            previous
        );
        match did_open_action(previous, version) {
            DidOpenAction::PlainOpen => {}
            DidOpenAction::Reopen { version_regressed } => {
                if version_regressed {
                    // 真实回退：登记表版本高于本次 —— 保留告警（非单调写入者）。
                    log::warn!(
                        "[LSP] non-monotonic didOpen for {}: v={} < previous v={} \
                         (a second writer is tracking this document)",
                        uri,
                        version,
                        previous.expect("reopen implies a previous version")
                    );
                } else {
                    // 同版本（编辑器在后端代开后接管，v0==v0）或更高版本重开：
                    // 行为照旧（didClose+didOpen 使文本对齐），仅 debug 记录，不误报。
                    log::debug!(
                        "[LSP] didOpen for {} at v={} (editor re-open after backend pre-open)",
                        uri,
                        version
                    );
                }
                log::warn!(
                    "[LSP] duplicate didOpen for {} ({}); closing before reopening",
                    uri,
                    language_id
                );
                self.send_notification(
                    project_path,
                    language_id,
                    "textDocument/didClose",
                    serde_json::json!({ "textDocument": { "uri": uri } }),
                )?;
            }
        }
        self.send_notification(
            project_path,
            language_id,
            "textDocument/didOpen",
            serde_json::json!({
                "textDocument": {
                    "uri": uri,
                    "languageId": language_id,
                    "version": version,
                    "text": text,
                }
            }),
        )?;
        self.register_open_document(project_path, language_id, uri, text, version);
        Ok(())
    }

    /// Unregister a closed document.
    pub fn unregister_open_document(&self, project_path: &str, language_id: &str, uri: &str) {
        let key = session_key(project_path, language_id);
        self.session_store.unregister_open_document(&key, uri);
    }

    /// Set the Tauri AppHandle and connect the diagnostic bus to event emission.
    pub fn set_app_handle(&self, app_handle: tauri::AppHandle) {
        let ah = app_handle.clone();
        let diag_subscriber = self.diag_bus.subscribe(move |event: &DiagnosticEvent| {
            let transport = IpcTransport::new(ah.clone());
            transport.push_diagnostics(
                &event.project_path,
                &event.uri,
                event.diagnostics.clone(),
                event.version,
            );
        });
        std::mem::forget(diag_subscriber);

        if let Ok(mut handle) = self.app_handle.lock() {
            *handle = Some(app_handle);
        }
    }

    /// Return the creation gate for a session key, creating it on first use.
    /// Only the map lookup-or-insert holds the map lock (short critical
    /// section); the returned gate serializes the slow creation path below.
    fn creation_gate(&self, key: &str) -> Arc<parking_lot::Mutex<()>> {
        let mut gates = self.creation_locks.lock();
        Arc::clone(
            gates
                .entry(key.to_string())
                .or_insert_with(|| Arc::new(parking_lot::Mutex::new(()))),
        )
    }

    /// Get an existing session or create a new one for the given project and language.
    pub fn get_or_create_session(
        &self,
        project_path: &str,
        language_id: &str,
        document_uri: Option<&str>,
    ) -> Result<String, AppError> {
        let key = session_key(project_path, language_id);

        // Fast path: alive session returns without touching the gate.
        if self.session_store.is_alive(&key) {
            return Ok(key);
        }

        // Slow path: serialize per-key creation. The gate is held across the
        // whole `LspSession::new` below (this runs on a spawn_blocking
        // thread, so blocking is by design): a second concurrent caller for
        // the same key blocks here, then hits the recheck and returns without
        // spawning a duplicate server.
        let gate = self.creation_gate(&key);
        let _creation_guard = gate.lock();

        // Recheck under the gate (double-checked locking): the winner's
        // session is now visible.
        if self.session_store.is_alive(&key) {
            return Ok(key);
        }

        // Slow path: create the session holding only the per-key gate (never
        // the sessions lock, which `is_alive`/`insert` take briefly).
        let plugin = self
            .plugin_manager
            .resolve_by_language(language_id)
            .ok_or_else(|| {
                AppError::Lsp(format!(
                    "No LSP plugin registered for language: {}",
                    language_id
                ))
            })?;

        // AppHandle 不再由 manager 强制：装配端口自行决定是否需要它
        //（生产实现缺失时报 "AppHandle not set"，行为与既有错误契约一致）。
        let app_handle = self
            .app_handle
            .lock()
            .map_err(|e| AppError::Lsp(e.to_string()))?
            .clone();

        let diag_bus = Arc::new(self.diag_bus.clone());
        // 先取 transport：装配失败时还要靠它把 error 事件送到前端。
        let transport = self.session_factory.transport(app_handle.as_ref())?;
        let exec_target = self.require_project_exec_target(project_path)?;
        // 会话根由插件数据决定（`RootScope`）：文档定根的插件（如 TS 家族）会取
        // 文档所在的最近工程目录，让 typescript-language-server 能解析到
        // `node_modules/typescript`；其余插件保持项目根。
        let workspace_root =
            crate::lsp::session::root::resolve_session_root(project_path, document_uri, &plugin);

        let session = match self.session_factory.build(SessionBuildRequest {
            app_handle,
            plugin: &plugin,
            project_path,
            workspace_root: &workspace_root,
            diag_bus,
            transport: Arc::clone(&transport),
            exec_target,
        }) {
            Ok(s) => s,
            // 创建失败（spawn / install / initialize）：`starting` 可能已发（init 失败
            // 时）也可能未发（spawn 失败时）——统一补发 `error`，前端据此展示
            // message + 重试入口（design.md M2 错误矩阵：启动异常 → failed + 重试）。
            Err(e) => {
                emit_session_error(
                    transport.as_ref(),
                    project_path,
                    language_id,
                    &e.to_string(),
                );
                return Err(e);
            }
        };

        // Defensive: unreachable while the gate is held (no other thread can
        // be creating this key), but if a session appeared anyway, drop the
        // just-built one — its Drop→kill reaps the child — and use the key.
        if self.session_store.is_alive(&key) {
            return Ok(key);
        }
        let open_count = self
            .session_store
            .reopen_documents(&key, |uri, lang, ver, text| {
                let params = serde_json::json!({
                    "textDocument": {
                        "uri": uri,
                        "languageId": lang,
                        "version": ver,
                        "text": text,
                    }
                });
                session
                    .send_notification_raw("textDocument/didOpen", params)
                    .is_ok()
            });
        log::info!(
            "[LSP] Session {} created for {} (re-opened {} doc(s))",
            key,
            plugin.server_binary,
            open_count
        );
        self.session_store.insert(key.clone(), session);
        Ok(key)
    }

    /// 该项目+语言是否仍有在途 progress（导入 / 索引进行中）。
    ///
    /// Java debug 能力探测的 `Warming` 判据（design §2.4）：`classpath` 空 **且**
    /// 此值为 `true` 才是"稍后可成"；无在途进度却返回空 classpath 属真损坏工程，
    /// 调用方必须直接报错而不是等待。缺会话视为无在途。
    #[must_use]
    pub fn has_inflight_progress(&self, project_path: &str, language_id: &str) -> bool {
        let key = session_key(project_path, language_id);
        self.session_store
            .with_session(&key, |s| {
                s.in_flight_progress
                    .lock()
                    .map(|set| !set.is_empty())
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    }

    /// Send an LSP request asynchronously, restarting the session if needed.
    ///
    /// `is_probe` marks best-effort decoration lookups (e.g. the link-highlight
    /// probe that reuses `textDocument/definition`): probes are single-flight
    /// under a dedicated bucket, while explicit navigation is never cancelled.
    pub async fn send_request_async(
        self: &Arc<Self>,
        project_path: &str,
        language_id: &str,
        method: &str,
        params: Value,
        is_probe: bool,
    ) -> Result<Value, AppError> {
        self.send_request_with_policy(
            project_path,
            language_id,
            method,
            params,
            is_probe,
            RequestPolicy::RestartOnFailure,
        )
        .await
    }

    /// Send an **observation** request: failures never restart (nor create) the session.
    ///
    /// 第一性原理：观测不得改变被观测系统的状态。能力探测（"这个项目现在能不能用某个
    /// 后端"）是观察，不是用户意图 —— 失败时重启语言服务器会产生三个实际损害：
    /// ① 重启是重量级、用户可见的状态变更（重新导入项目，数十秒）；
    /// ② 它消耗 `restart_count` —— 那是**真故障**的预算（`MAX_RESTART_COUNT` 用尽后该
    ///    项目语言服务永久不可用），把预期内的失败（如命令未注册）记进去等于让探测
    ///    把 LSP 用坏；
    /// ③ 它违反能力端口的契约（见 `dap::java_capability`：探测不得在内部启动服务器）。
    ///
    /// 会话缺失 / 请求失败都以 `Err` 原样返回，由调用方分类（如 `BundleMissing`）。
    pub async fn send_request_observed(
        self: &Arc<Self>,
        project_path: &str,
        language_id: &str,
        method: &str,
        params: Value,
    ) -> Result<Value, AppError> {
        self.send_request_with_policy(
            project_path,
            language_id,
            method,
            params,
            false,
            RequestPolicy::Never,
        )
        .await
    }

    /// Shared request body; `policy` decides what a failure may do to the session.
    async fn send_request_with_policy(
        self: &Arc<Self>,
        project_path: &str,
        language_id: &str,
        method: &str,
        params: Value,
        is_probe: bool,
        policy: RequestPolicy,
    ) -> Result<Value, AppError> {
        let key = session_key(project_path, language_id);

        // Fast path: extract session ingredients, drop lock before awaiting
        if self.session_store.is_alive(&key) {
            if let Some((pending, writer, inflight)) = self.session_store.with_session(&key, |s| {
                (
                    Arc::clone(&s.pending),
                    s.writer.clone(),
                    Arc::clone(&s.inflight),
                )
            }) {
                match do_send_request(pending, writer, inflight, method, params.clone(), is_probe)
                    .await
                {
                    Ok(val) => return Ok(val),
                    // 观察类请求到此为止（见 `send_request_observed`）：失败不重启会话，
                    // 原样上抛错误供调用方分类（错误文本是探测分类的输入）。
                    Err(e) if policy == RequestPolicy::Never => {
                        return Err(AppError::Lsp(e.to_string()));
                    }
                    Err(e) => {
                        log::warn!(
                            "[LSP] send_request_async failed for {}, reason: {}. Will restart.",
                            key,
                            e
                        );
                    }
                }
            }
        }

        // 观察类请求也不得"把服务器弄起来"：探测的语义是"现在能不能用"，
        // 而不是"把它弄成能用"。会话不在时直接报错，由调用方判为不可用。
        if policy == RequestPolicy::Never {
            return Err(AppError::Lsp(format!(
                "No live LSP session for {key}; the observation request was not retried"
            )));
        }

        // Restart path
        let prev_count = self.session_store.restart_count(&key);

        if prev_count >= MAX_RESTART_COUNT {
            return Err(AppError::Lsp(format!(
                "Max restart count ({}) exceeded for {}",
                MAX_RESTART_COUNT, key
            )));
        }

        if prev_count > 0 {
            let delay = compute_restart_delay(prev_count, RESTART_BASE_DELAY_MS);
            log::warn!(
                "[LSP] Backoff: waiting {:?} before restart attempt {} for {}",
                delay,
                prev_count + 1,
                key
            );
            tokio::time::sleep(delay).await;
        }

        // Spawn session creation on the business AppRuntime blocking pool
        let this = Arc::clone(self);
        let pp = project_path.to_string();
        let lid = language_id.to_string();
        self.runtime
            .spawn_blocking(move || this.get_or_create_session(&pp, &lid, None))
            .await
            .map_err(|e| AppError::Lsp(format!("spawn_blocking join error: {}", e)))??;

        // Increment restart_count
        self.session_store.increment_restart(&key);

        // Get session ingredients for the request
        if let Some((pending, writer, inflight)) = self.session_store.with_session(&key, |s| {
            (
                Arc::clone(&s.pending),
                s.writer.clone(),
                Arc::clone(&s.inflight),
            )
        }) {
            do_send_request(pending, writer, inflight, method, params, is_probe)
                .await
                .map_err(|e| AppError::Lsp(e.to_string()))
        } else {
            Err(AppError::Lsp(format!(
                "Failed to create LSP session: {}",
                key
            )))
        }
    }

    /// Send an LSP notification to a session.
    pub fn send_notification(
        &self,
        project_path: &str,
        language_id: &str,
        method: &str,
        params: Value,
    ) -> Result<(), AppError> {
        let key = session_key(project_path, language_id);
        self.session_store
            .with_session(&key, |session| {
                session
                    .send_notification_raw(method, params)
                    .map_err(|e| AppError::Lsp(e.to_string()))
            })
            .unwrap_or_else(|| Err(AppError::Lsp(format!("No LSP session for: {}", key))))
    }

    /// Close an LSP session for a project and language.
    ///
    /// 宣告结束：前端收到 `stopped` 即清该项目的诊断副本（design.md M1 矩阵）。
    pub fn close_session(&self, project_path: &str, language_id: &str) -> Result<(), AppError> {
        self.close_session_impl(project_path, language_id, SessionCloseNotice::Announce);
        Ok(())
    }

    /// 重启专用关闭：落终态但**不宣告** `stopped`。
    ///
    /// 第一性原理：`stopped` 是"该语言的会话就此结束"的宣告；而重启是**替换**——
    /// 该语言的服务从未真正缺席。若中途宣告结束：① 状态栏 chip 被过滤掉（stopped
    /// 不展示）再被 starting 拉起，用户看到闪断（jdtls 重启可达数十秒）；② 前端
    /// 把诊断整块清空，出现"旧会话已清、新会话未报"的空窗。终态仍必须落：reader
    /// 线程随后退出不得被误判为崩溃（否则闪 error）。
    pub fn close_session_for_restart(
        &self,
        project_path: &str,
        language_id: &str,
    ) -> Result<(), AppError> {
        self.close_session_impl(project_path, language_id, SessionCloseNotice::Silent);
        Ok(())
    }

    fn close_session_impl(
        &self,
        project_path: &str,
        language_id: &str,
        notice: SessionCloseNotice,
    ) {
        let key = session_key(project_path, language_id);
        let session = self.session_store.close_session(&key);
        if let Some(mut s) = session {
            match notice {
                SessionCloseNotice::Announce => {
                    s.close();
                }
                // 静默替换：相位落终态（reader 退出据此静默），事件刻意不发。
                SessionCloseNotice::Silent => {
                    s.close_silently();
                }
            }
            let pp = project_path.to_string();
            let lid = language_id.to_string();
            self.runtime.spawn_blocking(move || {
                // LSP protocol: send shutdown request, wait for response, then exit notification
                match s.send_shutdown_request() {
                    Ok(_) => {
                        log::info!("[LSP] Shutdown request acknowledged for {pp}:{lid}");
                    }
                    Err(e) => {
                        log::warn!("[LSP] Shutdown request failed for {pp}:{lid}: {e}");
                    }
                }
                let _ = s.send_notification_raw("exit", serde_json::json!({}));
                s.kill_child();
                log::info!("[LSP] Closed session: {pp}:{lid}");
            });
        }
    }

    /// Close every LSP session belonging to `project_path`.
    pub fn close_sessions_for_project(&self, project_path: &str) {
        let languages = self
            .session_store
            .session_language_ids_for_project(project_path);
        let mut sessions: Vec<LspSession> = Vec::new();
        for lid in &languages {
            let key = session_key(project_path, lid);
            if let Some(session) = self.session_store.close_session(&key) {
                // 优雅关闭（项目停用）：落终态 + 发 `stopped`（同 close_session）。
                session.close();
                let _ = session.send_notification_raw("shutdown", serde_json::json!({}));
                sessions.push(session);
            }
        }

        if !sessions.is_empty() {
            self.runtime.spawn_blocking(move || {
                for mut s in sessions {
                    std::thread::sleep(Duration::from_millis(10));
                    s.kill_child();
                }
            });
        }

        if let Ok(mut profiles) = self.profiles.lock() {
            profiles.remove(project_path);
        }
        log::info!(
            "[LSP] Closed all sessions for deactivated project: {}",
            project_path
        );
    }

    /// Invalidate any pending deactivate timer for this project.
    pub fn cancel_deactivate(&self, project_path: &str) {
        if let Ok(mut gens) = self.deactivate_gens.lock() {
            let entry = gens.entry(project_path.to_string()).or_insert(0);
            *entry = entry.saturating_add(1);
        }
        log::debug!("[LSP] Cancelled deactivate timer for {}", project_path);
    }

    /// After leaving a project, schedule session teardown in DEACTIVATE_STOP_SECS.
    pub fn schedule_deactivate(self: &Arc<Self>, project_path: String) {
        let my_gen = {
            if let Ok(mut gens) = self.deactivate_gens.lock() {
                let entry = gens.entry(project_path.clone()).or_insert(0);
                *entry = entry.saturating_add(1);
                *entry
            } else {
                0
            }
        };

        let stop_secs = self
            .deactivate_stop_secs
            .lock()
            .map(|x| *x)
            .unwrap_or(DEFAULT_DEACTIVATE_STOP_SECS);
        let this = Arc::clone(self);
        let pp = project_path.clone();
        self.runtime.spawn(async move {
            tokio::time::sleep(Duration::from_secs(stop_secs)).await;
            let current = this
                .deactivate_gens
                .lock()
                .map(|g| g.get(&pp).copied().unwrap_or(0))
                .unwrap_or(0);
            if current == my_gen {
                this.close_sessions_for_project(&pp);
            }
        });
        log::info!(
            "[LSP] Scheduled deactivate in {}s for project {}",
            stop_secs,
            project_path
        );
    }

    /// Broadcast the detected language profile to the frontend.
    ///
    /// 无 `AppHandle`（测试 / 早期启动）、锁中毒或 emit 失败都只记日志 —— 广播是尽力
    /// 而为，不得中断项目激活流程。
    fn emit_profile(&self, profile: &ProjectLanguageProfile) {
        let Ok(handle) = self.app_handle.lock() else {
            log::warn!("[LSP] app_handle lock poisoned; profile event skipped");
            return;
        };
        let Some(app) = handle.as_ref() else {
            return;
        };
        if let Err(e) = app.emit(LSP_PROFILE_EVENT, profile) {
            log::warn!("[LSP] Failed to emit global profile event: {e}");
        }
    }

    /// Detect profile, cancel stop timer, emit profile event. Call when project becomes active.
    pub fn activate_project(
        self: &Arc<Self>,
        project_path: &str,
        primary_override: Option<&str>,
    ) -> ProjectLanguageProfile {
        self.cancel_deactivate(project_path);
        let markers = self.plugin_manager.detection_markers();
        let profile = detect_project_profile_with_markers(project_path, &markers, primary_override);
        if let Ok(mut map) = self.profiles.lock() {
            map.insert(project_path.to_string(), profile.clone());
        }

        self.emit_profile(&profile);

        if let Some(ref primary) = profile.primary {
            let policy = self.plugin_manager.resolve_auto_start(&primary.language_id);
            // 文档定根的插件必须等文档打开（会话根按文档所在工程解析），故此处不启动。
            // 判据取自插件数据，manager 不按语言名分支。
            let needs_document = self
                .plugin_manager
                .resolve_by_language(&primary.language_id)
                .is_some_and(|p| p.root_scope.walk_markers().is_some());
            if policy == LspAutoStart::OnProjectSelect && !needs_document {
                let this = Arc::clone(self);
                let pp = project_path.to_string();
                let lid = primary.language_id.clone();
                self.runtime.spawn_blocking(move || {
                    if let Err(e) = this.get_or_create_session(&pp, &lid, None) {
                        log::warn!(
                            "[LSP] onProjectSelect failed to start {} for {}: {}",
                            lid,
                            pp,
                            e
                        );
                    }
                });
            }
        }

        log::info!(
            "[LSP] Project profile for {}: primary={:?} candidates={}",
            project_path,
            profile.primary.as_ref().map(|p| &p.language_id),
            profile.candidates.len()
        );
        profile
    }

    /// Cached profile if available.
    pub fn get_profile(&self, project_path: &str) -> Option<ProjectLanguageProfile> {
        self.profiles
            .lock()
            .ok()
            .and_then(|m| m.get(project_path).cloned())
    }

    /// Close all active LSP sessions.
    pub fn close_all_sessions(&self) {
        let sessions = self.session_store.close_all();
        if !sessions.is_empty() {
            self.runtime.spawn_blocking(move || {
                for mut s in sessions {
                    s.kill_child();
                }
            });
        }
    }

    /// List all active LSP sessions.
    pub fn list_sessions(&self) -> Vec<LspSessionInfo> {
        self.session_store.list()
    }

    /// Runtime metadata for a session.
    pub fn get_server_info(
        &self,
        project_path: &str,
        language_id: &str,
    ) -> Result<LspServerInfo, AppError> {
        let key = session_key(project_path, language_id);
        self.session_store
            .with_session(&key, |s| s.snapshot_server_info())
            .ok_or_else(|| AppError::Lsp(format!("No LSP session for: {}", key)))
    }

    /// Recent stderr log lines for a session (newest last).
    pub fn get_server_logs(
        &self,
        project_path: &str,
        language_id: &str,
        limit: Option<usize>,
    ) -> Result<Vec<LspServerLogEntry>, AppError> {
        let key = session_key(project_path, language_id);
        self.session_store
            .with_session(&key, |s| {
                s.log_buffer
                    .lock()
                    .map(|r| r.snapshot(limit.unwrap_or(500)))
                    .unwrap_or_default()
            })
            .ok_or_else(|| AppError::Lsp(format!("No LSP session for: {}", key)))
    }

    /// Language ids of all active sessions for a project path.
    pub fn session_language_ids_for_project(&self, project_path: &str) -> Vec<String> {
        self.session_store
            .session_language_ids_for_project(project_path)
    }

    /// Stop every active session for a project (keeps profile cache).
    pub fn stop_all_sessions_for_project(&self, project_path: &str) {
        let languages = self
            .session_store
            .session_language_ids_for_project(project_path);
        for lid in languages {
            let _ = self.close_session(project_path, &lid);
        }
    }

    /// Get cached server capabilities for a session.
    pub fn get_capabilities(&self, project_path: &str, language_id: &str) -> Option<Value> {
        let key = session_key(project_path, language_id);
        self.session_store
            .with_session(&key, |s| s.server_capabilities.clone())
    }

    /// Resolve a file path to an LSP language id via extension lookup.
    #[must_use]
    pub fn language_for_path(path: &str) -> Option<String> {
        let ext = std::path::Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        let registry = LspPluginRegistry::with_defaults();
        registry
            .resolve_by_extension(ext)
            .map(|p| p.language_id.to_string())
    }
}

impl Default for LspManager {
    fn default() -> Self {
        Self::new_default()
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lsp::plugin::CustomLspServerConfig;
    use crate::lsp::session::lifecycle::Lifecycle;
    use crate::lsp::session::status::LspSessionStatus;
    use crate::lsp::session::testing::RecordingTransport;

    #[test]
    fn test_session_key() {
        let key = session_key("/home/user/project", "rust");
        assert_eq!(key, "/home/user/project:rust");
    }

    #[test]
    fn test_restart_delay() {
        let d0 = compute_restart_delay(0, 500);
        assert_eq!(d0, Duration::from_millis(500));
        let d2 = compute_restart_delay(2, 500);
        assert_eq!(d2, Duration::from_millis(2000));
        let d4 = compute_restart_delay(4, 500);
        assert_eq!(d4, Duration::from_millis(8000));
    }

    /// 缺会话 / 未启动 → 无在途进度（能力探测据此把空 classpath 判为硬错误
    /// 而不是 `Warming`，避免把损坏工程拖成超时错误）。
    #[test]
    fn has_inflight_progress_is_false_without_session() {
        let manager = LspManager::new_default();
        assert!(!manager.has_inflight_progress("/no/such/project", "java"));
    }

    /// **观察请求的护栏**：不得重启、不得新建会话、不得消耗重启预算。
    ///
    /// 反例后果（修复前的行为）：能力探测失败走重启通道 → 每点一次 Debug 就重启 jdtls
    /// 并累加 `restart_count`，5 次后该项目 Java LSP 永久不可用（`MAX_RESTART_COUNT`）。
    #[tokio::test]
    async fn observation_request_never_restarts_or_spends_the_budget() {
        let manager = Arc::new(LspManager::new_default());
        let key = session_key("/no/such/project", "java");
        let before = manager.session_store.restart_count(&key);

        let err = manager
            .send_request_observed(
                "/no/such/project",
                "java",
                "workspace/executeCommand",
                serde_json::json!({ "command": "vscode.java.startDebugSession" }),
            )
            .await
            .expect_err("no live session must fail");
        assert!(err.to_string().contains("was not retried"), "{err}");
        assert_eq!(
            manager.session_store.restart_count(&key),
            before,
            "观察请求不得消耗重启预算"
        );
        assert!(
            manager.session_store.with_session(&key, |_| ()).is_none(),
            "观察请求不得新建会话"
        );
    }

    #[test]
    fn test_should_restart_within_limit() {
        assert!(should_restart(0, 5));
        assert!(should_restart(4, 5));
        assert!(!should_restart(5, 5));
        assert!(!should_restart(10, 5));
    }

    #[test]
    fn test_language_for_path_via_registry() {
        assert_eq!(
            LspManager::language_for_path("/some/path/main.rs"),
            Some("rust".to_string())
        );
        assert_eq!(
            LspManager::language_for_path("/some/path/app.py"),
            Some("python".to_string())
        );
        assert_eq!(LspManager::language_for_path("/some/path/no_ext"), None);
    }

    #[test]
    fn test_plugin_registry_integration() {
        let manager = LspManager::new_default();
        assert!(manager.plugin_manager.resolve_by_language("rust").is_some());
        assert!(manager
            .plugin_manager
            .resolve_by_language("python")
            .is_some());
        assert!(manager.plugin_manager.resolve_by_language("go").is_some());
    }

    #[test]
    fn test_diag_bus_creation() {
        let manager = LspManager::new_default();
        assert_eq!(manager.diag_bus().subscriber_count(), 0);
    }

    #[test]
    fn should_resolve_language_from_live_registry_including_custom() {
        let manager = LspManager::new_default();
        assert_eq!(
            manager.resolve_language_for_path("/repo/main.go"),
            Some("go".into())
        );
        manager.register_plugin(LspPlugin::from_custom(&CustomLspServerConfig {
            id: "proto".into(),
            language_id: "protobuf".into(),
            display_name: None,
            command: vec!["buf".into(), "lsp".into()],
            file_extensions: vec!["proto".into()],
            root_markers: vec![],
            auto_start: None,
            initialization_options: None,
        }));
        assert_eq!(
            manager.resolve_language_for_path("api/v1.proto"),
            Some("protobuf".into())
        );
    }

    #[test]
    fn test_custom_plugin_registration() {
        let manager = LspManager::new_default();
        manager.register_plugin(LspPlugin::from_custom(&CustomLspServerConfig {
            id: "testlang".into(),
            language_id: "testlang".into(),
            display_name: None,
            command: vec!["test-lsp".into()],
            file_extensions: vec!["tl".into()],
            root_markers: vec![],
            auto_start: None,
            initialization_options: None,
        }));
        assert!(manager
            .plugin_manager
            .resolve_by_language("testlang")
            .is_some());
    }

    #[test]
    fn test_session_info_has_status_field() {
        let info = LspSessionInfo {
            language_id: "rust".into(),
            project_path: "/test".into(),
            server_name: "rust-analyzer".into(),
            status: "ready".into(),
            status_message: None,
            progress_pct: None,
        };
        assert_eq!(info.status, "ready");
        assert_eq!(info.language_id, "rust");
    }

    #[test]
    fn test_session_info_serialization_includes_status() {
        let info = LspSessionInfo {
            language_id: "go".into(),
            project_path: "/workspace".into(),
            server_name: "gopls".into(),
            status: "starting".into(),
            status_message: None,
            progress_pct: None,
        };
        let json = serde_json::to_string(&info).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["status"].as_str(), Some("starting"));
        assert_eq!(parsed["connected"].as_bool(), None);
        assert!(parsed.get("connected").is_none());
    }
    #[test]
    fn creation_gate_same_key_returns_shared_arc() {
        let manager = LspManager::new_default();
        let a = manager.creation_gate("proj:rust");
        let b = manager.creation_gate("proj:rust");
        assert!(Arc::ptr_eq(&a, &b), "same key must share one gate");
    }

    #[test]
    fn creation_gates_are_isolated_per_key() {
        let manager = LspManager::new_default();
        let a = manager.creation_gate("proj:rust");
        let b = manager.creation_gate("proj:java");
        assert!(!Arc::ptr_eq(&a, &b), "different keys must not share a gate");
    }

    /// Models `get_or_create_session`'s double-checked shape against the gate:
    /// fast miss → hold per-key gate → recheck → create once. Without the
    /// gate the critical sections overlap (`max_active > 1`) and the counter
    /// exceeds 1 — the duplicate-jdtls-spawn race.
    #[test]
    fn creation_gate_serializes_concurrent_creation() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let manager = Arc::new(LspManager::new_default());
        let slot = Arc::new(parking_lot::Mutex::new(None::<String>));
        let active = Arc::new(AtomicUsize::new(0));
        let max_active = Arc::new(AtomicUsize::new(0));
        let creations = Arc::new(AtomicUsize::new(0));

        let handles: Vec<_> = (0..8)
            .map(|_| {
                let manager = Arc::clone(&manager);
                let slot = Arc::clone(&slot);
                let active = Arc::clone(&active);
                let max_active = Arc::clone(&max_active);
                let creations = Arc::clone(&creations);
                std::thread::spawn(move || {
                    if slot.lock().is_some() {
                        return; // fast path: already created
                    }
                    let gate = manager.creation_gate("proj:rust");
                    let _guard = gate.lock();
                    if slot.lock().is_some() {
                        return; // recheck under gate: loser returns
                    }
                    let cur = active.fetch_add(1, Ordering::SeqCst) + 1;
                    max_active.fetch_max(cur, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(5));
                    *slot.lock() = Some("proj:rust".to_string());
                    creations.fetch_add(1, Ordering::SeqCst);
                    active.fetch_sub(1, Ordering::SeqCst);
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(
            max_active.load(Ordering::SeqCst),
            1,
            "creation critical sections must not overlap"
        );
        assert_eq!(
            creations.load(Ordering::SeqCst),
            1,
            "concurrent same-key creation must happen exactly once"
        );
    }

    /// Slow-path errors must release the gate: concurrent same-key failures
    /// (unknown language → no spawn attempted) all return, and a follow-up
    /// call still proceeds instead of deadlocking on a wedged gate.
    #[test]
    fn concurrent_failed_creation_never_wedges_gate() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let manager = Arc::new(LspManager::new_default());
        let errors = Arc::new(AtomicUsize::new(0));
        let handles: Vec<_> = (0..4)
            .map(|_| {
                let manager = Arc::clone(&manager);
                let errors = Arc::clone(&errors);
                std::thread::spawn(move || {
                    match manager.get_or_create_session("/test/project", "no-such-lang-xyz", None) {
                        Ok(_) => panic!("unknown language must not create a session"),
                        Err(_) => {
                            errors.fetch_add(1, Ordering::SeqCst);
                        }
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(errors.load(Ordering::SeqCst), 4);
        assert!(manager
            .get_or_create_session("/test/project", "no-such-lang-xyz", None)
            .is_err());
    }

    /// Known language without AppHandle fails after the gate (no spawn), and
    /// the gate is released so the next call proceeds identically.
    #[test]
    fn get_or_create_without_app_handle_errors_and_releases_gate() {
        let manager = LspManager::new_default();
        assert!(manager
            .get_or_create_session("/test/project", "rust", None)
            .is_err());
        assert!(manager
            .get_or_create_session("/test/project", "rust", None)
            .is_err());
    }

    // ── M2 会话健康度：停止路径（design.md M2：进程退出 → stopped）──

    /// 测试用会话身份（store 键 + 事件断言共用，避免散落字面量漂移）。
    const TEST_PROJECT: &str = "/tmp/proj";
    const TEST_LANG: &str = "go";
    const TEST_SERVER: &str = "gopls";

    /// 本项目桩会话（复用 session 域共享夹具，字段变更只改夹具一处）。
    fn stub_session(transport: Arc<dyn LspTransport>) -> LspSession {
        crate::lsp::session::testing::stub_session(transport, TEST_PROJECT, TEST_LANG, TEST_SERVER)
    }

    /// 构造一个无真实进程的 go 会话并插入 store（生命周期初始 Ready）。
    ///
    /// 返回生命周期句柄：会话被 close 路径接管（move 进 spawn_blocking）后，外部
    /// 只能靠共享 Arc 观察「是否已落终态」，这是关闭路径的关键不变量。
    fn insert_test_session(
        manager: &LspManager,
        transport: Arc<dyn LspTransport>,
    ) -> Arc<Lifecycle> {
        let session = stub_session(transport);
        let lifecycle = Arc::clone(&session.lifecycle);
        manager
            .session_store
            .insert(session_key(TEST_PROJECT, TEST_LANG), session);
        lifecycle
    }

    /// 项目停用（优雅关闭）必须落终态并推 `stopped` 事件（前端据此清诊断）。
    #[test]
    fn close_sessions_for_project_emits_stopped() {
        let manager = LspManager::new_default();
        let transport = Arc::new(RecordingTransport::default());
        let lifecycle =
            insert_test_session(&manager, Arc::clone(&transport) as Arc<dyn LspTransport>);

        manager.close_sessions_for_project(TEST_PROJECT);

        assert!(
            transport.has(TEST_PROJECT, TEST_LANG, "stopped"),
            "close_sessions_for_project 必须推 stopped 事件: {:?}",
            transport.take()
        );
        assert!(
            lifecycle.status(TEST_SERVER) == LspSessionStatus::Stopped,
            "close_sessions_for_project 必须先落终态：reader 退出据此静默，否则优雅关闭会闪错误"
        );
    }

    /// 单语言关闭（`lsp_restart_session` / `lsp_stop_session` / 状态栏崩溃重试按钮
    /// 都走这条）：与项目停用同构 —— 落终态 + 推 `stopped`。
    #[test]
    fn close_session_emits_stopped_and_marks_closed_terminal() {
        let manager = LspManager::new_default();
        let transport = Arc::new(RecordingTransport::default());
        let lifecycle =
            insert_test_session(&manager, Arc::clone(&transport) as Arc<dyn LspTransport>);

        manager.close_session(TEST_PROJECT, TEST_LANG).unwrap();

        assert!(
            transport.has(TEST_PROJECT, TEST_LANG, "stopped"),
            "close_session 必须推 stopped 事件: {:?}",
            transport.take()
        );
        assert!(
            lifecycle.status(TEST_SERVER) == LspSessionStatus::Stopped,
            "close_session 必须先落终态，否则 reader 线程随后退出会被误判为崩溃（error）"
        );
        assert!(
            !manager
                .session_store
                .is_alive(&session_key(TEST_PROJECT, TEST_LANG)),
            "close_session 必须把会话从 store 摘除（否则 snapshot 会把已关闭会话报成 error）"
        );
    }

    /// 重启路径（`lsp_restart_session` / Restart All / 状态栏崩溃重试）走静默关闭：
    /// **不得**推 `stopped`。
    ///
    /// 第一性原理：`stopped` 是"该语言的会话就此结束"的宣告，前端据此清诊断；
    /// 而重启是**替换**——该语言的服务从未真正缺席。若中途宣告结束，状态栏 chip
    /// 会先被过滤掉（stopped 不展示）再被 starting 拉起，用户看到闪断（jdtls 重启
    /// 可达数十秒）。静默关闭仍必须落终态：reader 线程随后退出不得被误判为崩溃。
    #[test]
    fn restart_close_is_silent_but_still_terminal() {
        let manager = LspManager::new_default();
        let transport = Arc::new(RecordingTransport::default());
        let lifecycle =
            insert_test_session(&manager, Arc::clone(&transport) as Arc<dyn LspTransport>);

        manager
            .close_session_for_restart(TEST_PROJECT, TEST_LANG)
            .unwrap();

        assert!(
            transport.take().is_empty(),
            "重启关闭不得产生任何生命周期事件: {:?}",
            transport.take()
        );
        assert_eq!(
            lifecycle.status(TEST_SERVER),
            LspSessionStatus::Stopped,
            "静默关闭仍必须落终态（否则 reader 退出会被误判为崩溃 → 闪错误）"
        );
        assert!(
            !manager
                .session_store
                .is_alive(&session_key(TEST_PROJECT, TEST_LANG)),
            "静默关闭仍必须把会话从 store 摘除"
        );
    }

    // ── 装配端口（DIP）：manager 只编排，装配细节可注入 ──

    /// 用桩装配端口建一个不依赖 Tauri 运行时的 manager（已绑定项目 exec target）。
    fn manager_with_factory(factory: Arc<dyn SessionFactory>) -> LspManager {
        let manager = LspManager::with_session_factory(AppRuntime::shared_default(), factory);
        manager.set_project_exec_target(
            TEST_PROJECT,
            crate::common::executor::factory::ExecTarget::Local,
        );
        manager
    }

    /// 装配端口桩：transport 用 recording，`build` 固定失败
    /// （等价于 spawn / auto-install / initialize 失败）。
    struct FailingSessionFactory {
        transport: Arc<RecordingTransport>,
    }

    impl SessionFactory for FailingSessionFactory {
        fn transport(
            &self,
            _: Option<&tauri::AppHandle>,
        ) -> Result<Arc<dyn LspTransport>, AppError> {
            Ok(Arc::clone(&self.transport) as Arc<dyn LspTransport>)
        }

        fn build(&self, _: SessionBuildRequest<'_>) -> Result<LspSession, AppError> {
            Err(AppError::Lsp("Failed to spawn gopls".to_string()))
        }
    }

    /// AC2「启动异常 → failed + 重试」：装配失败必须补发 error 事件并把错误上抛。
    ///
    /// 该路径原先零覆盖 —— `LspSession::new` 需要真实 `tauri::AppHandle`，
    /// 单测无法触达；装配端口让这段编排逻辑脱离 Tauri 运行时受测。
    #[test]
    fn session_creation_failure_emits_error_event() {
        let transport = Arc::new(RecordingTransport::default());
        let manager = manager_with_factory(Arc::new(FailingSessionFactory {
            transport: Arc::clone(&transport),
        }));

        let result = manager.get_or_create_session(TEST_PROJECT, TEST_LANG, None);

        assert!(
            matches!(result, Err(AppError::Lsp(_))),
            "装配失败必须把错误原样上抛: {result:?}"
        );
        let events = transport.take();
        assert!(
            events
                .iter()
                .any(|(pp, lid, status, msg, _)| pp == TEST_PROJECT
                && lid == TEST_LANG
                && status == "error"
                // message 即前端 chip 上展示的文案：必须携带失败原因（非空泛错误）。
                && msg.as_deref().is_some_and(|m| m.contains("Failed to spawn gopls"))),
            "装配失败必须经注入的 transport 发 error（状态栏重试入口的数据源）: {events:?}"
        );
    }

    /// 装配端口桩：`build` 成功返回桩会话（验证注入端口下编排语义不变）。
    struct StubSessionFactory {
        transport: Arc<RecordingTransport>,
    }

    impl SessionFactory for StubSessionFactory {
        fn transport(
            &self,
            _: Option<&tauri::AppHandle>,
        ) -> Result<Arc<dyn LspTransport>, AppError> {
            Ok(Arc::clone(&self.transport) as Arc<dyn LspTransport>)
        }

        fn build(&self, request: SessionBuildRequest<'_>) -> Result<LspSession, AppError> {
            Ok(stub_session(request.transport))
        }
    }

    /// 装配成功：会话登记进 store，且不发 error（编排路径与具体装配实现解耦）。
    #[test]
    fn session_creation_success_registers_session_from_injected_factory() {
        let transport = Arc::new(RecordingTransport::default());
        let manager = manager_with_factory(Arc::new(StubSessionFactory {
            transport: Arc::clone(&transport),
        }));

        let key = manager
            .get_or_create_session(TEST_PROJECT, TEST_LANG, None)
            .expect("桩装配应当成功");

        assert_eq!(key, session_key(TEST_PROJECT, TEST_LANG));
        assert!(
            // 桩会话无 reader，故用「已登记」而非 `is_alive`（后者语义是 reader 存活）。
            manager.session_store.with_session(&key, |_| ()).is_some(),
            "装配成功的会话必须登记进 store"
        );
        assert!(
            !transport.has(TEST_PROJECT, TEST_LANG, "error"),
            "成功路径不得发 error 事件: {:?}",
            transport.take()
        );
    }

    // ── W3：send_did_open 归一（唯一出口）的直接单测 ────────────────────────

    /// 构造 writer 接收端存活的桩会话：`send_notification_raw` 会把消息送进通道，
    /// 测试据此断言 didClose / didOpen 的实际发送序列（`stub_session` 丢弃接收端、
    /// 无法观察协议消息，故在此自建）。
    fn session_with_writer(
        transport: Arc<dyn LspTransport>,
    ) -> (LspSession, crossbeam_channel::Receiver<lsp_server::Message>) {
        let (writer, rx) = crossbeam_channel::unbounded();
        (
            LspSession {
                language_id: TEST_LANG.to_string(),
                project_path: TEST_PROJECT.to_string(),
                server_name: TEST_SERVER.to_string(),
                writer,
                pending: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
                inflight: Arc::new(std::sync::Mutex::new(
                    crate::lsp::inflight::InflightRequestTracker::new(),
                )),
                reader: None,
                stderr_logger: None,
                restart_count: 0,
                server_capabilities: serde_json::json!({}),
                child: None,
                process_pid: None,
                server_info: LspServerInfo::unknown(),
                log_buffer: Arc::new(std::sync::Mutex::new(
                    crate::lsp::session::LogRingBuffer::new(),
                )),
                transport,
                in_flight_progress: Arc::new(std::sync::Mutex::new(
                    std::collections::HashSet::new(),
                )),
                lifecycle: Arc::new(Lifecycle::new()),
            },
            rx,
        )
    }

    /// 通道中已发出的 LSP 通知方法名（按顺序）。
    fn notif_methods(rx: &crossbeam_channel::Receiver<lsp_server::Message>) -> Vec<String> {
        rx.try_iter()
            .filter_map(|m| match m {
                lsp_server::Message::Notification(n) => Some(n.method),
                _ => None,
            })
            .collect()
    }

    const TEST_URI: &str = "file:///a.rs";

    /// 重复 didOpen → 先补 didClose 再 didOpen（钉死关键路径 ①）。
    #[test]
    fn send_did_open_duplicate_sends_close_before_reopen() {
        let manager = LspManager::new_default();
        let transport = Arc::new(RecordingTransport::default());
        let (session, rx) = session_with_writer(Arc::clone(&transport) as Arc<dyn LspTransport>);
        manager
            .session_store
            .insert(session_key(TEST_PROJECT, TEST_LANG), session);

        // 首开 v0：仅 didOpen。
        manager
            .send_did_open(TEST_PROJECT, TEST_LANG, TEST_URI, "a", 0)
            .unwrap();
        // 重复 v0（编辑器在后端代开后以同版本接管）：先补 didClose 再 didOpen。
        manager
            .send_did_open(TEST_PROJECT, TEST_LANG, TEST_URI, "b", 0)
            .unwrap();

        assert_eq!(
            notif_methods(&rx),
            vec![
                "textDocument/didOpen".to_string(),
                "textDocument/didClose".to_string(),
                "textDocument/didOpen".to_string(),
            ],
            "重复 didOpen 必须先补 didClose 再 didOpen（否则服务器报 duplicate DidOpenTextDocument）"
        );
        assert_eq!(
            manager.open_document_version(TEST_PROJECT, TEST_LANG, TEST_URI),
            Some(0),
            "登记表以本次版本推进"
        );
    }

    /// 版本回退（v5→v3）：行为照旧（didClose+didOpen），登记表推进到新版本。
    #[test]
    fn send_did_open_version_regression_still_reopens_and_advances() {
        let manager = LspManager::new_default();
        let transport = Arc::new(RecordingTransport::default());
        let (session, rx) = session_with_writer(Arc::clone(&transport) as Arc<dyn LspTransport>);
        manager
            .session_store
            .insert(session_key(TEST_PROJECT, TEST_LANG), session);

        manager
            .send_did_open(TEST_PROJECT, TEST_LANG, TEST_URI, "a", 5)
            .unwrap();
        manager
            .send_did_open(TEST_PROJECT, TEST_LANG, TEST_URI, "b", 3)
            .unwrap();

        assert_eq!(
            notif_methods(&rx),
            vec![
                "textDocument/didOpen".to_string(),
                "textDocument/didClose".to_string(),
                "textDocument/didOpen".to_string(),
            ],
            "版本回退仍必须先补 didClose 再 didOpen"
        );
        assert_eq!(
            manager.open_document_version(TEST_PROJECT, TEST_LANG, TEST_URI),
            Some(3),
            "回退后登记表推进到新版本，文本以本次为准"
        );
    }

    /// 归一决策（纯函数，钉死关键路径 ② 的决策层）：登记表无记录 → 直接打开。
    #[test]
    fn did_open_action_first_open_is_plain() {
        assert_eq!(did_open_action(None, 0), DidOpenAction::PlainOpen);
        assert_eq!(did_open_action(None, 7), DidOpenAction::PlainOpen);
    }

    /// 重复 didOpen（同版本 = 编辑器在后端代开后接管 / 更高版本）→ Reopen 且非回退。
    #[test]
    fn did_open_action_duplicate_is_reopen_without_regression() {
        assert_eq!(
            did_open_action(Some(0), 0),
            DidOpenAction::Reopen {
                version_regressed: false
            }
        );
        assert_eq!(
            did_open_action(Some(2), 3),
            DidOpenAction::Reopen {
                version_regressed: false
            }
        );
    }

    /// 版本回退（version < previous）→ Reopen 且标记回退（告警分支）。
    #[test]
    fn did_open_action_version_regression_is_flagged() {
        assert_eq!(
            did_open_action(Some(5), 3),
            DidOpenAction::Reopen {
                version_regressed: true
            }
        );
    }
}
