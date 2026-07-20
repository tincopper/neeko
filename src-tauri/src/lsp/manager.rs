//! LSP session manager: lifecycle, plugin discovery, diagnostics, and auto-start policies.

use std::collections::HashMap;
use std::io::BufRead;

use crate::common::runtime::AppRuntime;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context, Result};
use serde_json::Value;

use crate::AppError;

use super::diag_bus::{DiagnosticBus, DiagnosticEvent};
use super::plugin::{
    CustomLspServerConfig, LspAutoStart, LspPlugin, LspPluginRegistry, LspSettings,
};
use super::profile::{detect_project_profile_with_markers, ProjectLanguageProfile};
use super::transport::{IpcTransport, LspTransport};
use super::types::LspSessionInfo;

// ── Constants ───────────────────────────────────────────────────────────

/// Maximum restart attempts before giving up on a session.
const MAX_RESTART_COUNT: u32 = 5;
/// Base delay for exponential backoff (ms).
const RESTART_BASE_DELAY_MS: u64 = 500;
/// Default: after a project is deactivated, wait this long before closing sessions.
const DEFAULT_DEACTIVATE_STOP_SECS: u64 = 30 * 60;

/// Tracked open document for session restart recovery.
#[derive(Clone)]
struct OpenDocument {
    uri: String,
    language_id: String,
    text: String,
    version: i64,
}

/// Atomic request ID counter for LSP requests.
type SessionKey = String;

fn session_key(project_path: &str, language_id: &str) -> SessionKey {
    format!("{}:{}", project_path, language_id)
}

/// Compute the restart delay with exponential backoff.
fn restart_delay(attempt: u32) -> Duration {
    Duration::from_millis(RESTART_BASE_DELAY_MS * 2_u64.saturating_pow(attempt))
}


use super::session::{do_send_request, LspSession, LspSessionStatus};

// ── LspManager ──────────────────────────────────────────────────────────

/// Manages LSP server sessions with plugin-based language discovery
/// and exponential backoff restart strategy.
pub struct LspManager {
    /// Business async executor (never bare `tokio::spawn`).
    runtime: Arc<AppRuntime>,
    /// Active LSP sessions keyed by project:language.
    sessions: Arc<Mutex<HashMap<SessionKey, LspSession>>>,
    /// Open documents tracked per session for restart recovery.
    open_docs: Arc<Mutex<HashMap<SessionKey, Vec<OpenDocument>>>>,
    /// Registry of available LSP language plugins.
    plugin_registry: Mutex<LspPluginRegistry>,
    /// Diagnostic event bus for pub/sub.
    diag_bus: DiagnosticBus,
    /// Tauri AppHandle for event emission.
    app_handle: Mutex<Option<tauri::AppHandle>>,
    /// Cached language profiles per project path (from root-marker detection).
    profiles: Mutex<HashMap<String, ProjectLanguageProfile>>,
    /// Generation counter per project path to cancel pending deactivate timers.
    deactivate_gens: Arc<Mutex<HashMap<String, u64>>>,
    /// Seconds after deactivation before closing sessions (from settings).
    deactivate_stop_secs: Mutex<u64>,
    /// Default auto-start policy for built-in languages.
    default_auto_start: Mutex<LspAutoStart>,
    /// Project path → execution target (Local/WSL/SSH) for env-aware binary checks.
    project_exec_targets: Mutex<HashMap<String, crate::common::executor::factory::ExecTarget>>,
}

impl LspManager {
    /// Create a manager that schedules work on the given business runtime.
    pub fn new(runtime: Arc<AppRuntime>) -> Self {
        let diag_bus = DiagnosticBus::new();

        Self {
            runtime,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            open_docs: Arc::new(Mutex::new(HashMap::new())),
            plugin_registry: Mutex::new(LspPluginRegistry::with_defaults()),
            diag_bus,
            app_handle: Mutex::new(None),
            profiles: Mutex::new(HashMap::new()),
            deactivate_gens: Arc::new(Mutex::new(HashMap::new())),
            deactivate_stop_secs: Mutex::new(DEFAULT_DEACTIVATE_STOP_SECS),
            default_auto_start: Mutex::new(LspAutoStart::OnFirstFile),
            project_exec_targets: Mutex::new(HashMap::new()),
        }
    }

