//! One LSP language-server session: spawn, I/O threads, request/response.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;

use anyhow::{Context, Result};
use crossbeam_channel::{Receiver, Sender};
use lsp_server::{Message, Notification, Request, RequestId};
use serde_json::Value;

use crate::lsp::diag_bus::DiagnosticBus;
use crate::lsp::inflight::InflightRequestTracker;
use crate::lsp::plugin::LspPlugin;
use crate::lsp::transport::LspTransport;
use crate::lsp::types::{parse_server_version_output, LspServerInfo, LspServerLogEntry};

use super::log_ring_buffer::LogRingBuffer;
use super::notify::{handle_diagnostics_notification, handle_progress_notification};
use super::request::PendingSender;
use super::status::LspSessionStatus;
use super::utils::{iso_timestamp_now, sample_process_memory_mb};

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
    #[allow(dead_code)]
    pub(crate) restart_count: u32,
    /// Cached server capabilities from the initialize handshake.
    pub(crate) server_capabilities: Value,
    /// Current lifecycle status.
    pub(crate) status: LspSessionStatus,
    /// Child process handle for lifecycle management (kill on close).
    pub(crate) child: Option<crate::lsp::process::LspProcess>,
    /// OS / remote process id for memory sampling (when available).
    pub(crate) process_pid: Option<u32>,
    /// Version metadata parsed from `--version` at spawn (memory filled on demand).
    pub(crate) server_info: LspServerInfo,
    /// Ring buffer of recent stderr lines for View Logs (max 10 MB).
    pub(crate) log_buffer: Arc<Mutex<LogRingBuffer>>,
    /// Transport for emitting session lifecycle events to the frontend.
    pub(crate) transport: Arc<dyn LspTransport>,
}

