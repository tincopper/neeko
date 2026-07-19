//! One DAP debug session: adapter process + request/response + events.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot, Mutex};

use super::plugin::{self, AdapterSpawn, AdapterTransport};
use super::protocol::{encode_message, try_decode};
use super::types::{
    BreakpointSpec, DapEventPayload, DapSessionInfo, LaunchConfig, StackFrameDto, VariableDto,
};
use crate::common::executor::factory::{create_executor, ExecTarget};
use crate::common::executor::{BoxAsyncRead, BoxAsyncWrite, SpawnOptions};
use crate::AppError;

static NEXT_SESSION: AtomicI64 = AtomicI64::new(1);

pub struct DapSession {
    pub session_id: String,
    pub project_id: String,
    pub project_path: String,
    pub config_name: String,
    status: Mutex<String>,
    status_message: Mutex<Option<String>>,
    /// Last stopped thread id (from DAP `stopped` event).
    last_thread_id: Mutex<i64>,
    /// Recent DAP `output` event texts (for surfacing build errors on failed requests).
    recent_output: Mutex<Vec<String>>,
    seq: AtomicI64,
    pending: Mutex<HashMap<i64, oneshot::Sender<Value>>>,
    /// Set when DAP `initialized` event arrives (Delve sends this after `launch`).
    got_initialized: AtomicBool,
    /// One-shot waiter for the first `initialized` event.
    initialized_tx: Mutex<Option<oneshot::Sender<()>>>,
    /// Waiters notified on each `stopped` event (entry / breakpoint).
    stopped_waiters: Mutex<Vec<oneshot::Sender<()>>>,
    /// Emit `terminated` only once (event + TCP EOF both fire).
    terminated_emitted: AtomicBool,
    write_tx: mpsc::UnboundedSender<Vec<u8>>,
    kill: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    app: AppHandle,
}

