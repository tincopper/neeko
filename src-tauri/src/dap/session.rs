//! DAP debug session: lifecycle, status, and UI-facing control surface.
//!
//! Orchestrates adapter plugin + process + client. Does not touch host-local
//! PATH APIs or `common::executor` directly.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Weak};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};

use super::adapter::{self, DebugAdapterPlugin};
use super::client::{DapClient, DapEventHandler};
use super::process;
use super::types::{
    BreakpointSpec, ControlAction, DapEventPayload, DapSessionInfo, HandshakeOrder, LaunchConfig,
    SessionStatus, StackFrameDto, VariableDto,
};
use crate::common::executor::factory::ExecTarget;
use crate::AppError;

static NEXT_SESSION: AtomicI64 = AtomicI64::new(1);

pub struct DapSession {
    pub session_id: String,
    pub project_id: String,
    pub project_path: String,
    pub config_name: String,
    status: Mutex<SessionStatus>,
    status_message: Mutex<Option<String>>,
    last_thread_id: Mutex<i64>,
    client: Arc<DapClient>,
    kill: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    stopped_waiters: Mutex<Vec<oneshot::Sender<()>>>,
    terminated_emitted: AtomicBool,
    app: AppHandle,
}

/// Bridges DAP client events to session methods via `Weak` (breaks init cycle).
struct SessionHandler(Weak<DapSession>);

impl SessionHandler {
    fn upgrade(&self) -> Option<Arc<DapSession>> {
        self.0.upgrade()
    }
}

impl DapEventHandler for SessionHandler {
    fn on_initialized(&self) {}

    fn on_stopped(&self, body: Value) {
        if let Some(s) = self.upgrade() {
            tokio::spawn(async move { s.handle_stopped(body).await });
        }
    }

    fn on_continued(&self, body: Value) {
        if let Some(s) = self.upgrade() {
            tokio::spawn(async move { s.handle_continued(body).await });
        }
    }

    fn on_terminated(&self, body: Value) {
        if let Some(s) = self.upgrade() {
            tokio::spawn(async move {
                s.finish_terminated(None, body).await;
            });
        }
    }

    fn on_output(&self, body: Value) {
        if let Some(s) = self.upgrade() {
            tokio::spawn(async move { s.emit_event("output", body).await });
        }
    }

    fn on_other_event(&self, event: &str, body: Value) {
        log::debug!("[DAP] event {event}: {body}");
    }
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
        let plugin = adapter::plugin_for(&config.type_)?;

        if !plugin.is_available(&target).await {
            return Err(AppError::Dap(format!(
                "Debug adapter for type '{}' not found. {}",
                config.type_,
                plugin.install_hint()
            )));
        }

        if let Some(ref pre) = config.pre_launch_task {
            process::run_pre_launch_task(&target, pre).await?;
        }

        // Single resolve path — always against project ExecTarget.
        let spawn = plugin.resolve_spawn(&target).await?;
        let adapter_proc = process::spawn_adapter(&target, &project_path, &spawn).await?;
        let process::AdapterProcess {
            io,
            kill: kill_fn,
        } = adapter_proc;
        let stderr_buf = Arc::clone(&io.stderr_buf);
        let mut proc_out_rx = io.proc_out_rx;

        let session_id = format!("dap-{}", NEXT_SESSION.fetch_add(1, Ordering::SeqCst));
        let config_name = config.name.clone();

        // Arc::new_cyclic: handler holds Weak, client starts before Arc is fully built.
        let session = Arc::new_cyclic(|weak| {
            let handler: Arc<dyn DapEventHandler> =
                Arc::new(SessionHandler(weak.clone()));
            let client = DapClient::start(io.reader, io.writer, handler);
            Self {
                session_id: session_id.clone(),
                project_id: project_id.clone(),
                project_path: project_path.clone(),
                config_name: config_name.clone(),
                status: Mutex::new(SessionStatus::Starting),
                status_message: Mutex::new(None),
                last_thread_id: Mutex::new(1),
                client,
                kill: Mutex::new(Some(kill_fn)),
                stopped_waiters: Mutex::new(Vec::new()),
                terminated_emitted: AtomicBool::new(false),
                app: app.clone(),
            }
        });

