use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::Stdio;

use crate::common::runtime::AppRuntime;
use crate::common::utils::command::local::cmd_from_path;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use crossbeam_channel::{Receiver, Sender};
use lsp_server::{ErrorCode, Message, Notification, Request, RequestId, Response};
use serde_json::Value;

use crate::AppError;

use super::diag_bus::{DiagnosticBus, DiagnosticEvent};
use super::inflight::InflightRequestTracker;
use super::plugin::{
    CustomLspServerConfig, LspAutoStart, LspPlugin, LspPluginRegistry, LspSettings,
};
use super::profile::{detect_project_profile_with_extras, ProjectLanguageProfile};
use super::transport::{IpcTransport, LspTransport, ProgressKind};
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
static NEXT_REQ_ID: AtomicI32 = AtomicI32::new(1);

type SessionKey = String;

fn session_key(project_path: &str, language_id: &str) -> SessionKey {
    format!("{}:{}", project_path, language_id)
}

/// Compute the restart delay with exponential backoff.
fn restart_delay(attempt: u32) -> Duration {
    Duration::from_millis(RESTART_BASE_DELAY_MS * 2_u64.saturating_pow(attempt))
}

// ── LspSessionStatus ────────────────────────────────────────────────────

/// Lifecycle status of an LSP session, emitted to the frontend.
#[derive(Debug, Clone, PartialEq)]
pub enum LspSessionStatus {
    Starting,
    Initializing,
    Indexing,
    Ready,
    Error(String),
    Stopped,
}

impl LspSessionStatus {
    fn as_str(&self) -> &str {
        match self {
            LspSessionStatus::Starting => "starting",
            LspSessionStatus::Initializing => "initializing",
            LspSessionStatus::Indexing => "indexing",
            LspSessionStatus::Ready => "ready",
            LspSessionStatus::Error(_) => "error",
            LspSessionStatus::Stopped => "stopped",
        }
    }
}

// ── LspSession ──────────────────────────────────────────────────────────

/// Cancel a previous in-flight request: notify the server and unblock its waiter.
fn cancel_inflight_request(
    pending: &Mutex<HashMap<RequestId, PendingSender>>,
    writer: &crossbeam_channel::Sender<Message>,
    prev_id: RequestId,
    method: &str,
) {
    {
        let mut map = pending.lock().expect("infallible");
        if let Some(tx) = map.remove(&prev_id) {
            let _ = tx.send(Message::Response(Response::new_err(
                prev_id.clone(),
                ErrorCode::RequestCanceled as i32,
                "superseded by newer request".into(),
            )));
        }
    }
    let cancel = Notification::new(
        "$/cancelRequest".to_string(),
        serde_json::json!({ "id": prev_id }),
    );
    if let Err(e) = writer.send(Message::Notification(cancel)) {
        log::warn!(
            "[LSP] Failed to send $/cancelRequest for {} id={:?}: {}",
            method,
            prev_id,
            e
        );
    } else {
        log::debug!(
            "[LSP] Cancelled previous {} request id={:?}",
            method,
            prev_id
        );
    }
}

/// Send an LSP request and await the response.
///
/// This free function takes cloned session ingredients (writer + pending map)
/// so it can be called without borrowing a MutexGuard across the await point.
///
/// For single-flight methods (hover/definition/…), a newer request cancels the
/// previous in-flight one via `$/cancelRequest` to prevent flooding the server.
async fn do_send_request(
    pending: Arc<Mutex<HashMap<RequestId, PendingSender>>>,
    writer: crossbeam_channel::Sender<Message>,
    inflight: Arc<Mutex<InflightRequestTracker>>,
    method: &str,
    params: Value,
) -> Result<Value> {
    let req_id = NEXT_REQ_ID.fetch_add(1, Ordering::Relaxed);
    let request_id = RequestId::from(req_id);

    // Single-flight: cancel previous request of the same method if still pending
    {
        let mut tracker = inflight.lock().expect("infallible");
        if let Some(prev_id) = tracker.register(method, request_id.clone()) {
            cancel_inflight_request(&pending, &writer, prev_id, method);
        }
    }

    let (tx, rx) = tokio::sync::oneshot::channel();
    {
        let mut map = pending.lock().expect("infallible");
        map.insert(request_id.clone(), tx);
    }

    let req = Request::new(request_id.clone(), method.to_string(), params);
    writer
        .send(Message::Request(req))
        .with_context(|| format!("Failed to send LSP request: {}", method))?;

    let t0 = std::time::Instant::now();
    let response = rx
        .await
        .with_context(|| format!("No response received for LSP request: {}", method))?;
    log::info!(
        "[perf] do_send_request {}: awaited {:?}",
        method,
        t0.elapsed()
    );

    // Clear tracking if we are still the current request for this method
    {
        let mut tracker = inflight.lock().expect("infallible");
        tracker.complete(method, &request_id);
    }

    match response {
        Message::Response(resp) => {
            if let Some(err) = resp.error {
                // Cancelled / superseded requests are not user-facing errors
                if err.code == ErrorCode::RequestCanceled as i32 {
                    return Ok(Value::Null);
                }
                bail!("LSP error ({}): {}", err.code, err.message);
            }
            // A null result is valid per LSP spec — means "no data" (e.g. hover on whitespace)
            Ok(resp.result.unwrap_or(Value::Null))
        }
        _ => bail!("Unexpected message type for request: {}", method),
    }
}

