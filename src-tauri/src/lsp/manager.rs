use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use anyhow::{bail, Context, Result};
use crossbeam_channel::{Receiver, Sender};
use lsp_server::{Message, Notification, Request, RequestId};
use serde_json::Value;

use crate::AppError;
use tauri::Emitter;

use super::types::{LspDiagnostic, LspPosition, LspRange, LspSessionInfo};

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

fn lsp_server_command(language_id: &str) -> Option<Vec<&'static str>> {
    match language_id {
        "rust" => Some(vec!["rust-analyzer"]),
        "python" => Some(vec!["pyright-langserver", "--stdio"]),
        "typescript" | "javascript" => Some(vec!["typescript-language-server", "--stdio"]),
        "go" => Some(vec!["gopls"]),
        "java" => Some(vec!["jdtls"]),
        _ => None,
    }
}

pub fn language_for_extension(extension: &str) -> Option<&'static str> {
    match extension {
        "rs" => Some("rust"),
        "py" => Some("python"),
        "ts" => Some("typescript"),
        "tsx" => Some("typescriptreact"),
        "js" => Some("javascript"),
        "jsx" => Some("javascriptreact"),
        "go" => Some("go"),
        "java" => Some("java"),
        "rb" => Some("ruby"),
        "php" => Some("php"),
        "c" => Some("c"),
        "h" => Some("c"),
        "cpp" | "hpp" | "cc" | "cxx" => Some("cpp"),
        "cs" => Some("csharp"),
        "swift" => Some("swift"),
        "kt" | "kts" => Some("kotlin"),
        "lua" => Some("lua"),
        "ex" | "exs" => Some("elixir"),
        "r" => Some("r"),
        "sql" => Some("sql"),
        _ => None,
    }
}

struct LspSession {
    language_id: String,
    project_path: String,
    server_name: String,
    writer: crossbeam_channel::Sender<Message>,
    pending: Arc<Mutex<HashMap<RequestId, crossbeam_channel::Sender<Message>>>>,
    reader: Option<thread::JoinHandle<Result<()>>>,
    stderr_logger: Option<thread::JoinHandle<()>>,
    restart_count: u32,
}