impl DapSession {
    pub async fn start(
        app: AppHandle,
        project_id: String,
        project_path: String,
        target: ExecTarget,
        config: LaunchConfig,
        breakpoints: Vec<BreakpointSpec>,
    ) -> Result<Arc<Self>, AppError> {
        let adapter = plugin::resolve_adapter(&config.type_).map_err(AppError::Dap)?;
        if !plugin::adapter_available(&config.type_, &target) {
            let hint = match config.type_.as_str() {
                "go" | "delve" => {
                    "Install Delve: go install github.com/go-delve/delve/cmd/dlv@latest"
                }
                "lldb" | "rust" | "codelldb" => {
                    "Install lldb-dap (LLVM) or codelldb and ensure it is on PATH"
                }
                _ => "Install the debug adapter and ensure it is on PATH",
            };
            return Err(AppError::Dap(format!(
                "Debug adapter for type '{}' not found (looked for '{}'). {hint}",
                config.type_, adapter.program
            )));
        }

        // Optional pre-launch shell command (e.g. cargo build) in project environment.
        if let Some(ref pre) = config.pre_launch_task {
            let pre = pre.trim();
            if !pre.is_empty() {
                log::info!("[DAP] preLaunchTask: {pre}");
                let output = crate::common::executor::sync::collect_output(
                    &target,
                    "bash",
                    &["-lc", pre],
                )
                .await
                .map_err(|e| AppError::Dap(format!("preLaunchTask failed to start: {e}")))?;
                if output.exit_code != 0 {
                    let err = String::from_utf8_lossy(&output.stderr);
                    let out = String::from_utf8_lossy(&output.stdout);
                    let detail = if !err.trim().is_empty() {
                        err.trim().to_string()
                    } else {
                        out.trim().to_string()
                    };
                    return Err(AppError::Dap(format!(
                        "preLaunchTask exited {}: {detail}",
                        output.exit_code
                    )));
                }
            }
        }

        let spawn = if matches!(config.type_.as_str(), "lldb" | "rust" | "codelldb") {
            if crate::core::exec::command_exists_blocking(&target, "lldb-dap") {
                AdapterSpawn {
                    program: "lldb-dap".into(),
                    args: vec![],
                    transport: AdapterTransport::Stdio,
                }
            } else {
                AdapterSpawn {
                    program: "codelldb".into(),
                    args: vec![],
                    transport: AdapterTransport::Stdio,
                }
            }
        } else {
            adapter
        };

        let args_refs: Vec<&str> = spawn.args.iter().map(|s| s.as_str()).collect();
        let mut child = create_executor(&target)
            .spawn_with(SpawnOptions {
                cmd: &spawn.program,
                args: &args_refs,
                current_dir: Some(&project_path),
            })
            .await
            .map_err(|e| AppError::Dap(format!("Failed to spawn {}: {e}", spawn.program)))?;

        let (async_stdin, async_stdout, async_stderr) = child.take_stdio();
        let async_stdin = async_stdin
            .ok_or_else(|| AppError::Dap("adapter has no stdin".into()))?;
        let async_stdout = async_stdout
            .ok_or_else(|| AppError::Dap("adapter has no stdout".into()))?;
        let async_stderr = async_stderr
            .ok_or_else(|| AppError::Dap("adapter has no stderr".into()))?;
        let (wait_fut, kill_fn) = child.into_wait_and_kill();

        let (write_tx, mut write_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (kill_tx, kill_rx) = oneshot::channel::<()>();
        // category + line — Delve TCP mode prints debuggee output on process pipes.
        let (proc_out_tx, mut proc_out_rx) = mpsc::unbounded_channel::<(String, String)>();
        let stderr_buf = Arc::new(Mutex::new(String::new()));

        let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();
        tokio::spawn(async move {
            tokio::select! {
                _ = kill_rx => { let _ = kill_fn().await; }
                _ = wait_fut => {}
            }
            let _ = done_tx.send(());
        });

        let (dap_reader, dap_writer): (BoxAsyncRead, BoxAsyncWrite) = match spawn.transport {
            AdapterTransport::Stdio => {
                let err_tx = proc_out_tx;
                let stderr_buf_w = Arc::clone(&stderr_buf);
                tokio::spawn(async move {
                    forward_process_lines(async_stderr, "stderr", err_tx, Some(stderr_buf_w)).await;
                });
                // DAP framing rides on stdin/stdout for lldb-dap.
                (async_stdout, async_stdin)
            }
            AdapterTransport::TcpListen => {
                drop(async_stdin);
                let out_tx = proc_out_tx.clone();
                let err_tx = proc_out_tx;
                let stderr_buf_w = Arc::clone(&stderr_buf);
                let (addr_tx, addr_rx) = oneshot::channel::<Result<String, String>>();
                tokio::spawn(async move {
                    let mut lines = BufReader::new(async_stdout).lines();
                    let mut addr_tx = Some(addr_tx);
                    loop {
                        match lines.next_line().await {
                            Ok(Some(line)) => {
                                if addr_tx.is_some() {
                                    if let Some(addr) = plugin::parse_listen_addr_line(&line) {
                                        if let Some(tx) = addr_tx.take() {
                                            let _ = tx.send(Ok(addr));
                                        }
                                        continue;
                                    }
                                }
                                // Debuggee stdout (e.g. fmt.Println) after listen banner.
                                if !line.trim().is_empty() {
                                    let _ = out_tx.send(("stdout".into(), line));
                                }
                            }
                            Ok(None) => {
                                if let Some(tx) = addr_tx.take() {
                                    let _ = tx.send(Err(
                                        "Debug adapter exited before announcing a listen address"
                                            .into(),
                                    ));
                                }
                                break;
                            }
                            Err(e) => {
                                if let Some(tx) = addr_tx.take() {
                                    let _ = tx.send(Err(format!(
                                        "Failed reading adapter stdout: {e}"
                                    )));
                                }
                                break;
                            }
                        }
                    }
                });
                tokio::spawn(async move {
                    forward_process_lines(async_stderr, "stderr", err_tx, Some(stderr_buf_w)).await;
                });

                let addr = match tokio::time::timeout(Duration::from_secs(10), addr_rx).await {
                    Ok(Ok(Ok(a))) => a,
                    Ok(Ok(Err(e))) => {
                        let _ = kill_tx.send(());
                        let detail = stderr_buf.lock().await.clone();
                        let detail = detail.trim();
                        return Err(AppError::Dap(if detail.is_empty() {
                            e
                        } else {
                            format!("{e} ({detail})")
                        }));
                    }
                    Ok(Err(_)) | Err(_) => {
                        let _ = kill_tx.send(());
                        return Err(AppError::Dap(
                            "Timed out waiting for DAP server listen address \
                             (dlv did not print \"DAP server listening at: …\")"
                                .into(),
                        ));
                    }
                };
                log::info!("[DAP] connecting to adapter at {addr}");
                let stream = match TcpStream::connect(&addr).await {
                    Ok(s) => s,
                    Err(e) => {
                        let _ = kill_tx.send(());
                        return Err(AppError::Dap(format!(
                            "Failed to connect to DAP server at {addr}: {e}"
                        )));
                    }
                };
                let (read_half, write_half) = stream.into_split();
                (
                    Box::pin(read_half) as BoxAsyncRead,
                    Box::pin(write_half) as BoxAsyncWrite,
                )
            }
        };

        let mut dap_writer = dap_writer;
        tokio::spawn(async move {
            while let Some(chunk) = write_rx.recv().await {
                if dap_writer.write_all(&chunk).await.is_err() {
                    break;
                }
                let _ = dap_writer.flush().await;
            }
        });

        let session_id = format!("dap-{}", NEXT_SESSION.fetch_add(1, Ordering::SeqCst));
        let session = Arc::new(Self {
            session_id: session_id.clone(),
            project_id: project_id.clone(),
            project_path: project_path.clone(),
            config_name: config.name.clone(),
            status: Mutex::new("starting".into()),
            status_message: Mutex::new(None),
            last_thread_id: Mutex::new(1),
            recent_output: Mutex::new(Vec::new()),
            seq: AtomicI64::new(1),
            pending: Mutex::new(HashMap::new()),
            got_initialized: AtomicBool::new(false),
            initialized_tx: Mutex::new(None),
            stopped_waiters: Mutex::new(Vec::new()),
            terminated_emitted: AtomicBool::new(false),
            write_tx,
            kill: Mutex::new(Some(Box::new(move || {
                let _ = kill_tx.send(());
                let _ = done_rx.recv_timeout(std::time::Duration::from_secs(2));
            }))),
            app: app.clone(),
        });

        // Forward process pipe output into DAP-style output events for the UI console.
        let session_out = Arc::clone(&session);
        tokio::spawn(async move {
            while let Some((category, line)) = proc_out_rx.recv().await {
                // Skip noisy Delve internal logs on stderr; keep real program errors.
                if category == "stderr" && line.contains("layer=") {
                    log::debug!("[DAP adapter log] {line}");
                    continue;
                }
                let _ = session_out
                    .emit_event(
                        "output",
                        json!({
                            "category": category,
                            "output": format!("{line}\n"),
                        }),
                    )
                    .await;
            }
        });

        // Reader loop (stdio pipe or TCP connection).
        let session_r = Arc::clone(&session);
        let mut dap_reader = dap_reader;
        tokio::spawn(async move {
            let mut buf = Vec::new();
            let mut tmp = vec![0u8; 16 * 1024];
            loop {
                match dap_reader.read(&mut tmp).await {
                    Ok(0) => break,
                    Ok(n) => {
                        buf.extend_from_slice(&tmp[..n]);
                        while let Some(msg) = try_decode(&mut buf) {
                            session_r.handle_message(msg).await;
                        }
                    }
                    Err(_) => break,
                }
            }
            session_r
                .finish_terminated(Some("Adapter connection closed".into()), json!({}))
                .await;
        });

        // Initialize handshake (on any failure, tear down adapter process).
        let is_delve = matches!(config.type_.as_str(), "go" | "delve");
        let handshake = async {
            session
                .set_status("starting", Some("Initializing adapter".into()))
                .await;

            let init_args = json!({
                "clientID": "neeko",
                "clientName": "Neeko",
                "adapterID": plugin::adapter_id(&config.type_),
                "pathFormat": "path",
                "linesStartAt1": true,
                "columnsStartAt1": true,
                "supportsVariableType": true,
                "supportsVariablePaging": false,
                "locale": "en-us",
            });
            let init_resp = session
                .request("initialize", init_args)
                .await
                .map_err(|e| AppError::Dap(format!("initialize failed: {e}")))?;
            log::info!("[DAP] initialize ok: {}", init_resp);

            let launch_args = plugin::build_launch_args(&config, &project_path)
                .map_err(AppError::Dap)?;

            let stop_on_entry = config.stop_on_entry.unwrap_or(false);

            // Delve DAP order (unlike generic DAP):
            //   initialize → launch → (initialized event) → breakpoints → configurationDone
            // Generic / lldb-dap:
            //   initialize → (initialized) → breakpoints → configurationDone → launch
            if is_delve {
                session
                    .set_status("starting", Some("Building / launching…".into()))
                    .await;
                // Go build can take a while.
                session
                    .request_timeout("launch", launch_args, Duration::from_secs(180))
                    .await
                    .map_err(|e| AppError::Dap(format!("launch failed: {e}")))?;
                session
                    .wait_for_initialized(Duration::from_secs(30))
                    .await
                    .map_err(AppError::Dap)?;
                // Entry stop via main.main function BP (Delve stopOnEntry is unusable).
                session
                    .apply_breakpoints(
                        &breakpoints,
                        if stop_on_entry {
                            Some("main.main")
                        } else {
                            None
                        },
                    )
                    .await;
                let _ = session
                    .request("configurationDone", json!({}))
                    .await;
            } else {
                // Best-effort wait; some adapters send initialized right after initialize.
                let _ = session
                    .wait_for_initialized(Duration::from_secs(3))
                    .await;
                session.apply_breakpoints(&breakpoints, None).await;
                let _ = session
                    .request("configurationDone", json!({}))
                    .await;
                session
                    .request_timeout("launch", launch_args, Duration::from_secs(60))
                    .await
                    .map_err(|e| AppError::Dap(format!("launch failed: {e}")))?;
            }

            if stop_on_entry {
                session
                    .set_status("starting", Some("Waiting for entry stop…".into()))
                    .await;
                // Block until first stopped so FE gets a live "stopped" session.
                if session
                    .wait_for_stopped(Duration::from_secs(15))
                    .await
                    .is_err()
                {
                    log::warn!("[DAP] no stopped event after configurationDone");
                    session
                        .set_status("running", Some("Debug session running".into()))
                        .await;
                }
            } else {
                session
                    .set_status("running", Some("Debug session running".into()))
                    .await;
            }
            let status = session.status.lock().await.clone();
            session
                .emit_event(
                    "session",
                    json!({ "status": status, "configName": config.name }),
                )
                .await;
            Ok::<(), AppError>(())
        }
        .await;

        if let Err(e) = handshake {
            // Kill adapter immediately (skip disconnect — request may already be broken).
            if let Some(kill) = session.kill.lock().await.take() {
                kill();
            }
            let detail = stderr_buf.lock().await.clone();
            let detail = detail.trim().to_string();
            let base = match &e {
                AppError::Dap(msg) => msg.clone(),
                other => other.to_string(),
            };
            if detail.is_empty() {
                return Err(AppError::Dap(base));
            }
            return Err(AppError::Dap(format!("{base} | adapter stderr: {detail}")));
        }

        Ok(session)
    }

    fn next_seq(&self) -> i64 {
        self.seq.fetch_add(1, Ordering::SeqCst)
    }

    async fn handle_message(&self, msg: Value) {
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
                    }
                    "stopped" => {
                        if let Some(tid) = body.get("threadId").and_then(|t| t.as_i64()) {
                            *self.last_thread_id.lock().await = tid;
                        }
                        self.set_status("stopped", None).await;
                        self.emit_event("stopped", body).await;
                        let waiters = std::mem::take(&mut *self.stopped_waiters.lock().await);
                        for tx in waiters {
                            let _ = tx.send(());
                        }
                    }
                    "continued" => {
                        self.set_status("running", None).await;
                        self.emit_event("continued", body).await;
                    }
                    "terminated" | "exited" => {
                        self.finish_terminated(None, body).await;
                    }
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
                        self.emit_event("output", body).await;
                    }
                    other => {
                        log::debug!("[DAP] event {other}: {body}");
                    }
                }
            }
            "request" => {
                // Reverse requests (e.g. runInTerminal) — respond with unsupported for MVP
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

    pub async fn request(&self, command: &str, arguments: Value) -> Result<Value, String> {
        self.request_timeout(command, arguments, Duration::from_secs(30))
            .await
    }

    pub async fn request_timeout(
        &self,
        command: &str,
        arguments: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
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
            .map_err(|_| "adapter connection closed".to_string())?;

        let resp = tokio::time::timeout(timeout, rx)
            .await
            .map_err(|_| format!("timeout waiting for {command}"))?
            .map_err(|_| format!("canceled waiting for {command}"))?;

        let success = resp.get("success").and_then(|s| s.as_bool()).unwrap_or(false);
        if !success {
            let message = resp
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("request failed");
            // Delve puts the useful detail here (e.g. "Failed to launch: Build error: …")
            let detail = resp
                .pointer("/body/error/format")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            // Build errors are also sent as DAP `output` events right before the response.
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
                err.push_str("\n");
                err.push_str(&outputs);
            }
            // Hint for the common Go layout (main under cmd/…).
            if outputs.contains("no Go files") || detail.contains("no Go files") {
                err.push_str(
                    "\nHint: set launch.json \"program\" to a package with main \
                     (e.g. ${workspaceFolder}/cmd/<app>), not the module root.",
                );
            }
            return Err(err);
        }
        Ok(resp.get("body").cloned().unwrap_or(json!({})))
    }

    async fn wait_for_initialized(&self, timeout: Duration) -> Result<(), String> {
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
                    Err("initialized wait canceled".into())
                }
            }
            Err(_) => {
                if self.got_initialized.load(Ordering::SeqCst) {
                    Ok(())
                } else {
                    Err(
                        "Timed out waiting for DAP 'initialized' event \
                         (adapter did not finish launch setup)"
                            .into(),
                    )
                }
            }
        }
    }

    async fn apply_breakpoints(
        &self,
        breakpoints: &[BreakpointSpec],
        entry_function: Option<&str>,
    ) {
        for bp_file in group_breakpoints(breakpoints) {
            let source = json!({ "path": bp_file.0 });
            let lines: Vec<Value> = bp_file
                .1
                .iter()
                .map(|l| json!({ "line": l }))
                .collect();
            if let Err(e) = self
                .request(
                    "setBreakpoints",
                    json!({ "source": source, "breakpoints": lines }),
                )
                .await
            {
                log::warn!("[DAP] setBreakpoints failed for {}: {e}", bp_file.0);
            }
        }
        // Go entry pause: function BP (real goroutine) instead of Delve stopOnEntry.
        if let Some(func) = entry_function {
            if let Err(e) = self
                .request(
                    "setFunctionBreakpoints",
                    json!({ "breakpoints": [{ "name": func }] }),
                )
                .await
            {
                log::warn!("[DAP] setFunctionBreakpoints({func}) failed: {e}");
            } else {
                log::info!("[DAP] entry function breakpoint: {func}");
            }
        } else {
            let _ = self
                .request("setFunctionBreakpoints", json!({ "breakpoints": [] }))
                .await;
        }
        let _ = self
            .request("setExceptionBreakpoints", json!({ "filters": [] }))
            .await;
    }

    async fn wait_for_stopped(&self, timeout: Duration) -> Result<(), String> {
        // Already stopped?
        if self.status.lock().await.as_str() == "stopped" {
            return Ok(());
        }
        let (tx, rx) = oneshot::channel();
        self.stopped_waiters.lock().await.push(tx);
        // Re-check after registering (event may have landed between check and push).
        if self.status.lock().await.as_str() == "stopped" {
            return Ok(());
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(_)) => {
                if self.status.lock().await.as_str() == "stopped" {
                    Ok(())
                } else {
                    Err("stopped wait canceled".into())
                }
            }
            Err(_) => {
                if self.status.lock().await.as_str() == "stopped" {
                    Ok(())
                } else {
                    Err("Timed out waiting for stopped event".into())
                }
            }
        }
    }

    /// Resolve a usable thread/goroutine id (skip Delve's Dummy thread).
    async fn resolve_thread_id(&self) -> i64 {
        let last = *self.last_thread_id.lock().await;
        let Ok(body) = self.request("threads", json!({})).await else {
            return last;
        };
        let Some(arr) = body.get("threads").and_then(|t| t.as_array()) else {
            return last;
        };

        let pick = |t: &Value| -> Option<(i64, String)> {
            let id = t.get("id").and_then(|i| i.as_i64())?;
            let name = t
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_string();
            if name.eq_ignore_ascii_case("Dummy") {
                return None;
            }
            Some((id, name))
        };

        // Prefer last stopped id if still present and not Dummy.
        for t in arr {
            if let Some((id, _)) = pick(t) {
                if id == last {
                    return id;
                }
            }
        }
        // Prefer current thread (name starts with '*').
        for t in arr {
            if let Some((id, name)) = pick(t) {
                if name.starts_with('*') {
                    *self.last_thread_id.lock().await = id;
                    return id;
                }
            }
        }
        // First real thread.
        for t in arr {
            if let Some((id, _)) = pick(t) {
                *self.last_thread_id.lock().await = id;
                return id;
            }
        }
        last
    }

    async fn finish_terminated(&self, message: Option<String>, body: Value) {
        if self
            .terminated_emitted
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        self.set_status("terminated", message).await;
        self.emit_event("terminated", body).await;
    }

    pub async fn set_breakpoints_for_file(
        &self,
        file_path: &str,
        lines: &[u32],
    ) -> Result<Vec<BreakpointSpec>, AppError> {
        let bps: Vec<Value> = lines.iter().map(|l| json!({ "line": l })).collect();
        let body = self
            .request(
                "setBreakpoints",
                json!({
                    "source": { "path": file_path },
                    "breakpoints": bps,
                }),
            )
            .await
            .map_err(AppError::Dap)?;
        let mut out = Vec::new();
        if let Some(arr) = body.get("breakpoints").and_then(|b| b.as_array()) {
            for b in arr {
                let line = b.get("line").and_then(|l| l.as_u64()).unwrap_or(0) as u32;
                let verified = b.get("verified").and_then(|v| v.as_bool()).unwrap_or(false);
                out.push(BreakpointSpec {
                    file_path: file_path.to_string(),
                    line,
                    verified,
                });
            }
        }
        Ok(out)
    }

    pub async fn control(&self, action: &str) -> Result<(), AppError> {
        let thread_id = self.resolve_thread_id().await;
        let cmd = match action {
            "continue" => "continue",
            "next" => "next",
            "stepIn" | "step_in" => "stepIn",
            "stepOut" | "step_out" => "stepOut",
            "pause" => "pause",
            other => return Err(AppError::Dap(format!("unknown control action: {other}"))),
        };
        self.request(cmd, json!({ "threadId": thread_id }))
            .await
            .map_err(AppError::Dap)?;
        Ok(())
    }

    pub async fn stack_trace(&self) -> Result<Vec<StackFrameDto>, AppError> {
        let thread_id = self.resolve_thread_id().await;
        let body = self
            .request(
                "stackTrace",
                json!({ "threadId": thread_id, "startFrame": 0, "levels": 32 }),
            )
            .await
            .map_err(AppError::Dap)?;
        let mut frames = Vec::new();
        if let Some(arr) = body.get("stackFrames").and_then(|s| s.as_array()) {
            for f in arr {
                let source_path = f
                    .get("source")
                    .and_then(|s| s.get("path"))
                    .and_then(|p| p.as_str())
                    .map(|s| s.to_string());
                frames.push(StackFrameDto {
                    id: f.get("id").and_then(|i| i.as_i64()).unwrap_or(0),
                    name: f
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("?")
                        .to_string(),
                    source_path,
                    line: f.get("line").and_then(|l| l.as_u64()).unwrap_or(0) as u32,
                    column: f.get("column").and_then(|c| c.as_u64()).unwrap_or(0) as u32,
                });
            }
        }
        Ok(frames)
    }

    pub async fn scopes_variables(
        &self,
        frame_id: i64,
    ) -> Result<Vec<VariableDto>, AppError> {
        let scopes_body = self
            .request("scopes", json!({ "frameId": frame_id }))
            .await
            .map_err(AppError::Dap)?;
        let mut vars = Vec::new();
        if let Some(scopes) = scopes_body.get("scopes").and_then(|s| s.as_array()) {
            for scope in scopes.iter().take(2) {
                let reference = scope
                    .get("variablesReference")
                    .and_then(|r| r.as_i64())
                    .unwrap_or(0);
                if reference <= 0 {
                    continue;
                }
                let vbody = self
                    .request("variables", json!({ "variablesReference": reference }))
                    .await
                    .map_err(AppError::Dap)?;
                if let Some(arr) = vbody.get("variables").and_then(|v| v.as_array()) {
                    for v in arr {
                        vars.push(VariableDto {
                            name: v
                                .get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or("?")
                                .to_string(),
                            value: v
                                .get("value")
                                .and_then(|n| n.as_str())
                                .unwrap_or("")
                                .to_string(),
                            var_type: v
                                .get("type")
                                .and_then(|t| t.as_str())
                                .map(|s| s.to_string()),
                            variables_reference: v
                                .get("variablesReference")
                                .and_then(|r| r.as_i64())
                                .unwrap_or(0),
                        });
                    }
                }
            }
        }
        Ok(vars)
    }

    /// Evaluate expression in the current frame (Debug Console).
    pub async fn evaluate(
        &self,
        expression: &str,
        frame_id: Option<i64>,
    ) -> Result<String, AppError> {
        let mut args = json!({
            "expression": expression,
            "context": "repl",
        });
        if let Some(fid) = frame_id {
            args.as_object_mut()
                .unwrap()
                .insert("frameId".into(), json!(fid));
        }
        let body = self.request("evaluate", args).await.map_err(AppError::Dap)?;
        Ok(body
            .get("result")
            .and_then(|r| r.as_str())
            .unwrap_or("")
            .to_string())
    }

    pub async fn stop(&self) {
        let _ = self
            .request("disconnect", json!({ "terminateDebuggee": true }))
            .await;
        if let Some(kill) = self.kill.lock().await.take() {
            kill();
        }
        self.finish_terminated(Some("Stopped".into()), json!({ "reason": "stopped" }))
            .await;
    }

    pub async fn info(&self) -> DapSessionInfo {
        DapSessionInfo {
            session_id: self.session_id.clone(),
            project_id: self.project_id.clone(),
            project_path: self.project_path.clone(),
            config_name: self.config_name.clone(),
            status: self.status.lock().await.clone(),
            status_message: self.status_message.lock().await.clone(),
        }
    }

    async fn set_status(&self, status: &str, message: Option<String>) {
        *self.status.lock().await = status.to_string();
        *self.status_message.lock().await = message;
        let _ = self.app.emit(
            "dap-session-status",
            self.info().await,
        );
    }

    async fn emit_event(&self, kind: &str, body: Value) {
        let payload = DapEventPayload {
            session_id: self.session_id.clone(),
            project_id: self.project_id.clone(),
            kind: kind.to_string(),
            body,
        };
        if let Err(e) = self.app.emit("dap-event", &payload) {
            log::warn!("[DAP] emit failed: {e}");
        }
    }
}

fn group_breakpoints(bps: &[BreakpointSpec]) -> Vec<(String, Vec<u32>)> {
    let mut map: HashMap<String, Vec<u32>> = HashMap::new();
    for b in bps {
        map.entry(b.file_path.clone()).or_default().push(b.line);
    }
    map.into_iter().collect()
}

/// Read process pipe line-by-line and forward (category, line) to the UI console.
async fn forward_process_lines(
    reader: BoxAsyncRead,
    category: &str,
    tx: mpsc::UnboundedSender<(String, String)>,
    acc: Option<Arc<Mutex<String>>>,
) {
    let mut lines = BufReader::new(reader).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                if let Some(ref buf) = acc {
                    let mut g = buf.lock().await;
                    g.push_str(&line);
                    g.push('\n');
                    if g.len() > 16 * 1024 {
                        let drain = g.len() - 8 * 1024;
                        g.drain(..drain);
                    }
                }
                if !line.trim().is_empty() {
                    let _ = tx.send((category.to_string(), line));
                }
            }
            Ok(None) | Err(_) => break,
        }
    }
}