type PendingSender = tokio::sync::oneshot::Sender<Message>;

struct LspSession {
    language_id: String,
    project_path: String,
    server_name: String,
    writer: crossbeam_channel::Sender<Message>,
    pending: Arc<Mutex<HashMap<RequestId, PendingSender>>>,
    /// Latest in-flight request per single-flight method (hover/definition/…).
    inflight: Arc<Mutex<InflightRequestTracker>>,
    reader: Option<thread::JoinHandle<Result<()>>>,
    stderr_logger: Option<thread::JoinHandle<()>>,
    restart_count: u32,
    /// Cached server capabilities from the initialize handshake.
    server_capabilities: Value,
    /// Current lifecycle status.
    status: LspSessionStatus,
    /// Child process handle for lifecycle management (kill on close).
    child: Option<std::process::Child>,
    /// Transport for emitting session lifecycle events to the frontend.
    transport: Arc<dyn LspTransport>,
}

impl LspSession {
    fn new(
        plugin: &LspPlugin,
        project_path: &str,
        app_handle: tauri::AppHandle,
        diag_bus: Arc<DiagnosticBus>,
        transport: Arc<dyn LspTransport>,
    ) -> Result<Self> {
        let language_id = plugin.language_id.to_string();
        let server_name = plugin.server_binary.to_string();

        // ── Auto-install check ──────────────────────────────────────────
        if !crate::lsp::installer::check_server_installed(&language_id) {
            log::info!(
                "[LSP] {} not found, attempting auto-install for: {}",
                server_name,
                language_id
            );
            match crate::lsp::installer::install_server(&language_id, &app_handle) {
                Ok(true) => {
                    log::info!("[LSP] Auto-install succeeded for {}", language_id);
                    if !crate::lsp::installer::check_server_installed(&language_id) {
                        anyhow::bail!(
                            "{} was installed but still not found on PATH. Try restarting Neeko.",
                            server_name
                        );
                    }
                }
                Ok(false) => {
                    log::info!("[LSP] No auto-install method for {}, skipping", language_id);
                }
                Err(e) => {
                    log::error!("[LSP] Auto-install failed for {}: {}", language_id, e);
                    anyhow::bail!(
                        "Failed to auto-install {}. Install it manually: {}",
                        server_name,
                        e
                    );
                }
            }
        }

        let cmd = &plugin.server_command;
        if cmd.is_empty() {
            anyhow::bail!("LSP server command is empty for {}", language_id);
        }
        log::info!(
            "[LSP] Spawning server: language={} binary={:?} project={}",
            language_id,
            cmd,
            project_path
        );
        log::debug!(
            "[LSP] PATH before spawn: {}",
            std::env::var("PATH").unwrap_or_default()
        );
        let mut child = cmd_from_path(&cmd[0])
            .args(&cmd[1..])
            .current_dir(project_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .with_context(|| format!("Failed to spawn LSP server: {}", server_name))?;

        transport.push_session_event(
            project_path,
            &language_id,
            "starting",
            Some(&format!("Starting {}...", server_name)),
            None,
        );

        let child_stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow::anyhow!("Failed to open LSP server stdin"))?;
        let child_stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow::anyhow!("Failed to open LSP server stdout"))?;
        let child_stderr = child
            .stderr
            .take()
            .ok_or_else(|| anyhow::anyhow!("Failed to open LSP server stderr"))?;

        // Channel for writing messages to server
        let (writer_tx, writer_rx): (Sender<Message>, Receiver<Message>) =
            crossbeam_channel::unbounded();