impl LspSession {
    fn new(language_id: &str, project_path: &str, app_handle: tauri::AppHandle) -> Result<Self> {
        let cmd = lsp_server_command(language_id).ok_or_else(|| {
            anyhow::anyhow!("No LSP server configured for language: {}", language_id)
        })?;

        let server_name = cmd[0].to_string();

        if !crate::lsp::installer::check_server_installed(language_id) {
            log::info!(
                "[LSP] {} not found, attempting auto-install for: {}",
                server_name,
                language_id
            );
            match crate::lsp::installer::install_server(language_id, &app_handle) {
                Ok(true) => {
                    log::info!("[LSP] Auto-install succeeded for {}", language_id);
                    if !crate::lsp::installer::check_server_installed(language_id) {
                        anyhow::bail!(
                            "{} was installed but still not found on PATH. Try restarting Neeko.",
                            server_name
                        );
                    }
                }
                Ok(false) => {
                    log::info!(
                        "[LSP] No auto-install method for {}, skipping",
                        language_id
                    );
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

        let mut child = Command::new(cmd[0])
            .args(&cmd[1..])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .with_context(|| format!("Failed to spawn LSP server: {}", server_name))?;

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

        // Writer thread: reads from channel, writes to child stdin
        let mut child_stdin = child_stdin;
        let _writer_handle = thread::Builder::new()
            .name(format!("lsp-writer-{}", &server_name[..4]))
            .spawn(move || -> Result<()> {
                for msg in writer_rx {
                    msg.write(&mut child_stdin)
                        .context("LSP writer: failed to write message")?;
                }
                Ok(())
            })
            .unwrap();

        // Stderr logger thread
        let stderr_name = server_name.clone();
        let stderr_handle = thread::Builder::new()
            .name(format!("lsp-stderr-{}", &server_name[..4]))
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

        // Pending responses map
        // Build root URI before spawning reader (moved vars)
        let root_uri = url::Url::from_directory_path(project_path)
            .map_err(|_| anyhow::anyhow!("Invalid project path: {}", project_path))?
            .to_string();

        let pending: Arc<Mutex<HashMap<RequestId, crossbeam_channel::Sender<Message>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // Reader thread: reads from child stdout, dispatches to pending map or handles notifications
        let reader_stream = BufReader::new(child_stdout);
        let pending_clone = Arc::clone(&pending);
        let pp_reader = project_path.to_string();
        let ah = app_handle.clone();

        let reader_handle = thread::Builder::new()
            .name(format!("lsp-reader-{}", &server_name[..4]))
            .spawn(move || -> Result<()> {
                let mut reader_stream = reader_stream;
                while let Some(msg) =
                    Message::read(&mut reader_stream).context("LSP reader: read error")?
                {
                    match &msg {
                        Message::Response(resp) => {
                            let mut map = pending_clone.lock().expect("infallible");
                            if let Some(tx) = map.remove(&resp.id) {
                                let _ = tx.send(msg);
                                continue;
                            }
                            log::debug!("[LSP] Dropping unmatched response id={:?}", resp.id);
                        }
                        Message::Notification(notif) => {
                            if notif.method == "textDocument/publishDiagnostics" {
                                if let Some(params) = notif.params.as_object() {
                                    let uri = params.get("uri").and_then(|v| v.as_str()).unwrap_or("");
                                    let diagnostics = params
                                        .get("diagnostics")
                                        .and_then(|v| v.as_array())
                                        .map(|arr| {
                                            arr.iter()
                                                .filter_map(|d| {
                                                    Some(LspDiagnostic {
                                                        range: LspRange {
                                                            start: LspPosition {
                                                                line: d
                                                                    .pointer("/range/start/line")?
                                                                    .as_u64()?
                                                                    .try_into()
                                                                    .ok()?,
                                                                character: d
                                                                    .pointer("/range/start/character")?
                                                                    .as_u64()?
                                                                    .try_into()
                                                                    .ok()?,
                                                            },
                                                            end: LspPosition {
                                                                line: d
                                                                    .pointer("/range/end/line")?
                                                                    .as_u64()?
                                                                    .try_into()
                                                                    .ok()?,
                                                                character: d
                                                                    .pointer("/range/end/character")?
                                                                    .as_u64()?
                                                                    .try_into()
                                                                    .ok()?,
                                                            },
                                                        },
                                                        severity: d
                                                            .get("severity")
                                                            .and_then(|v| v.as_i64()),
                                                        message: d
                                                            .get("message")
                                                            .and_then(|v| v.as_str())
                                                            .unwrap_or("")
                                                            .to_string(),
                                                        source: d
                                                            .get("source")
                                                            .and_then(|v| v.as_str())
                                                            .map(|s| s.to_string()),
                                                    })
                                                })
                                                .collect::<Vec<_>>()
                                        })
                                        .unwrap_or_default();

                                    let payload = serde_json::json!({
                                        "uri": uri,
                                        "diagnostics": diagnostics,
                                    });

                                    if let Err(e) =
                                        ah.emit(&format!("lsp-diagnostics-{}", &pp_reader), payload)
                                    {
                                        log::error!("[LSP] Failed to emit diagnostics event: {}", e);
                                    }
                                }
                            }
                        }
                        Message::Request(req) => {
                            log::debug!("[LSP] Ignored server request: {}", req.method);
                        }
                    }
                }
                Ok(())
            })
            .unwrap();

        // Initialize (synchronous handshake, done before returning)
        let (init_tx, init_rx) = crossbeam_channel::bounded::<Message>(1);

        let init_params = serde_json::json!({
            "processId": std::process::id(),
            "rootUri": root_uri,
            "capabilities": {},
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
            .recv()
            .context("LSP initialization: no response received")?;

        let _capabilities = match init_response {
            Message::Response(ref resp) => resp
                .result
                .clone()
                .ok_or_else(|| anyhow::anyhow!("LSP initialize response has no result")),
            _ => bail!("LSP initialization: unexpected message type"),
        }?;

        log::info!("[LSP] {} initialized, capabilities received", server_name);

        let notif = Notification::new("initialized".to_string(), serde_json::json!({}));
        writer_tx
            .send(Message::Notification(notif))
            .context("Failed to send initialized notification")?;

        // Clean up init from pending map (response already consumed via init_rx)
        {
            let mut map = pending.lock().expect("infallible");
            map.remove(&init_req_id);
        }

        Ok(Self {
            language_id: language_id.to_string(),
            project_path: project_path.to_string(),
            server_name,
            writer: writer_tx,
            pending,
            reader: Some(reader_handle),
            stderr_logger: stderr_handle,
            restart_count: 0,
        })
    }

    /// Returns true if the reader thread is still alive.
    fn is_alive(&self) -> bool {
        self.reader
            .as_ref()
            .map(|h| !h.is_finished())
            .unwrap_or(false)
    }

    fn send_request_raw(&self, method: &str, params: Value) -> Result<Value> {
        let req_id = NEXT_REQ_ID.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = crossbeam_channel::bounded::<Message>(1);
        let request_id = RequestId::from(req_id);

        {
            let mut map = self.pending.lock().expect("infallible");
            map.insert(request_id.clone(), tx);
        }

        let req = Request::new(request_id, method.to_string(), params);
        self.writer
            .send(Message::Request(req))
            .with_context(|| format!("Failed to send LSP request: {}", method))?;

        let response = rx.recv().with_context(|| {
            format!("No response received for LSP request: {}", method)
        })?;

        match response {
            Message::Response(resp) => {
                if let Some(err) = resp.error {
                    bail!("LSP error ({}): {}", err.code, err.message);
                }
                resp.result.ok_or_else(|| {
                    anyhow::anyhow!("LSP response has no result for: {}", method)
                })
            }
            _ => bail!("Unexpected message type for request: {}", method),
        }
    }

    fn send_notification_raw(&self, method: &str, params: Value) -> Result<()> {
        let notif = Notification::new(method.to_string(), params);
        self.writer
            .send(Message::Notification(notif))
            .with_context(|| format!("Failed to send LSP notification: {}", method))
    }
}

/// Manages LSP server sessions.
pub struct LspManager {
    sessions: Arc<Mutex<HashMap<SessionKey, LspSession>>>,
    open_docs: Arc<Mutex<HashMap<SessionKey, Vec<OpenDocument>>>>,
    app_handle: Mutex<Option<tauri::AppHandle>>,
}

impl LspManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            open_docs: Arc::new(Mutex::new(HashMap::new())),
            app_handle: Mutex::new(None),
        }
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

        let app_handle = self
            .app_handle
            .lock()
            .expect("infallible: lsp app_handle lock")
            .clone()
            .ok_or_else(|| AppError::Lsp("AppHandle not set".to_string()))?;

        let session = LspSession::new(language_id, project_path, app_handle)
            .map_err(|e| AppError::Lsp(e.to_string()))?;

        // Re-open any previously open documents for this session (covers restart)
        let open_count = self.reopen_documents(&key, &session);
        log::info!(
            "[LSP] Session {} created (re-opened {} document(s))",
            key,
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

    pub fn send_request(
        &self,
        project_path: &str,
        language_id: &str,
        method: &str,
        params: Value,
    ) -> Result<Value, AppError> {
        let key = session_key(project_path, language_id);

        // Fast path: try existing session
        {
            let sessions = self.sessions.lock().expect("infallible");
            if let Some(session) = sessions.get(&key) {
                if session.is_alive() {
                    match session.send_request_raw(method, params.clone()) {
                        Ok(val) => return Ok(val),
                        Err(e) => {
                            log::warn!(
                                "[LSP] send_request_raw failed for {}, reason: {}. Will restart.",
                                key,
                                e
                            );
                        }
                    }
                } else {
                    log::warn!("[LSP] Session {} is not alive, will restart", key);
                }
            }
        }

        // Restart: remove dead session, create fresh one, retry once
        {
            let mut sessions = self.sessions.lock().expect("infallible");
            sessions.remove(&key);
        }

        self.get_or_create_session(project_path, language_id)?;

        let sessions = self.sessions.lock().expect("infallible");
        match sessions.get(&key) {
            Some(session) => session
                .send_request_raw(method, params)
                .map_err(|e| AppError::Lsp(e.to_string())),
            None => Err(AppError::Lsp(format!(
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

        sessions.remove(&key);
        log::info!("[LSP] Closed session: {}", key);
        Ok(())
    }

    pub fn close_all_sessions(&self) {
        let mut sessions = self.sessions.lock().expect("infallible: lsp sessions lock");
        sessions.clear();
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
                connected: s.is_alive(),
            })
            .collect()
    }

    pub fn language_for_path(path: &str) -> Option<&'static str> {
        let ext = std::path::Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        language_for_extension(ext)
    }
}

impl Default for LspManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_language_for_extension() {
        assert_eq!(language_for_extension("rs"), Some("rust"));
        assert_eq!(language_for_extension("py"), Some("python"));
        assert_eq!(language_for_extension("ts"), Some("typescript"));
        assert_eq!(language_for_extension("tsx"), Some("typescriptreact"));
        assert_eq!(language_for_extension("js"), Some("javascript"));
        assert_eq!(language_for_extension("go"), Some("go"));
        assert_eq!(language_for_extension("java"), Some("java"));

        assert_eq!(language_for_extension("unknown_ext_xyz"), None);
        assert_eq!(language_for_extension(""), None);
    }

    #[test]
    fn test_lsp_server_command() {
        let rust_cmd = lsp_server_command("rust");
        assert!(rust_cmd.is_some());
        assert_eq!(rust_cmd.unwrap()[0], "rust-analyzer");

        let unknown_cmd = lsp_server_command("unknown_lang");
        assert!(unknown_cmd.is_none());
    }

    #[test]
    fn test_session_key() {
        let key = session_key("/home/user/project", "rust");
        assert_eq!(key, "/home/user/project:rust");
    }

    #[test]
    fn test_language_for_path() {
        assert_eq!(
            LspManager::language_for_path("/some/path/main.rs"),
            Some("rust")
        );
        assert_eq!(
            LspManager::language_for_path("/some/path/app.py"),
            Some("python")
        );
        assert_eq!(LspManager::language_for_path("/some/path/no_ext"), None);
    }
}
