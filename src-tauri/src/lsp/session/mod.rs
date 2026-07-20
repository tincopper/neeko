//! One LSP language-server session: spawn, I/O threads, request/response.
//!
//! Multi-session orchestration lives in [`super::manager`].

mod notify;
mod request;

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::sync::{Arc, Mutex};
use std::thread;

use anyhow::{bail, Context, Result};
use crossbeam_channel::{Receiver, Sender};
use lsp_server::{Message, Notification, Request, RequestId};
use serde_json::Value;

use super::diag_bus::DiagnosticBus;
use super::inflight::InflightRequestTracker;
use super::plugin::LspPlugin;
use super::transport::LspTransport;
use notify::{handle_diagnostics_notification, handle_progress_notification};
use request::PendingSender;

pub(crate) use request::do_send_request;

// ── LspSessionStatus ────────────────────────────────────────────────────


/// Lifecycle status of an LSP session, emitted to the frontend.
#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)]
pub(crate) enum LspSessionStatus {
    /// Server process is starting.
    Starting,
    /// Initialize handshake in progress.
    Initializing,
    /// Server is indexing the workspace.
    Indexing,
    /// Server is ready to accept requests.
    Ready,
    /// An error occurred (carries message).
    Error(String),
    /// Session has been stopped.
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

pub(crate) struct LspSession {
    /// Language identifier (e.g. "rust").
    pub(crate) language_id: String,
    /// Project filesystem path.
    pub(crate) project_path: String,
    /// Server binary name (e.g. "rust-analyzer").
    pub(crate) server_name: String,
    /// Channel sender for writing LSP messages to the server.
    pub(crate) writer: crossbeam_channel::Sender<Message>,
    /// Pending request ID to response sender map.
    pub(crate) pending: Arc<Mutex<HashMap<RequestId, PendingSender>>>,
    /// Latest in-flight request per single-flight method (hover/definition/…).
    pub(crate) inflight: Arc<Mutex<InflightRequestTracker>>,
    /// Reader thread handle for processing server responses.
    pub(crate) reader: Option<thread::JoinHandle<Result<()>>>,
    /// Stderr logger thread handle.
    #[allow(dead_code)]
    pub(crate) stderr_logger: Option<thread::JoinHandle<()>>,
    /// Number of times this session has been restarted.
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
    /// Create a new LSP session: spawn server process, perform initialize handshake.
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

    /// Check whether the reader thread is still running.
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
    #[allow(dead_code)]
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

    /// Send a raw LSP notification to the server.
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
    #[allow(dead_code)]
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