        // Writer thread
        let mut child_stdin_w = child_stdin;
        let _writer_handle = thread::Builder::new()
            .name(format!(
                "lsp-writer-{}",
                &server_name[..4.min(server_name.len())]
            ))
            .spawn(move || -> Result<()> {
                for msg in writer_rx {
                    msg.write(&mut child_stdin_w)
                        .context("LSP writer: failed to write message")?;
                }
                Ok(())
            })
            .unwrap();

        // Stderr logger thread
        let stderr_name = server_name.clone();
        let stderr_handle = thread::Builder::new()
            .name(format!(
                "lsp-stderr-{}",
                &server_name[..4.min(server_name.len())]
            ))
            .spawn(move || {
                let reader = BufReader::new(child_stderr);
                for line in reader.lines() {
                    match line {
                        Ok(l) => {
                            let trimmed = l.trim_end().to_string();
                            if !trimmed.is_empty() {
                                log::warn!("[LSP][{} stderr] {}", stderr_name, trimmed);
                            }
                        }
                        Err(_) => break,
                    }
                }
            })
            .ok();

        // Build root URI
        let root_uri = url::Url::from_directory_path(project_path)
            .map_err(|_| anyhow::anyhow!("Invalid project path: {}", project_path))?
            .to_string();

        let pending: Arc<Mutex<HashMap<RequestId, PendingSender>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // Reader thread
        let reader_stream = BufReader::new(child_stdout);
        let pending_clone = Arc::clone(&pending);
        let pp_reader = project_path.to_string();
        let lang_id_clone = language_id.clone();
        let transport_clone = Arc::clone(&transport);
        // Clone writer so the reader can answer server→client requests
        // (e.g. window/workDoneProgress/create) without blocking the server.
        let writer_for_reader = writer_tx.clone();

        let reader_handle = thread::Builder::new()
            .name(format!(
                "lsp-reader-{}",
                &server_name[..4.min(server_name.len())]
            ))
            .spawn(move || -> Result<()> {
                let mut reader_stream = reader_stream;
                while let Some(msg) =
                    Message::read(&mut reader_stream).context("LSP reader: read error")?
                {
                    match &msg {
                        Message::Response(resp) => {
                            let mut map = pending_clone.lock().expect("infallible");
                            if let Some(tx) = map.remove(&resp.id) {
                                // tokio oneshot: non-blocking send from OS thread
                                let _ = tx.send(msg);
                                continue;
                            }
                            log::debug!("[LSP] Dropping unmatched response id={:?}", resp.id);
                        }
                        Message::Notification(notif) => {
                            if notif.method == "textDocument/publishDiagnostics" {
                                handle_diagnostics_notification(
                                    &notif.params,
                                    &pp_reader,
                                    &lang_id_clone,
                                    &diag_bus,
                                );
                            } else if notif.method == "window/workDoneProgress"
                                || notif.method == "$/progress"
                            {
                                handle_progress_notification(
                                    &notif.params,
                                    &pp_reader,
                                    &lang_id_clone,
                                    &*transport_clone,
                                );
                            }
                        }
                        Message::Request(req) => {
                            // Server→client requests must be answered. Ignoring them
                            // stalls gopls (workDoneProgress/create) so hover/definition
                            // never complete. See server_request.rs.
                            let root = url::Url::from_directory_path(&pp_reader)
                                .ok()
                                .map(|u| u.to_string());
                            let resp = super::server_request::respond_to_server_request(
                                req,
                                root.as_deref(),
                            );
                            log::debug!(
                                "[LSP] Answered server request: {} id={:?}",
                                req.method,
                                req.id
                            );
                            if let Err(e) = writer_for_reader.send(Message::Response(resp)) {
                                log::warn!(
                                    "[LSP] Failed to send response for server request {}: {}",
                                    req.method,
                                    e
                                );
                            }
                        }
                    }
                }
                Ok(())
            })
            .unwrap();

        // ── Initialize handshake ─────────────────────────────────────────
        let (init_tx, init_rx) = tokio::sync::oneshot::channel::<Message>();