        // Forward process pipe output into DAP-style output events.
        let session_out = Arc::clone(&session);
        tokio::spawn(async move {
            while let Some((category, line)) = proc_out_rx.recv().await {
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

        let handshake = session
            .run_handshake(plugin, &config, &project_path, &breakpoints)
            .await;

        if let Err(e) = handshake {
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

    async fn run_handshake(
        self: &Arc<Self>,
        plugin: &dyn DebugAdapterPlugin,
        config: &LaunchConfig,
        project_path: &str,
        breakpoints: &[BreakpointSpec],
    ) -> Result<(), AppError> {
        self.set_status(SessionStatus::Starting, Some("Initializing adapter".into()))
            .await;

        let init_args = json!({
            "clientID": "neeko",
            "clientName": "Neeko",
            "adapterID": plugin.adapter_id(),
            "pathFormat": "path",
            "linesStartAt1": true,
            "columnsStartAt1": true,
            "supportsVariableType": true,
            "supportsVariablePaging": false,
            "locale": "en-us",
        });
        let init_resp = self
            .client
            .request("initialize", init_args)
            .await
            .map_err(|e| AppError::Dap(format!("initialize failed: {e}")))?;
        log::info!("[DAP] initialize ok: {init_resp}");

        let launch_args = plugin.build_launch_args(config, project_path)?;
        let stop_on_entry = config.stop_on_entry.unwrap_or(false);
        let entry_fn = plugin.entry_function_for_stop_on_entry(stop_on_entry);

        match plugin.handshake_order() {
            HandshakeOrder::LaunchBeforeBreakpoints => {
                self.set_status(
                    SessionStatus::Starting,
                    Some("Building / launching…".into()),
                )
                .await;
                self.client
                    .request_timeout("launch", launch_args, Duration::from_secs(180))
                    .await
                    .map_err(|e| AppError::Dap(format!("launch failed: {e}")))?;
                self.client
                    .wait_for_initialized(Duration::from_secs(30))
                    .await?;
                self.apply_breakpoints(breakpoints, entry_fn).await;
                let _ = self.client.request("configurationDone", json!({})).await;
            }
            HandshakeOrder::BreakpointsBeforeLaunch => {
                let _ = self
                    .client
                    .wait_for_initialized(Duration::from_secs(3))
                    .await;
                self.apply_breakpoints(breakpoints, entry_fn).await;
                let _ = self.client.request("configurationDone", json!({})).await;
                self.client
                    .request_timeout("launch", launch_args, Duration::from_secs(60))
                    .await
                    .map_err(|e| AppError::Dap(format!("launch failed: {e}")))?;
            }
        }

        if stop_on_entry {
            self.set_status(
                SessionStatus::Starting,
                Some("Waiting for entry stop…".into()),
            )
            .await;
            if self
                .wait_for_stopped(Duration::from_secs(15))
                .await
                .is_err()
            {
                log::warn!("[DAP] no stopped event after configurationDone");
                self.set_status(
                    SessionStatus::Running,
                    Some("Debug session running".into()),
                )
                .await;
            }
        } else {
            self.set_status(
                SessionStatus::Running,
                Some("Debug session running".into()),
            )
            .await;
        }

        let status = *self.status.lock().await;
        self.emit_event(
            "session",
            json!({ "status": status.as_str(), "configName": config.name }),
        )
        .await;
        Ok(())
    }

    async fn handle_stopped(&self, body: Value) {
        if let Some(tid) = body.get("threadId").and_then(|t| t.as_i64()) {
            *self.last_thread_id.lock().await = tid;
        }
        self.set_status(SessionStatus::Stopped, None).await;
        self.emit_event("stopped", body).await;
        let waiters = std::mem::take(&mut *self.stopped_waiters.lock().await);
        for tx in waiters {
            let _ = tx.send(());
        }
    }

    async fn handle_continued(&self, body: Value) {
        self.set_status(SessionStatus::Running, None).await;
        self.emit_event("continued", body).await;
    }

    async fn apply_breakpoints(
        &self,
        breakpoints: &[BreakpointSpec],
        entry_function: Option<&str>,
    ) {
        for (path, lines) in group_breakpoints(breakpoints) {
            let source = json!({ "path": path });
            let bps: Vec<Value> = lines.iter().map(|l| json!({ "line": l })).collect();
            if let Err(e) = self
                .client
                .request(
                    "setBreakpoints",
                    json!({ "source": source, "breakpoints": bps }),
                )
                .await
            {
                log::warn!("[DAP] setBreakpoints failed for {path}: {e}");
            }
        }
        if let Some(func) = entry_function {
            if let Err(e) = self
                .client
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
                .client
                .request("setFunctionBreakpoints", json!({ "breakpoints": [] }))
                .await;
        }
        let _ = self
            .client
            .request("setExceptionBreakpoints", json!({ "filters": [] }))
            .await;
    }

    async fn wait_for_stopped(&self, timeout: Duration) -> Result<(), AppError> {
        if *self.status.lock().await == SessionStatus::Stopped {
            return Ok(());
        }
        let (tx, rx) = oneshot::channel();
        self.stopped_waiters.lock().await.push(tx);
        if *self.status.lock().await == SessionStatus::Stopped {
            return Ok(());
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(_)) => {
                if *self.status.lock().await == SessionStatus::Stopped {
                    Ok(())
                } else {
                    Err(AppError::Dap("stopped wait canceled".into()))
                }
            }
            Err(_) => {
                if *self.status.lock().await == SessionStatus::Stopped {
                    Ok(())
                } else {
                    Err(AppError::Dap("Timed out waiting for stopped event".into()))
                }
            }
        }
    }

    async fn resolve_thread_id(&self) -> i64 {
        let last = *self.last_thread_id.lock().await;
        let Ok(body) = self.client.request("threads", json!({})).await else {
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

        for t in arr {
            if let Some((id, _)) = pick(t) {
                if id == last {
                    return id;
                }
            }
        }
        for t in arr {
            if let Some((id, name)) = pick(t) {
                if name.starts_with('*') {
                    *self.last_thread_id.lock().await = id;
                    return id;
                }
            }
        }
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
        self.set_status(SessionStatus::Terminated, message).await;
        self.emit_event("terminated", body).await;
    }

    pub async fn set_breakpoints_for_file(
        &self,
        file_path: &str,
        lines: &[u32],
    ) -> Result<Vec<BreakpointSpec>, AppError> {
        let bps: Vec<Value> = lines.iter().map(|l| json!({ "line": l })).collect();
        let body = self
            .client
            .request(
                "setBreakpoints",
                json!({
                    "source": { "path": file_path },
                    "breakpoints": bps,
                }),
            )
            .await?;
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
        let action = ControlAction::parse(action)?;
        let thread_id = self.resolve_thread_id().await;
        self.client
            .request(
                action.dap_command(),
                json!({ "threadId": thread_id }),
            )
            .await?;
        Ok(())
    }

    pub async fn stack_trace(&self) -> Result<Vec<StackFrameDto>, AppError> {
        let thread_id = self.resolve_thread_id().await;
        let body = self
            .client
            .request(
                "stackTrace",
                json!({ "threadId": thread_id, "startFrame": 0, "levels": 32 }),
            )
            .await?;
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

    pub async fn scopes_variables(&self, frame_id: i64) -> Result<Vec<VariableDto>, AppError> {
        let scopes_body = self
            .client
            .request("scopes", json!({ "frameId": frame_id }))
            .await?;
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
                    .client
                    .request("variables", json!({ "variablesReference": reference }))
                    .await?;
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
        let body = self.client.request("evaluate", args).await?;
        Ok(body
            .get("result")
            .and_then(|r| r.as_str())
            .unwrap_or("")
            .to_string())
    }

    pub async fn stop(&self) {
        let _ = self
            .client
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
            status: self.status.lock().await.as_str().to_string(),
            status_message: self.status_message.lock().await.clone(),
        }
    }

    async fn set_status(&self, status: SessionStatus, message: Option<String>) {
        *self.status.lock().await = status;
        *self.status_message.lock().await = message;
        let _ = self.app.emit("dap-session-status", self.info().await);
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
