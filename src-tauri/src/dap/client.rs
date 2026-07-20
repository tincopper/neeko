//! DAP client: request/response pairing over a framed byte stream.
//!
//! No Tauri / project knowledge — pure protocol session state.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot, Mutex};

use super::protocol::{encode_message, try_decode};
use crate::common::executor::{BoxAsyncRead, BoxAsyncWrite};
use crate::AppError;

/// Callbacks for DAP events (implemented by session).
pub trait DapEventHandler: Send + Sync + 'static {
    fn on_initialized(&self);
    fn on_stopped(&self, body: Value);
    fn on_continued(&self, body: Value);
    fn on_terminated(&self, body: Value);
    fn on_output(&self, body: Value);
    fn on_other_event(&self, event: &str, body: Value);
}

/// Low-level DAP client bound to adapter I/O.
pub struct DapClient {
    seq: AtomicI64,
    pending: Mutex<HashMap<i64, oneshot::Sender<Value>>>,
    write_tx: mpsc::UnboundedSender<Vec<u8>>,
    got_initialized: AtomicBool,
    initialized_tx: Mutex<Option<oneshot::Sender<()>>>,
    /// Recent DAP `output` event texts (build errors before failed responses).
    recent_output: Mutex<Vec<String>>,
}

impl DapClient {
    /// Start writer + reader loops. `handler` receives events for the session life.
    pub fn start(
        reader: BoxAsyncRead,
        writer: BoxAsyncWrite,
        handler: Arc<dyn DapEventHandler>,
    ) -> Arc<Self> {
        let (write_tx, mut write_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let client = Arc::new(Self {
            seq: AtomicI64::new(1),
            pending: Mutex::new(HashMap::new()),
            write_tx,
            got_initialized: AtomicBool::new(false),
            initialized_tx: Mutex::new(None),
            recent_output: Mutex::new(Vec::new()),
        });

        let mut writer = writer;
        tokio::spawn(async move {
            while let Some(chunk) = write_rx.recv().await {
                if writer.write_all(&chunk).await.is_err() {
                    break;
                }
                let _ = writer.flush().await;
            }
        });

        let client_r = Arc::clone(&client);
        let mut reader = reader;
        tokio::spawn(async move {
            let mut buf = Vec::new();
            let mut tmp = vec![0u8; 16 * 1024];
            loop {
                match reader.read(&mut tmp).await {
                    Ok(0) => break,
                    Ok(n) => {
                        buf.extend_from_slice(&tmp[..n]);
                        while let Some(msg) = try_decode(&mut buf) {
                            client_r.dispatch(msg, &handler).await;
                        }
                    }
                    Err(_) => break,
                }
            }
            handler.on_terminated(json!({ "reason": "connectionClosed" }));
        });

        client
    }

    fn next_seq(&self) -> i64 {
        self.seq.fetch_add(1, Ordering::SeqCst)
    }

    async fn dispatch(&self, msg: Value, handler: &Arc<dyn DapEventHandler>) {
        let msg_type = msg.get("type").and_then(|t| t.as_str()).unwrap_or("");
        match msg_type {
            "response" => {
                let req_seq = msg.get("request_seq").and_then(|s| s.as_i64()).unwrap_or(-1);
                let mut pending = self.pending.lock().await;
                if let Some(tx) = pending.remove(&req_seq) {
                    let _ = tx.send(msg);
                }
            }
            "event" => {
                let event = msg.get("event").and_then(|e| e.as_str()).unwrap_or("");
                let body = msg.get("body").cloned().unwrap_or(json!({}));
                match event {
                    "initialized" => {
                        log::info!("[DAP] initialized event");
                        self.got_initialized.store(true, Ordering::SeqCst);
                        if let Some(tx) = self.initialized_tx.lock().await.take() {
                            let _ = tx.send(());
                        }
                        handler.on_initialized();
                    }
                    "stopped" => handler.on_stopped(body),
                    "continued" => handler.on_continued(body),
                    "terminated" | "exited" => handler.on_terminated(body),
                    "output" => {
                        if let Some(text) = body.get("output").and_then(|o| o.as_str()) {
                            let trimmed = text.trim();
                            if !trimmed.is_empty() {
                                let mut out = self.recent_output.lock().await;
                                out.push(trimmed.to_string());
                                if out.len() > 40 {
                                    let drain = out.len() - 20;
                                    out.drain(..drain);
                                }
                            }
                        }
                        handler.on_output(body);
                    }
                    other => handler.on_other_event(other, body),
                }
            }
            "request" => {
                if let Some(seq) = msg.get("seq").and_then(|s| s.as_i64()) {
                    let command = msg.get("command").and_then(|c| c.as_str()).unwrap_or("");
                    log::info!("[DAP] reverse request ignored: {command}");
                    let resp = json!({
                        "seq": self.next_seq(),
                        "type": "response",
                        "request_seq": seq,
                        "success": false,
                        "command": command,
                        "message": "not supported",
                    });
                    let _ = self.write_tx.send(encode_message(&resp));
                }
            }
            _ => {}
        }
    }

    pub async fn request(&self, command: &str, arguments: Value) -> Result<Value, AppError> {
        self.request_timeout(command, arguments, Duration::from_secs(30))
            .await
    }

    pub async fn request_timeout(
        &self,
        command: &str,
        arguments: Value,
        timeout: Duration,
    ) -> Result<Value, AppError> {
        let seq = self.next_seq();
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            pending.insert(seq, tx);
        }
        let msg = json!({
            "seq": seq,
            "type": "request",
            "command": command,
            "arguments": arguments,
        });
        self.write_tx
            .send(encode_message(&msg))
            .map_err(|_| AppError::Dap("adapter connection closed".into()))?;

        let resp = tokio::time::timeout(timeout, rx)
            .await
            .map_err(|_| AppError::Dap(format!("timeout waiting for {command}")))?
            .map_err(|_| AppError::Dap(format!("canceled waiting for {command}")))?;

        let success = resp.get("success").and_then(|s| s.as_bool()).unwrap_or(false);
        if !success {
            let message = resp
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("request failed");
            let detail = resp
                .pointer("/body/error/format")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let outputs = {
                let out = self.recent_output.lock().await;
                out.join("\n")
            };
            let mut err = if detail.is_empty() {
                format!("{command}: {message}")
            } else if detail.contains(message) {
                format!("{command}: {detail}")
            } else {
                format!("{command}: {message} — {detail}")
            };
            if !outputs.is_empty() {
                err.push('\n');
                err.push_str(&outputs);
            }
            if outputs.contains("no Go files") || detail.contains("no Go files") {
                err.push_str(
                    "\nHint: set launch.json \"program\" to a package with main \
                     (e.g. ${workspaceFolder}/cmd/<app>), not the module root.",
                );
            }
            return Err(AppError::Dap(err));
        }
        Ok(resp.get("body").cloned().unwrap_or(json!({})))
    }

    pub async fn wait_for_initialized(&self, timeout: Duration) -> Result<(), AppError> {
        if self.got_initialized.load(Ordering::SeqCst) {
            return Ok(());
        }
        let (tx, rx) = oneshot::channel();
        {
            let mut slot = self.initialized_tx.lock().await;
            if self.got_initialized.load(Ordering::SeqCst) {
                return Ok(());
            }
            *slot = Some(tx);
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(_)) => {
                if self.got_initialized.load(Ordering::SeqCst) {
                    Ok(())
                } else {
                    Err(AppError::Dap("initialized wait canceled".into()))
                }
            }
            Err(_) => {
                if self.got_initialized.load(Ordering::SeqCst) {
                    Ok(())
                } else {
                    Err(AppError::Dap(
                        "Timed out waiting for DAP 'initialized' event \
                         (adapter did not finish launch setup)"
                            .into(),
                    ))
                }
            }
        }
    }
}