        let init_params = serde_json::json!({
            "processId": std::process::id(),
            "rootUri": root_uri,
            "rootPath": project_path,
            "workspaceFolders": [{
                "uri": root_uri,
                "name": std::path::Path::new(project_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("workspace"),
            }],
            "capabilities": {
                "textDocument": {
                    "hover": { "contentFormat": ["markdown", "plaintext"] },
                    "definition": { "linkSupport": true },
                    "references": {},
                    "completion": {
                        "completionItem": {
                            "snippetSupport": false,
                            "documentationFormat": ["markdown", "plaintext"]
                        }
                    },
                    "publishDiagnostics": { "relatedInformation": true }
                },
                "workspace": {
                    "workspaceFolders": true,
                    "configuration": true,
                    "didChangeConfiguration": { "dynamicRegistration": false }
                },
                "window": {
                    "workDoneProgress": true
                }
            },
            "clientInfo": {
                "name": "neeko",
                "version": env!("CARGO_PKG_VERSION"),
            },
        });

        let init_req_id = RequestId::from(1i32);

        {
            let mut map = pending.lock().expect("infallible");
            map.insert(init_req_id.clone(), init_tx);
        }

        let init_req = Request::new(init_req_id.clone(), "initialize".to_string(), init_params);
        writer_tx
            .send(Message::Request(init_req))
            .context("Failed to send initialize request")?;

        let init_response = init_rx
            .blocking_recv()
            .context("LSP initialization: no response received")?;

        let server_capabilities = match init_response {
            Message::Response(ref resp) => resp
                .result
                .clone()
                .ok_or_else(|| anyhow::anyhow!("LSP initialize response has no result")),
            _ => bail!("LSP initialization: unexpected message type"),
        }?;

        log::info!("[LSP] {} initialized, capabilities received", server_name);

        transport.push_session_event(project_path, &language_id, "initializing", None, None);
        transport.push_session_event(project_path, &language_id, "ready", None, None);

        let notif = Notification::new("initialized".to_string(), serde_json::json!({}));
        writer_tx
            .send(Message::Notification(notif))
            .context("Failed to send initialized notification")?;

        // Clean up init from pending map
        {
            let mut map = pending.lock().expect("infallible");
            map.remove(&init_req_id);
        }

        Ok(Self {
            language_id,
            project_path: project_path.to_string(),
            server_name,
            writer: writer_tx,
            pending,
            inflight: Arc::new(Mutex::new(InflightRequestTracker::new())),
            reader: Some(reader_handle),
            stderr_logger: stderr_handle,
            restart_count: 0,
            server_capabilities,
            status: LspSessionStatus::Ready,
            child: Some(child),
            transport,
        })
    }

    fn is_alive(&self) -> bool {
        self.reader
            .as_ref()
            .map(|h| !h.is_finished())
            .unwrap_or(false)
    }

    /// Send an LSP request and await the response asynchronously.
    /// Takes a clone of the writer sender so it can be called without borrowing
    /// `self` across the await point — safe even if the session is removed
    /// from the session map while waiting.
    async fn send_request_async(&self, method: &str, params: Value) -> Result<Value> {
        do_send_request(
            Arc::clone(&self.pending),
            self.writer.clone(),
            Arc::clone(&self.inflight),
            method,
            params,
        )
        .await
    }

    fn send_notification_raw(&self, method: &str, params: Value) -> Result<()> {
        let notif = Notification::new(method.to_string(), params);
        self.writer
            .send(Message::Notification(notif))
            .with_context(|| format!("Failed to send LSP notification: {}", method))
    }

