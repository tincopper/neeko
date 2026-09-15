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
use super::session::{do_send_request, LspSession};
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
        let diag_bus = DiagnosticBus::new();

        Self {
            runtime,
            session_store: LspSessionStore::new(),
            plugin_manager: LspPluginManager::new(),
            diag_bus,
            app_handle: Mutex::new(None),
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

    /// Get a snapshot of current LSP settings.
    pub fn get_settings_snapshot(&self) -> LspSettings {
        let auto_start = self.plugin_manager.default_auto_start();
        LspSettings {
            auto_start: auto_start.as_str().to_string(),
            deactivate_stop_minutes: self
                .deactivate_stop_secs
                .lock()
                .map(|x| x.saturating_div(60))
                .unwrap_or_default(),
            custom_servers: Vec::new(),
        }
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
            transport.push_diagnostics(&event.project_path, &event.uri, event.diagnostics.clone());
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

        let app_handle = self
            .app_handle
            .lock()
            .map_err(|e| AppError::Lsp(e.to_string()))?
            .clone()
            .ok_or_else(|| AppError::Lsp("AppHandle not set".to_string()))?;

        let diag_bus = Arc::new(self.diag_bus.clone());
        let transport: Arc<dyn LspTransport> = Arc::new(IpcTransport::new(app_handle.clone()));
        let exec_target = self.require_project_exec_target(project_path)?;
        // For document-scoped languages (TypeScript family), root the session at
        // the nearest TS project instead of the project root, so servers like
        // typescript-language-server can locate the `typescript` library.
        let workspace_root = crate::lsp::session::root::resolve_session_root(
            project_path,
            document_uri,
            language_id,
        );

        let session = LspSession::new(
            &plugin,
            project_path,
            &workspace_root,
            app_handle,
            diag_bus,
            transport,
            exec_target,
        )
        .map_err(|e| AppError::Lsp(e.to_string()))?;

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
    pub fn close_session(&self, project_path: &str, language_id: &str) -> Result<(), AppError> {
        let key = session_key(project_path, language_id);
        let session = self.session_store.close_session(&key);
        if let Some(mut s) = session {
            s.transport
                .push_session_event(project_path, language_id, "stopped", None, None);
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
        Ok(())
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
                session
                    .transport
                    .push_session_event(project_path, lid, "stopped", None, None);
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
            if policy == LspAutoStart::OnProjectSelect
                && !crate::lsp::session::root::is_document_root_scoped(&primary.language_id)
            {
                // Document-scoped servers (TypeScript family) must wait for a
                // document to be opened so the session root can be resolved
                // from the document's own project directory.
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

    /// Restart every active session for a project (stop then re-create).
    pub fn restart_all_sessions_for_project(&self, project_path: &str) -> Result<(), AppError> {
        let languages = self
            .session_store
            .session_language_ids_for_project(project_path);
        for lid in languages {
            let _ = self.close_session(project_path, &lid);
            self.get_or_create_session(project_path, &lid, None)?;
        }
        Ok(())
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
}
