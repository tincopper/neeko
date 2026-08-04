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
use super::types::{LspServerInfo, LspServerLogEntry, LspSessionInfo};

// ── Re-exports ─────────────────────────────────────────────────────────

pub use super::profile::ProjectLanguageProfile;

// ── Constants ───────────────────────────────────────────────────────────

/// Maximum restart attempts before giving up on a session.
const MAX_RESTART_COUNT: u32 = 5;
/// Base delay for exponential backoff (ms).
const RESTART_BASE_DELAY_MS: u64 = 500;
/// Default: after a project is deactivated, wait this long before closing sessions.
const DEFAULT_DEACTIVATE_STOP_SECS: u64 = 30 * 60;

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

    /// Get an existing session or create a new one for the given project and language.
    pub fn get_or_create_session(
        &self,
        project_path: &str,
        language_id: &str,
        document_uri: Option<&str>,
    ) -> Result<String, AppError> {
        let key = session_key(project_path, language_id);

        // Fast path: check if session exists and is alive (short lock)
        if self.session_store.is_alive(&key) {
            return Ok(key);
        }

        // Slow path: create session without holding the sessions lock
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

        // Insert session, handling concurrent creation
        if self.session_store.contains(&key) && self.session_store.is_alive(&key) {
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

    /// Send an LSP request asynchronously, restarting the session if needed.
    pub async fn send_request_async(
        self: &Arc<Self>,
        project_path: &str,
        language_id: &str,
        method: &str,
        params: Value,
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
                match do_send_request(pending, writer, inflight, method, params.clone()).await {
                    Ok(val) => return Ok(val),
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
            do_send_request(pending, writer, inflight, method, params)
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

        if let Ok(handle) = self.app_handle.lock() {
            if let Some(app) = handle.as_ref() {
                if let Err(e) = app.emit("lsp-project-profile", &profile) {
                    log::warn!("[LSP] Failed to emit global profile event: {}", e);
                }
            }
        }

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
            .with_session(&key, |s| s.server_info.clone())
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
}
