//! One LSP language-server session: spawn, I/O threads, request/response.
//!
//! Multi-session orchestration lives in [`super::manager`].

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use anyhow::{bail, Context, Result};
use crossbeam_channel::{Receiver, Sender};
use lsp_server::{ErrorCode, Message, Notification, Request, RequestId, Response};
use serde_json::Value;

use super::diag_bus::{DiagnosticBus, DiagnosticEvent};
use super::inflight::InflightRequestTracker;
use super::plugin::LspPlugin;
use super::transport::{LspTransport, ProgressKind};

static NEXT_REQ_ID: AtomicI32 = AtomicI32::new(1);

type SessionKey = String;
// ── LspSessionStatus ────────────────────────────────────────────────────

/// Lifecycle status of an LSP session, emitted to the frontend.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum LspSessionStatus {
    Starting,
    Initializing,
    Indexing,
    Ready,
    Error(String),
    Stopped,
}

impl LspSessionStatus {
    pub(crate) fn as_str(&self) -> &str {
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
pub(crate) async fn do_send_request(
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

pub(crate) struct LspSession {
    pub(crate) language_id: String,
    pub(crate) project_path: String,
    pub(crate) server_name: String,
    pub(crate) writer: crossbeam_channel::Sender<Message>,
    pub(crate) pending: Arc<Mutex<HashMap<RequestId, PendingSender>>>,
    /// Latest in-flight request per single-flight method (hover/definition/…).
    pub(crate) inflight: Arc<Mutex<InflightRequestTracker>>,
    pub(crate) reader: Option<thread::JoinHandle<Result<()>>>,
    pub(crate) stderr_logger: Option<thread::JoinHandle<()>>,
    pub(crate) restart_count: u32,
    /// Cached server capabilities from the initialize handshake.
    pub(crate) server_capabilities: Value,
    /// Current lifecycle status.
    pub(crate) status: LspSessionStatus,
    /// Child process handle for lifecycle management (kill on close).
    /// Local / WSL / SSH are unified via [`super::process::LspProcess`].
    pub(crate) child: Option<super::process::LspProcess>,
    /// Transport for emitting session lifecycle events to the frontend.
    pub(crate) transport: Arc<dyn LspTransport>,
}

impl LspSession {
    pub(crate) fn new(
        plugin: &LspPlugin,
        project_path: &str,
        app_handle: tauri::AppHandle,
        diag_bus: Arc<DiagnosticBus>,
        transport: Arc<dyn LspTransport>,
        exec_target: crate::common::executor::factory::ExecTarget,
    ) -> Result<Self> {
        let language_id = plugin.language_id.to_string();
        let server_name = plugin.server_binary.to_string();

        // ── Binary presence + auto-install in project environment ───────
        // Recipe comes from the plugin (single source of truth).
        if !crate::lsp::installer::check_plugin_installed(plugin, &exec_target) {
            log::info!(
                "[LSP] {} not found in project env, attempting auto-install for: {}",
                server_name,
                language_id
            );
            match crate::lsp::installer::install_plugin_server(plugin, &app_handle, &exec_target) {
                Ok(true) => {
                    log::info!("[LSP] Auto-install succeeded for {}", language_id);
                    if !crate::lsp::installer::check_plugin_installed(plugin, &exec_target) {
                        anyhow::bail!(
                            "{} was installed but still not found in project PATH. Try restarting Neeko.",
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
            "[LSP] Spawning server: language={} binary={:?} project={} env={:?}",
            language_id,
            cmd,
            project_path,
            std::mem::discriminant(&exec_target)
        );

        let args: Vec<&str> = cmd[1..].iter().map(|s| s.as_str()).collect();
        let mut process = super::process::spawn_lsp_process(
            &exec_target,
            &cmd[0],
            &args,
            Some(project_path),
        )
        .map_err(|e| anyhow::anyhow!("Failed to spawn LSP server {}: {}", server_name, e))?;

        transport.push_session_event(
            project_path,
            &language_id,
            "starting",
            Some(&format!("Starting {}...", server_name)),
            None,
        );

        let (child_stdin, child_stdout, child_stderr) = process
            .take_stdio()
            .map_err(|e| anyhow::anyhow!(e))?;
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

        let mut init_params = serde_json::json!({
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
        if let Some(opts) = plugin.initialization_options.clone() {
            if let Some(obj) = init_params.as_object_mut() {
                obj.insert("initializationOptions".into(), opts);
            }
        }

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
            child: Some(process),
            transport,
        })
    }

    pub(crate) fn is_alive(&self) -> bool {
        self.reader
            .as_ref()
            .map(|h| !h.is_finished())
            .unwrap_or(false)
    }

    /// Send an LSP request and await the response asynchronously.
    /// Takes a clone of the writer sender so it can be called without borrowing
    /// `self` across the await point — safe even if the session is removed
    /// from the session map while waiting.
    pub(crate) async fn send_request_async(&self, method: &str, params: Value) -> Result<Value> {
        do_send_request(
            Arc::clone(&self.pending),
            self.writer.clone(),
            Arc::clone(&self.inflight),
            method,
            params,
        )
        .await
    }

    pub(crate) fn send_notification_raw(&self, method: &str, params: Value) -> Result<()> {
        let notif = Notification::new(method.to_string(), params);
        self.writer
            .send(Message::Notification(notif))
            .with_context(|| format!("Failed to send LSP notification: {}", method))
    }

    /// Kill the child process and wait for it to exit.
    pub(crate) fn kill_child(&mut self) {
        if let Some(mut child) = self.child.take() {
            child.kill();
        }
    }

    /// Emit a session lifecycle event to the frontend via the transport.
    pub(crate) fn emit_session_event(
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