    /// Record which environment a project path uses (for PATH/binary checks).
    pub fn set_project_exec_target(
        &self,
        project_path: &str,
        target: crate::common::executor::factory::ExecTarget,
    ) {
        if let Ok(mut map) = self.project_exec_targets.lock() {
            map.insert(project_path.to_string(), target);
        }
    }

    /// Execution target previously recorded for a project path.
    ///
    /// Returns `None` when never set — callers must resolve via project
    /// environment and call [`Self::set_project_exec_target`] first.
    /// Never invents `Local`.
    pub fn project_exec_target(
        &self,
        project_path: &str,
    ) -> Option<crate::common::executor::factory::ExecTarget> {
        self.project_exec_targets
            .lock()
            .ok()
            .and_then(|m| m.get(project_path).cloned())
    }

    /// Require a recorded execution target, or return a clear LSP error.
    pub fn require_project_exec_target(
        &self,
        project_path: &str,
    ) -> Result<crate::common::executor::factory::ExecTarget, AppError> {
        self.project_exec_target(project_path).ok_or_else(|| {
            AppError::Lsp(format!(
                "No execution environment recorded for project path '{project_path}'. \
                 Activate the project (or call detect/check with project context) before starting LSP."
            ))
        })
    }

    /// Convenience constructor for tests / simple call sites.
    pub fn new_default() -> Self {
        Self::new(AppRuntime::shared_default())
    }

    /// Business executor used for session spawn / timers (Scheme C).
    pub fn runtime(&self) -> Arc<AppRuntime> {
        Arc::clone(&self.runtime)
    }