impl LspSession {
    /// Create a new LSP session: spawn server process, perform initialize handshake.
    pub(crate) fn new(
        plugin: &LspPlugin,
        project_path: &str,
        workspace_root: &Path,
        app_handle: tauri::AppHandle,
        diag_bus: Arc<DiagnosticBus>,
        transport: Arc<dyn LspTransport>,
        exec_target: crate::common::executor::factory::ExecTarget,
    ) -> Result<Self> {
        let language_id = plugin.language_id.to_string();
        let server_name = plugin.server_binary.to_string();
        // Non-UTF-8 segments are lossy-mapped to `�`; this mirrors how the
        // existing code elsewhere in the codebase falls back to the project
        // root on unrepresentable paths. `url::Url::from_directory_path` and
        // the JSON `rootPath` field both need a `&str`, so we must pick a
        // string representation here. Crucially, `workspace_root` (the `Path`)
        // is still used for `from_directory_path` and `starts_with` checks,
        // so lossy conversion only affects the textual `rootPath` the server
        // sees — the on-disk resolution stays correct.
        let workspace_root_str = workspace_root.to_string_lossy().into_owned();

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
                        anyhow::bail!("{} was installed but still not found in project PATH. Try restarting Neeko.", server_name);
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

        let mut server_info = match crate::lsp::process::run_command_blocking(
            &exec_target,
            &cmd[0],
            &["--version"],
        ) {
            Ok((_code, stdout, stderr)) => {
                parse_server_version_output(if stdout.trim().is_empty() {
                    &stderr
                } else {
                    &stdout
                })
            }
            Err(e) => {
                log::debug!(
                    "[LSP] --version failed for {}: {} (continuing without metadata)",
                    server_name,
                    e
                );
                LspServerInfo::unknown()
            }
        };

        let args: Vec<&str> = cmd[1..].iter().map(|s| s.as_str()).collect();
        let mut process = crate::lsp::process::spawn_lsp_process(
            &exec_target,
            &cmd[0],
            &args,
            Some(&workspace_root_str),
        )
        .map_err(|e| anyhow::anyhow!("Failed to spawn LSP server {}: {}", server_name, e))?;

        let process_pid = process.pid;
        let log_buffer: Arc<Mutex<LogRingBuffer>> = Arc::new(Mutex::new(LogRingBuffer::new()));
        transport.push_session_event(
            project_path,
            &language_id,
            "starting",
            Some(&format!("Starting {}...", server_name)),
            None,
        );

        let (child_stdin, child_stdout, child_stderr) =
            process.take_stdio().map_err(|e| anyhow::anyhow!(e))?;
        let (writer_tx, writer_rx): (Sender<Message>, Receiver<Message>) =
            crossbeam_channel::unbounded();

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
            .map_err(|e| anyhow::anyhow!("Failed to spawn LSP writer thread: {}", e))?;

        let stderr_name = server_name.clone();
        let log_buf_clone = Arc::clone(&log_buffer);
        let stderr_handle = thread::Builder::new()
            .name(format!(
                "lsp-stderr-{}",
                &server_name[..4.min(server_name.len())]
            ))
            .spawn(move || {
                let reader = BufReader::new(child_stderr);
                for line in reader.lines() {
                    let l = match line {
                        Ok(l) => l,
                        Err(_) => break,
                    };
                    let trimmed = l.trim_end().to_string();
                    if !trimmed.is_empty() {
                        let level = if trimmed.contains("error") || trimmed.contains("panic") {
                            "error"
                        } else if trimmed.contains("warn") {
                            "warn"
                        } else {
                            "info"
                        };
                        log::warn!("[LSP][{} stderr] {}", stderr_name, trimmed);
                        let entry = LspServerLogEntry {
                            timestamp: iso_timestamp_now(),
                            level: level.into(),
                            message: trimmed,
                        };
                        if let Ok(mut buf) = log_buf_clone.lock() {
                            buf.push(entry);
                        }
                    }
                }
            })
            .ok();

        let root_uri = url::Url::from_directory_path(workspace_root)
            .map_err(|_| anyhow::anyhow!("Invalid workspace root: {}", workspace_root_str))?
            .to_string();
        let pending: Arc<Mutex<HashMap<RequestId, PendingSender>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let reader_stream = BufReader::new(child_stdout);
        let pending_clone = Arc::clone(&pending);
        let pp_reader = project_path.to_string();
        let ws_root_reader = workspace_root_str.to_string();
        let lang_id_clone = language_id.clone();
        let transport_clone = Arc::clone(&transport);
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
                            let mut map = pending_clone.lock().map_err(|e| {
                                anyhow::anyhow!("LSP reader pending lock poisoned: {}", e)
                            })?;
                            if let Some(tx) = map.remove(&resp.id) {
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
                            let root = url::Url::from_directory_path(&ws_root_reader)
                                .ok()
                                .map(|u| u.to_string());
                            let resp = crate::lsp::server_request::respond_to_server_request(
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
            .map_err(|e| anyhow::anyhow!("Failed to spawn LSP reader thread: {}", e))?;

        let (init_tx, init_rx) = tokio::sync::oneshot::channel::<Message>();
        let mut init_params = serde_json::json!({
            "processId": std::process::id(), "rootUri": root_uri, "rootPath": workspace_root_str,
            "workspaceFolders": [{ "uri": root_uri, "name": Path::new(&workspace_root_str).file_name().and_then(|n| n.to_str()).unwrap_or("workspace") }],
            "capabilities": build_client_capabilities(),
            "clientInfo": { "name": "neeko", "version": env!("CARGO_PKG_VERSION") }
        });
        if let Some(opts) = plugin.initialization_options.clone() {
            if let Some(obj) = init_params.as_object_mut() {
                obj.insert("initializationOptions".into(), opts);
            }
        }

        let init_req_id = RequestId::from(1i32);
        {
            let mut map = pending
                .lock()
                .map_err(|e| anyhow::anyhow!("LSP init pending lock poisoned: {}", e))?;
            map.insert(init_req_id.clone(), init_tx);
        }

        let init_req = Request::new(init_req_id.clone(), "initialize".to_string(), init_params);
        writer_tx
            .send(Message::Request(init_req))
            .context("Failed to send initialize request")?;

        let init_response = init_rx
            .blocking_recv()
            .context("LSP initialization: no response received")?;
        let server_capabilities = parse_initialize_response(init_response)?;

        log::info!("[LSP] {} initialized, capabilities received", server_name);
        transport.push_session_event(project_path, &language_id, "initializing", None, None);
        transport.push_session_event(project_path, &language_id, "ready", None, None);

        let notif = Notification::new("initialized".to_string(), serde_json::json!({}));
        writer_tx
            .send(Message::Notification(notif))
            .context("Failed to send initialized notification")?;
        {
            let mut map = pending
                .lock()
                .map_err(|e| anyhow::anyhow!("LSP init pending lock poisoned: {}", e))?;
            map.remove(&init_req_id);
        }

        server_info.memory_mb = 0.0;

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
            process_pid,
            server_info,
            log_buffer,
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
    #[allow(dead_code)]
    pub(crate) async fn send_request_async(&self, method: &str, params: Value) -> Result<Value> {
        super::request::do_send_request(
            Arc::clone(&self.pending),
            self.writer.clone(),
            Arc::clone(&self.inflight),
            method,
            params,
            false,
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

    /// Send a graceful shutdown request and wait for the response.
    pub(crate) fn send_shutdown_request(&self) -> Result<Message> {
        let (tx, rx) = tokio::sync::oneshot::channel::<Message>();
        let req_id = RequestId::from(1000i32);
        {
            let mut map = self
                .pending
                .lock()
                .map_err(|e| anyhow::anyhow!("LSP pending lock poisoned: {}", e))?;
            map.insert(req_id.clone(), tx);
        }
        let req = Request::new(
            req_id.clone(),
            "shutdown".to_string(),
            serde_json::json!({}),
        );
        self.writer
            .send(Message::Request(req))
            .context("Failed to send shutdown request")?;
        let response = rx
            .blocking_recv()
            .context("LSP shutdown: no response received")?;
        {
            let mut map = self
                .pending
                .lock()
                .map_err(|e| anyhow::anyhow!("LSP pending lock poisoned: {}", e))?;
            map.remove(&req_id);
        }
        Ok(response)
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

    /// Snapshot server metadata; refreshes RSS when a process pid is known.
    pub(crate) fn snapshot_server_info(&self) -> LspServerInfo {
        let mut info = self.server_info.clone();
        info.memory_mb = self
            .process_pid
            .and_then(sample_process_memory_mb)
            .unwrap_or(0.0);
        info
    }

    /// Return the most recent stderr log lines (newest last), capped by `limit`.
    #[allow(dead_code)]
    pub(crate) fn snapshot_logs(&self, limit: usize) -> Vec<LspServerLogEntry> {
        let Ok(buf) = self.log_buffer.lock() else {
            return Vec::new();
        };
        buf.snapshot(limit)
    }

    /// Create a session info snapshot for the status bar.
    pub(crate) fn snapshot(&self) -> crate::lsp::types::LspSessionInfo {
        use crate::lsp::types::LspSessionInfo;
        LspSessionInfo {
            language_id: self.language_id.clone(),
            project_path: self.project_path.clone(),
            server_name: self.server_name.clone(),
            status: self.status.as_str().to_string(),
            status_message: match &self.status {
                LspSessionStatus::Error(msg) => Some(msg.clone()),
                _ => None,
            },
            progress_pct: None,
        }
    }
}

/// Client capabilities advertised to the language server during `initialize`.
///
/// `completionItem.snippetSupport: true` lets servers return snippet-format
/// `insertText` (e.g. `foo(${1:param1}, ${2:param2})`) so accepting a function
/// completion auto-fills its parameters with tab-stop placeholders
/// (IDEA-style), instead of inserting only the bare function name.
///
/// `completionItem.documentation: true` asks servers to include per-item
/// documentation in completion responses — the info panel's docs section
/// ("function documentation hints") depends on it.
pub(crate) fn build_client_capabilities() -> Value {
    serde_json::json!({
        "textDocument": {
            "hover": { "contentFormat": ["markdown", "plaintext"] },
            "definition": { "linkSupport": true },
            "references": {},
            "completion": { "completionItem": { "snippetSupport": true, "documentation": true, "documentationFormat": ["markdown", "plaintext"] } },
            "publishDiagnostics": { "relatedInformation": true }
        },
        "workspace": { "workspaceFolders": true, "configuration": true, "didChangeConfiguration": { "dynamicRegistration": false } },
        "window": { "workDoneProgress": true }
    })
}

/// Extract server capabilities from an `initialize` response.
///
/// When the server answered with an error (e.g. typescript-language-server
/// failing to locate a TypeScript installation), the server's own message is
/// surfaced instead of a bare "has no result", so the real cause is visible.
pub(crate) fn parse_initialize_response(msg: Message) -> Result<Value> {
    match msg {
        Message::Response(resp) => {
            if let Some(err) = resp.error {
                anyhow::bail!(
                    "LSP initialize failed: [{code}] {message}",
                    code = err.code,
                    message = err.message
                );
            }
            resp.result
                .ok_or_else(|| anyhow::anyhow!("LSP initialize response has no result"))
        }
        _ => anyhow::bail!("LSP initialization: unexpected message type"),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use lsp_server::{RequestId, Response, ResponseError};
    use serde_json::json;

    fn err_response(message: &str) -> Message {
        Message::Response(Response {
            id: RequestId::from(1),
            result: None,
            error: Some(ResponseError {
                code: -32603,
                message: message.to_string(),
                data: None,
            }),
        })
    }

    #[test]
    fn surfaces_server_error_message() {
        let err = parse_initialize_response(err_response(
            "Could not find a valid TypeScript installation",
        ))
        .unwrap_err();
        assert!(
            err.to_string()
                .contains("Could not find a valid TypeScript installation"),
            "server error message must be surfaced, got: {err}"
        );
    }

    #[test]
    fn ok_response_returns_capabilities() {
        let msg = Message::Response(Response::new_ok(
            RequestId::from(1),
            json!({"capabilities": {}}),
        ));
        let caps = parse_initialize_response(msg).unwrap();
        assert_eq!(caps["capabilities"], json!({}));
    }

    #[test]
    fn empty_response_reports_no_result() {
        let msg = Message::Response(Response {
            id: RequestId::from(1),
            result: None,
            error: None,
        });
        let err = parse_initialize_response(msg).unwrap_err();
        assert!(err.to_string().contains("no result"), "got: {err}");
    }

    #[test]
    fn non_response_message_is_rejected() {
        let msg = Message::Notification(lsp_server::Notification::new(
            "initialized".to_string(),
            json!({}),
        ));
        let err = parse_initialize_response(msg).unwrap_err();
        assert!(
            err.to_string().contains("unexpected message type"),
            "got: {err}"
        );
    }

    #[test]
    fn client_capabilities_advertise_snippet_support() {
        let caps = build_client_capabilities();
        assert_eq!(
            caps["textDocument"]["completion"]["completionItem"]["snippetSupport"],
            json!(true),
            "snippetSupport must be advertised so servers return snippet insertText \
             (function completions auto-fill parameters, IDEA-style)"
        );
        // Hover / documentation formats must be preserved.
        assert_eq!(
            caps["textDocument"]["hover"]["contentFormat"],
            json!(["markdown", "plaintext"])
        );
        assert_eq!(
            caps["textDocument"]["completion"]["completionItem"]["documentationFormat"],
            json!(["markdown", "plaintext"])
        );
        // Completion items must carry documentation so the info panel can show
        // function documentation hints (the master-detail right column).
        assert_eq!(
            caps["textDocument"]["completion"]["completionItem"]["documentation"],
            json!(true),
            "documentation must be advertised so servers include per-item docs"
        );
    }

    /// No-op transport for tests that do not touch IPC.
    struct NoopTransport;

    impl LspTransport for NoopTransport {
        fn push_diagnostics(&self, _: &str, _: &str, _: serde_json::Value) {}
    }

    /// Regression: `snapshot_server_info` must sample live RSS, not return the
    /// static spawn-time metadata (`memory_mb` was always 0.0 before the fix).
    #[test]
    fn snapshot_server_info_refreshes_live_memory() {
        let (writer_tx, _writer_rx) = crossbeam_channel::unbounded::<Message>();
        let session = LspSession {
            language_id: "rust".into(),
            project_path: "/test/project".into(),
            server_name: "rust-analyzer".into(),
            writer: writer_tx,
            pending: Arc::new(Mutex::new(HashMap::new())),
            inflight: Arc::new(Mutex::new(InflightRequestTracker::new())),
            reader: None,
            stderr_logger: None,
            restart_count: 0,
            server_capabilities: serde_json::json!({}),
            status: LspSessionStatus::Ready,
            child: None,
            // Our own test process is alive, so RSS sampling must succeed.
            process_pid: Some(std::process::id()),
            server_info: LspServerInfo::unknown(),
            log_buffer: Arc::new(Mutex::new(LogRingBuffer::new())),
            transport: Arc::new(NoopTransport),
        };

        let info = session.snapshot_server_info();
        // Windows stub returns None by design (v1 skips memory sampling there).
        #[cfg(not(target_os = "windows"))]
        assert!(
            info.memory_mb > 0.0,
            "expected live RSS sample, got {}",
            info.memory_mb
        );
    }
}