    /// Kill the child process and wait for it to exit.
    fn kill_child(&mut self) {
        if let Some(ref mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// Emit a session lifecycle event to the frontend via the transport.
    fn emit_session_event(
        &self,
        status: LspSessionStatus,
        message: Option<&str>,
        progress_pct: Option<u32>,
    ) {
        self.transport.push_session_event(
            &self.project_path,
            &self.language_id,
            status.as_str(),
            message,
            progress_pct,
        );
    }
}

// ── Notification handlers (free functions) ──────────────────────────────

fn handle_diagnostics_notification(
    params: &Value,
    project_path: &str,
    language_id: &str,
    diag_bus: &DiagnosticBus,
) {
    let uri = params.get("uri").and_then(|v| v.as_str()).unwrap_or("");

    // Pass the raw diagnostics JSON array through without parsing —
    // avoids a serialize→parse→serialize round-trip.
    let diagnostics = params
        .get("diagnostics")
        .cloned()
        .unwrap_or_else(|| serde_json::json!([]));

    diag_bus.publish(DiagnosticEvent {
        project_path: project_path.to_string(),
        uri: uri.to_string(),
        language_id: language_id.to_string(),
        diagnostics,
    });
}

fn handle_progress_notification(
    params: &Value,
    project_path: &str,
    language_id: &str,
    transport: &dyn LspTransport,
) {
    let token = params.get("token").and_then(|v| v.as_str()).unwrap_or("");
    let value = params.get("value");
    let kind = value.and_then(|v| v.get("kind").and_then(|k| k.as_str()));

    match kind {
        Some("begin") => {
            let msg = value
                .and_then(|v| v.get("title"))
                .and_then(|t| t.as_str())
                .unwrap_or("");
            log::info!(
                "[LSP] Progress begin [{}] {} for project {}",
                token,
                msg,
                project_path
            );
            transport.push_session_event(project_path, language_id, "indexing", Some(msg), None);
            transport.push_progress(
                project_path,
                language_id,
                token,
                ProgressKind::Begin,
                Some(msg),
                None,
            );
        }
        Some("report") => {
            let msg = value
                .and_then(|v| v.get("message"))
                .and_then(|m| m.as_str());
            let pct = value
                .and_then(|v| v.get("percentage"))
                .and_then(|p| p.as_u64())
                .and_then(|p| u32::try_from(p).ok());
            log::info!(
                "[LSP] Progress report [{}]: {:?} ({:?}%) for project {}",
                token,
                msg,
                pct,
                project_path
            );
            transport.push_progress(
                project_path,
                language_id,
                token,
                ProgressKind::Report,
                msg,
                pct,
            );
            transport.push_session_event(project_path, language_id, "indexing", msg, pct);
        }
        Some("end") => {
            log::info!(
                "[LSP] Progress end [{}] for project {}",
                token,
                project_path
            );
            transport.push_session_event(project_path, language_id, "ready", None, None);
            transport.push_progress(
                project_path,
                language_id,
                token,
                ProgressKind::End,
                None,
                None,
            );
        }
        _ => {}
    }
}

// ── LspManager ──────────────────────────────────────────────────────────

/// Manages LSP server sessions with plugin-based language discovery
/// and exponential backoff restart strategy.
pub struct LspManager {
    /// Business async executor (never bare `tokio::spawn`).
    runtime: Arc<AppRuntime>,
    sessions: Arc<Mutex<HashMap<SessionKey, LspSession>>>,
    open_docs: Arc<Mutex<HashMap<SessionKey, Vec<OpenDocument>>>>,
    plugin_registry: Mutex<LspPluginRegistry>,
    diag_bus: DiagnosticBus,
    app_handle: Mutex<Option<tauri::AppHandle>>,
    /// Cached language profiles per project path (from root-marker detection).
    profiles: Mutex<HashMap<String, ProjectLanguageProfile>>,
    /// Generation counter per project path to cancel pending deactivate timers.
    deactivate_gens: Arc<Mutex<HashMap<String, u64>>>,
    /// Seconds after deactivation before closing sessions (from settings).
    deactivate_stop_secs: Mutex<u64>,
    /// Default auto-start policy for built-in languages.
    default_auto_start: Mutex<LspAutoStart>,
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
        }
    }

    /// Convenience constructor for tests / simple call sites.
    pub fn new_default() -> Self {
        Self::new(AppRuntime::shared_default())
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

    pub fn apply_settings_from_json(&self, config: &serde_json::Value) {
        let settings = config
            .get("lsp")
            .cloned()
            .and_then(|v| serde_json::from_value::<LspSettings>(v).ok())
            .unwrap_or_default();
        self.apply_settings(&settings);
    }

    pub fn extension_map(&self) -> Vec<super::plugin::LspExtensionMapEntry> {
        self.plugin_registry
            .lock()
            .expect("infallible")
            .extension_map()
    }

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

        let session = LspSession::new(&plugin, project_path, app_handle, diag_bus, transport)
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

        // Spawn session creation on blocking thread pool — it spawns OS processes
        let this = Arc::clone(self);
        let pp = project_path.to_string();
        let lid = language_id.to_string();
        tokio::task::spawn_blocking(move || this.get_or_create_session(&pp, &lid))
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
    pub fn activate_project(self: &Arc<Self>, project_path: &str) -> ProjectLanguageProfile {
        self.cancel_deactivate(project_path);
        let extra_markers = self
            .plugin_registry
            .lock()
            .expect("infallible")
            .custom_root_markers();
        let profile = detect_project_profile_with_extras(project_path, &extra_markers);
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
    fn test_custom_plugin_registration() {
        let manager = LspManager::new_default();
        manager.register_plugin(LspPlugin {
            language_id: "testlang".into(),
            extensions: vec!["tl".into()],
            server_binary: "test-lsp".into(),
            server_command: vec!["test-lsp".into()],
            install: None,
            root_markers: vec![],
            auto_start: LspAutoStart::OnFirstFile,
            is_custom: true,
        });

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