    /// Resolve language id for a file path from the live plugin registry (custom first).
    pub fn resolve_language_for_path(&self, file_path: &str) -> Option<String> {
        let ext = std::path::Path::new(file_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        self.plugin_registry
            .lock()
            .ok()
            .and_then(|r| r.resolve_by_extension(ext).map(|p| p.language_id.clone()))
    }

    /// Apply LSP settings from config.json (`lsp` object).
    pub fn apply_settings(&self, settings: &LspSettings) {
        *self.deactivate_stop_secs.lock().expect("infallible") =
            settings.deactivate_stop_minutes.saturating_mul(60).max(60);
        *self.default_auto_start.lock().expect("infallible") =
            LspAutoStart::parse(&settings.auto_start);

        let mut registry = self.plugin_registry.lock().expect("infallible");
        registry.reset_to_defaults();
        for custom in &settings.custom_servers {
            if custom.language_id.trim().is_empty() || custom.command.is_empty() {
                log::warn!(
                    "[LSP] Skipping invalid custom server id={}",
                    custom.id
                );
                continue;
            }
            registry.register(LspPlugin::from_custom(custom));
            log::info!(
                "[LSP] Registered custom server language={} cmd={:?}",
                custom.language_id,
                custom.command
            );
        }
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
        self.plugin_registry
            .lock()
            .expect("infallible")
            .extension_map()
    }

    /// Extension conflicts from the live registry (later registration wins).
    pub fn extension_conflicts(&self) -> Vec<super::plugin::LspExtensionConflict> {
        self.plugin_registry
            .lock()
            .expect("infallible")
            .extension_conflicts()
    }

    /// Get a snapshot of current LSP settings.
    pub fn get_settings_snapshot(&self) -> LspSettings {
        // Reconstruct from runtime state is incomplete for custom list —
        // prefer reading config; this returns defaults + empty customs for API convenience.
        LspSettings {
            auto_start: self
                .default_auto_start
                .lock()
                .expect("infallible")
                .as_str()
                .to_string(),
            deactivate_stop_minutes: self
                .deactivate_stop_secs
                .lock()
                .expect("infallible")
                .saturating_div(60),
            custom_servers: Vec::new(),
        }
    }

    /// Access the diagnostic bus (for hooking up transport subscribers).
    pub fn diag_bus(&self) -> &DiagnosticBus {
        &self.diag_bus
    }

    /// Access the plugin registry (for listing available languages from the frontend).
    pub fn plugin_registry(&self) -> &Mutex<LspPluginRegistry> {
        &self.plugin_registry
    }

    /// Server binary name for a language id from the live plugin registry.
    pub fn plugin_server_binary(&self, language_id: &str) -> Option<String> {
        self.plugin_registry
            .lock()
            .ok()
            .and_then(|r| r.resolve_by_language(language_id).map(|p| p.server_binary.clone()))
    }

    /// Register a custom LSP plugin at runtime (e.g. from user settings).
    pub fn register_plugin(&self, plugin: LspPlugin) {
        self.plugin_registry
            .lock()
            .expect("infallible")
            .register(plugin);
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
        log::info!("[LSP] Register open doc: {} (key={})", uri, key);
        let doc = OpenDocument {
            uri: uri.to_string(),
            language_id: language_id.to_string(),
            text: text.to_string(),
            version,
        };
        if let Ok(mut map) = self.open_docs.lock() {
            map.entry(key).or_default().push(doc);
        }
    }

    /// Check whether a document is already registered as open for this session.
    pub fn is_document_open(&self, project_path: &str, language_id: &str, uri: &str) -> bool {
        let key = session_key(project_path, language_id);
        if let Ok(map) = self.open_docs.lock() {
            if let Some(docs) = map.get(&key) {
                return docs.iter().any(|d| d.uri == uri);
            }
        }
        false
    }

    /// Unregister a closed document.
    pub fn unregister_open_document(&self, project_path: &str, language_id: &str, uri: &str) {
        let key = session_key(project_path, language_id);
        if let Ok(mut map) = self.open_docs.lock() {
            if let Some(docs) = map.get_mut(&key) {
                docs.retain(|d| d.uri != uri);
                if docs.is_empty() {
                    map.remove(&key);
                }
            }
        }
    }

    /// Set the Tauri AppHandle and connect the diagnostic bus to event emission.
    pub fn set_app_handle(&self, app_handle: tauri::AppHandle) {
        // Connect the diagnostic bus to Tauri event emission
        let ah = app_handle.clone();
        let diag_subscriber = self.diag_bus.subscribe(move |event: &DiagnosticEvent| {
            let transport = IpcTransport::new(ah.clone());
            transport.push_diagnostics(&event.project_path, &event.uri, event.diagnostics.clone());
        });
        // Leak the subscription intentionally — it lives for the app lifetime
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
    ) -> Result<String, AppError> {
        let key = session_key(project_path, language_id);
        let mut sessions = self.sessions.lock().expect("infallible: lsp sessions lock");

        if let Some(session) = sessions.get(&key) {
            if session.is_alive() {
                return Ok(key);
            }
            log::warn!("[LSP] Session {} is dead, removing", key);
            sessions.remove(&key);
        }

        // Look up plugin via registry
        let plugin = {
            let registry = self.plugin_registry.lock().expect("infallible");
            registry
                .resolve_by_language(language_id)
                .cloned()
                .ok_or_else(|| {
                    AppError::Lsp(format!(
                        "No LSP plugin registered for language: {}",
                        language_id
                    ))
                })?
        };

        let app_handle = self
            .app_handle
            .lock()
            .expect("infallible: lsp app_handle lock")
            .clone()
            .ok_or_else(|| AppError::Lsp("AppHandle not set".to_string()))?;

        let diag_bus = Arc::new(self.diag_bus.clone());
        let transport: Arc<dyn LspTransport> = Arc::new(IpcTransport::new(app_handle.clone()));

        let exec_target = self.require_project_exec_target(project_path)?;
        let session = LspSession::new(
            &plugin,
            project_path,
            app_handle,
            diag_bus,
            transport,
            exec_target,
        )
        .map_err(|e| AppError::Lsp(e.to_string()))?;

        // Re-open any previously open documents for this session (covers restart)
        let open_count = self.reopen_documents(&key, &session);
        log::info!(
            "[LSP] Session {} created for {} (re-opened {} doc(s))",
            key,
            plugin.server_binary,
            open_count
        );

        sessions.insert(key.clone(), session);
        Ok(key)
    }

    /// Re-open all tracked documents for a session key (after restart).
    fn reopen_documents(&self, key: &str, session: &LspSession) -> usize {
        let Ok(docs_map) = self.open_docs.lock() else {
            return 0;
        };
        let Some(docs) = docs_map.get(key) else {
            return 0;
        };
        let mut count = 0;
        for doc in docs {
            log::info!(
                "[LSP] Re-opening document {} after session restart",
                doc.uri
            );
            let open_params = serde_json::json!({
                "textDocument": {
                    "uri": doc.uri.clone(),
                    "languageId": doc.language_id.clone(),
                    "version": doc.version,
                    "text": doc.text.clone(),
                }
            });
            let ok = session
                .send_notification_raw("textDocument/didOpen", open_params)
                .is_ok();
            if ok {
                count += 1;
            } else {
                log::warn!("[LSP] Failed to re-open document: {}", doc.uri);
            }
        }
        count
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
        let fast_result = {
            let sessions = self.sessions.lock().expect("infallible");

            if let Some(session) = sessions.get(&key) {
                if session.is_alive() {
                    let pending = Arc::clone(&session.pending);
                    let writer = session.writer.clone();
                    let inflight = Arc::clone(&session.inflight);
                    Some((pending, writer, inflight))
                } else {
                    log::warn!("[LSP] Session {} is not alive, will restart", key);
                    None
                }
            } else {
                None
            }
        };

        if let Some((pending, writer, inflight)) = fast_result {
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

        // Restart path: gather state under lock, then drop it
        let attempt = {
            let mut sessions = self.sessions.lock().expect("infallible");
            let attempt = sessions.get(&key).map(|s| s.restart_count).unwrap_or(0);
            sessions.remove(&key);
            attempt
        };

        if attempt > 0 && attempt < MAX_RESTART_COUNT {
            let delay = restart_delay(attempt);
            log::warn!(
                "[LSP] Backoff: waiting {:?} before restart attempt {} for {}",
                delay,
                attempt + 1,
                key
            );
            tokio::time::sleep(delay).await;
        }

        // Spawn session creation on the business AppRuntime blocking pool
        let this = Arc::clone(self);
        let pp = project_path.to_string();
        let lid = language_id.to_string();
        self.runtime
            .spawn_blocking(move || this.get_or_create_session(&pp, &lid))
            .await
            .map_err(|e| AppError::Lsp(format!("spawn_blocking join error: {}", e)))??;

        let (pending, writer, inflight) = {
            let sessions = self.sessions.lock().expect("infallible");
            match sessions.get(&key) {
                Some(session) => (
                    Some(Arc::clone(&session.pending)),
                    Some(session.writer.clone()),
                    Some(Arc::clone(&session.inflight)),
                ),
                None => (None, None, None),
            }
        };

        match (pending, writer, inflight) {
            (Some(pending), Some(writer), Some(inflight)) => {
                do_send_request(pending, writer, inflight, method, params)
                    .await
                    .map_err(|e| AppError::Lsp(e.to_string()))
            }
            _ => Err(AppError::Lsp(format!(
                "Failed to create LSP session: {}",
                key
            ))),
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
        let sessions = self.sessions.lock().expect("infallible: lsp sessions lock");

        let session = sessions
            .get(&key)
            .ok_or_else(|| AppError::Lsp(format!("No LSP session for: {}", key)))?;

        session
            .send_notification_raw(method, params)
            .map_err(|e| AppError::Lsp(e.to_string()))
    }

    /// Close an LSP session for a project and language.
    pub fn close_session(&self, project_path: &str, language_id: &str) -> Result<(), AppError> {
        let key = session_key(project_path, language_id);
        let mut sessions = self.sessions.lock().expect("infallible: lsp sessions lock");

        if let Some(mut s) = sessions.remove(&key) {
            s.transport
                .push_session_event(project_path, language_id, "stopped", None, None);
            let _ = s.send_notification_raw("shutdown", serde_json::json!({}));
            s.kill_child();
            log::info!("[LSP] Closed session: {}", key);
        }
        if let Ok(mut docs) = self.open_docs.lock() {
            docs.remove(&key);
        }
        Ok(())
    }

    /// Close every LSP session belonging to `project_path`.
    pub fn close_sessions_for_project(&self, project_path: &str) {
        let to_close: Vec<(String, String)> = {
            let sessions = self.sessions.lock().expect("infallible");
            sessions
                .values()
                .filter(|s| s.project_path == project_path)
                .map(|s| (s.project_path.clone(), s.language_id.clone()))
                .collect()
        };
        for (pp, lid) in to_close {
            let _ = self.close_session(&pp, &lid);
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
        let mut gens = self.deactivate_gens.lock().expect("infallible");
        let entry = gens.entry(project_path.to_string()).or_insert(0);
        *entry = entry.saturating_add(1);
        log::debug!("[LSP] Cancelled deactivate timer for {}", project_path);
    }

    /// After leaving a project, schedule session teardown in DEACTIVATE_STOP_SECS.
    pub fn schedule_deactivate(self: &Arc<Self>, project_path: String) {
        let my_gen = {
            let mut gens = self.deactivate_gens.lock().expect("infallible");
            let entry = gens.entry(project_path.clone()).or_insert(0);
            *entry = entry.saturating_add(1);
            *entry
        };

        let stop_secs = *self.deactivate_stop_secs.lock().expect("infallible");
        let this = Arc::clone(self);
        let pp = project_path.clone();
        // Business runtime — safe from sync Tauri commands (no current Handle).
        self.runtime.spawn(async move {
            tokio::time::sleep(Duration::from_secs(stop_secs)).await;
            let current = this
                .deactivate_gens
                .lock()
                .expect("infallible")
                .get(&pp)
                .copied()
                .unwrap_or(0);
            if current == my_gen {
                log::info!(
                    "[LSP] Project deactivated for {}s, stopping sessions: {}",
                    stop_secs,
                    pp
                );
                this.close_sessions_for_project(&pp);
            } else {
                log::debug!(
                    "[LSP] Deactivate timer for {} superseded (gen {} → {})",
                    pp,
                    my_gen,
                    current
                );
            }
        });
        log::info!(
            "[LSP] Scheduled deactivate in {}s for project {}",
            stop_secs,
            project_path
        );
    }

    /// Detect profile, cancel stop timer, emit profile event. Call when project becomes active.
    /// If autoStart is onProjectSelect, spawns the primary language server in the background.
    ///
    /// `primary_override` is the project-level primary language preference (from
    /// `Project.primary_language`). When set, it wins over root-marker priority.
    pub fn activate_project(
        self: &Arc<Self>,
        project_path: &str,
        primary_override: Option<&str>,
    ) -> ProjectLanguageProfile {
        self.cancel_deactivate(project_path);
        // All markers (built-in + custom) come from the live plugin registry.
        let markers = self
            .plugin_registry
            .lock()
            .expect("infallible")
            .detection_markers();
        let profile =
            detect_project_profile_with_markers(project_path, &markers, primary_override);
        if let Ok(mut map) = self.profiles.lock() {
            map.insert(project_path.to_string(), profile.clone());
        }

        if let Ok(handle) = self.app_handle.lock() {
            if let Some(app) = handle.as_ref() {
                use tauri::Emitter;
                if let Err(e) = app.emit("lsp-project-profile", &profile) {
                    log::warn!("[LSP] Failed to emit global profile event: {}", e);
                }
            }
        }

        // Optional: start primary when policy is onProjectSelect (via AppRuntime).
        if let Some(ref primary) = profile.primary {
            let policy = self.resolve_auto_start(&primary.language_id);
            if policy == LspAutoStart::OnProjectSelect {
                let this = Arc::clone(self);
                let pp = project_path.to_string();
                let lid = primary.language_id.clone();
                self.runtime.spawn_blocking(move || {
                    if let Err(e) = this.get_or_create_session(&pp, &lid) {
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

    fn resolve_auto_start(&self, language_id: &str) -> LspAutoStart {
        let registry = self.plugin_registry.lock().expect("infallible");
        if let Some(p) = registry.resolve_by_language(language_id) {
            if p.is_custom {
                return p.auto_start;
            }
        }
        *self.default_auto_start.lock().expect("infallible")
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
        let mut sessions = self.sessions.lock().expect("infallible: lsp sessions lock");
        for (key, mut s) in sessions.drain() {
            s.transport
                .push_session_event(&s.project_path, &s.language_id, "stopped", None, None);
            let _ = s.send_notification_raw("shutdown", serde_json::json!({}));
            s.kill_child();
            log::info!("[LSP] Closed session: {}", key);
        }
        if let Ok(mut docs) = self.open_docs.lock() {
            docs.clear();
        }
        log::info!("[LSP] Closed all sessions");
    }

    /// List all active LSP sessions.
    pub fn list_sessions(&self) -> Vec<LspSessionInfo> {
        let sessions = self.sessions.lock().expect("infallible: lsp sessions lock");

        sessions
            .values()
            .map(|s| LspSessionInfo {
                language_id: s.language_id.clone(),
                project_path: s.project_path.clone(),
                server_name: s.server_name.clone(),
                status: s.status.as_str().to_string(),
                status_message: match &s.status {
                    LspSessionStatus::Error(msg) => Some(msg.clone()),
                    _ => None,
                },
                progress_pct: None,
            })
            .collect()
    }

    /// Get cached server capabilities for a session.
    /// Used by lsp_transport to respond to @codemirror/lsp-client initialize.
    pub fn get_capabilities(&self, project_path: &str, language_id: &str) -> Option<Value> {
        let key = session_key(project_path, language_id);
        let sessions = self.sessions.lock().expect("infallible: lsp sessions lock");
        sessions.get(&key).map(|s| s.server_capabilities.clone())
    }

    /// Resolve a file path to an LSP language id via extension lookup.
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

// ── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_key() {
        let key = session_key("/home/user/project", "rust");
        assert_eq!(key, "/home/user/project:rust");
    }

    #[test]
    fn test_restart_delay() {
        let d0 = restart_delay(0);
        assert_eq!(d0, Duration::from_millis(500));

        let d2 = restart_delay(2);
        assert_eq!(d2, Duration::from_millis(2000));

        let d4 = restart_delay(4);
        assert_eq!(d4, Duration::from_millis(8000));
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
        let registry = manager.plugin_registry.lock().unwrap();

        assert!(registry.resolve_by_extension("rs").is_some());
        assert!(registry.resolve_by_extension("py").is_some());
        assert!(registry.resolve_by_extension("go").is_some());
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

        let registry = manager.plugin_registry.lock().unwrap();
        assert!(registry.is_registered("testlang"));
        assert_eq!(
            registry.resolve_by_extension("tl").unwrap().language_id,
            "testlang"
        );
    }

    // ── LspSessionStatus tests ──────────────────────────────────────────

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
    fn test_session_info_has_status_message_and_progress() {
        let info = LspSessionInfo {
            language_id: "python".into(),
            project_path: "/test".into(),
            server_name: "pyright".into(),
            status: "indexing".into(),
            status_message: Some("Indexing workspace...".into()),
            progress_pct: Some(45),
        };
        assert_eq!(info.status_message, Some("Indexing workspace...".into()));
        assert_eq!(info.progress_pct, Some(45));
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
        // Old `connected` field must not exist
        assert!(parsed.get("connected").is_none());
    }
}
