//! ACP adapter — generic Agent Client Protocol over JSON-RPC stdio.
//!
//! ACP (Agent Client Protocol, https://agentclientprotocol.com) is the
//! standard interop transport for programmatic agent clients. IO shape:
//! `Spawn` a CLI that speaks ACP over stdio (e.g. DeepSeek Harness
//! `dsh-acp`, Zed agents), negotiate with `initialize` / `session/new`, then
//! stream `session/update` notifications and resolve `session/request_permission`
//! requests (Gate). The adapter is transport-agnostic: no vendor line protocol,
//! no stdout JSON-Lines assumption.
//!
//! Wire format: ACP spec allows both Content-Length framed (LSP-style) and
//! NDJSON (newline-delimited JSON). This adapter auto-detects the format
//! based on the agent: OpenCode uses NDJSON, others use Content-Length.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

use crate::agent::chat::adapter::{AgentAdapter, AgentContext, AgentKind, AgentSession};
use crate::agent::chat::events::{
    Capabilities, ContextManifest, DoneReason, SessionRequest, StreamEvent, TurnEndReason,
};
use crate::agent::chat::mock;
use crate::common::error::AppError;
use crate::common::executor::factory::ExecTarget;
use crate::core::exec;

/// ACP protocol version this client speaks.
const ACP_PROTOCOL_VERSION: i64 = 1;

// ── JSON-RPC framing (LSP-style Content-Length header) ──────────────────────

/// Wire format for JSON-RPC messages.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WireFormat {
    /// LSP-style Content-Length framed (e.g. DeepSeek Harness, Zed agents).
    ContentLength,
    /// NDJSON / newline-delimited JSON (e.g. OpenCode).
    Ndjson,
}

/// Encode one JSON-RPC message into a framed frame.
fn encode_frame(body: &str, format: WireFormat) -> Vec<u8> {
    match format {
        WireFormat::Ndjson => format!("{body}\n").into_bytes(),
        WireFormat::ContentLength => {
            format!("Content-Length: {}\r\n\r\n{}", body.len(), body).into_bytes()
        }
    }
}

/// Try to decode one frame from `buf` using Content-Length format.
/// Returns `(body, consumed)` or `None` when more bytes are needed.
fn try_decode_frame_content_length(buf: &[u8]) -> Option<(String, usize)> {
    // Find the header/body separator (empty line).
    let sep = find_header_end(buf)?;
    let header = &buf[..sep];
    let header = String::from_utf8_lossy(header);
    let len = parse_content_length(&header)?;
    let body_start = sep + 4; // skip the full "\r\n\r\n" separator
    if buf.len() < body_start + len {
        return None; // body not fully buffered yet
    }
    let body = String::from_utf8_lossy(&buf[body_start..body_start + len]).into_owned();
    Some((body, body_start + len))
}

/// Try to decode one frame from `buf` using NDJSON format.
/// Returns `(body, consumed)` or `None` when more bytes are needed.
fn try_decode_frame_ndjson(buf: &[u8]) -> Option<(String, usize)> {
    // Find the next newline.
    let newline_pos = buf.iter().position(|&b| b == b'\n')?;
    let body = String::from_utf8_lossy(&buf[..newline_pos]).into_owned();
    // Skip the newline character (and optional \r before it).
    let consumed = newline_pos + 1;
    if body.is_empty() {
        // Skip empty lines and try to decode the next one.
        try_decode_frame_ndjson(&buf[consumed..])
    } else {
        Some((body, consumed))
    }
}

/// Try to decode one frame from `buf` using the given format.
fn try_decode_frame(buf: &[u8], format: WireFormat) -> Option<(String, usize)> {
    match format {
        WireFormat::ContentLength => try_decode_frame_content_length(buf),
        WireFormat::Ndjson => try_decode_frame_ndjson(buf),
    }
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn parse_content_length(header: &str) -> Option<usize> {
    for line in header.lines() {
        if let Some(value) = line.strip_prefix("Content-Length:") {
            return value.trim().parse().ok();
        }
    }
    None
}

// ── Protocol translation (pure, testable) ───────────────────────────────────

/// Translate a `session/update` notification into a [`StreamEvent`].
fn translate_notification(session_id: &str, params: &serde_json::Value) -> Option<StreamEvent> {
    let update = params.get("update")?;
    let kind = update.get("sessionUpdate")?.as_str()?;
    match kind {
        "agent_thought_chunk" => {
            let content = update.get("content")?;
            match content.get("type").and_then(|t| t.as_str()) {
                Some("text") => Some(StreamEvent::ReasoningDelta {
                    session_id: session_id.into(),
                    delta: content
                        .get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .into(),
                }),
                _ => None,
            }
        }
        "agent_message_chunk" => {
            let content = update.get("content")?;
            match content.get("type").and_then(|t| t.as_str()) {
                Some("text") => Some(StreamEvent::TextDelta {
                    session_id: session_id.into(),
                    delta: content
                        .get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .into(),
                }),
                _ => None, // image / other blocks: no text surface
            }
        }
        "turn_end" => Some(StreamEvent::TurnEnd {
            session_id: session_id.into(),
            turn_id: update
                .get("turnId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .into(),
            reason: match update
                .get("reason")
                .and_then(|r| r.get("kind"))
                .and_then(|k| k.as_str())
            {
                Some("error") => TurnEndReason::Error,
                Some("cancelled") | Some("cancel") => TurnEndReason::Stopped,
                _ => TurnEndReason::Completed,
            },
        }),
        "agent_idle" => Some(StreamEvent::TurnEnd {
            session_id: session_id.into(),
            turn_id: String::new(),
            reason: TurnEndReason::Completed,
        }),
        "tool_call" => Some(StreamEvent::ToolStart {
            session_id: session_id.into(),
            call_id: update
                .get("toolCallId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .into(),
            name: update
                .get("toolName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .into(),
            title: update
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .into(),
        }),
        "tool_output" => Some(StreamEvent::ToolOutput {
            session_id: session_id.into(),
            call_id: update
                .get("toolCallId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .into(),
            output: update
                .get("output")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .into(),
        }),
        "tool_end" => Some(StreamEvent::ToolEnd {
            session_id: session_id.into(),
            call_id: update
                .get("toolCallId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .into(),
            status: update
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("done")
                .into(),
        }),
        "command_run" => Some(StreamEvent::CommandRun {
            session_id: session_id.into(),
            call_id: update
                .get("toolCallId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .into(),
            cwd: update
                .get("cwd")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .into(),
            cmd: update
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .into(),
        }),
        _ => None,
    }
}

/// Translate a `session/request_permission` request (server → client) into a
/// [`StreamEvent::RequestApproval`]. Also records `call_id → rpc id` so the
/// approval reply can target the right request.
fn translate_permission_request(
    session_id: &str,
    id: i64,
    params: &serde_json::Value,
    pending: &Mutex<HashMap<String, i64>>,
) -> Option<StreamEvent> {
    let tool_call = params.get("toolCall")?;
    let call_id = tool_call.get("toolCallId")?.as_str()?.to_string();
    if let Ok(mut map) = pending.lock() {
        map.insert(call_id.clone(), id);
    }
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let prompt = params
        .get("explanation")
        .and_then(|v| v.as_str())
        .unwrap_or("允许该操作？")
        .to_string();
    Some(StreamEvent::RequestApproval {
        session_id: session_id.into(),
        call_id,
        tool: tool_call
            .get("toolName")
            .and_then(|v| v.as_str())
            .unwrap_or("tool")
            .into(),
        title,
        prompt,
        diff: params
            .get("diff")
            .and_then(|v| v.as_str())
            .map(String::from),
        cmd: params.get("cmd").and_then(|v| v.as_str()).map(String::from),
    })
}

/// Serialize a [`SessionRequest`] into a JSON-RPC write to stdin.
fn request_to_jsonrpc(
    session_id: &str,
    req: &SessionRequest,
    pending: &Mutex<HashMap<String, i64>>,
    wire_format: WireFormat,
) -> Option<serde_json::Value> {
    match req {
        SessionRequest::Cancel => {
            // OpenCode uses session/close instead of session/cancel.
            let method = if wire_format == WireFormat::Ndjson {
                "session/close"
            } else {
                "session/cancel"
            };
            Some(serde_json::json!({
                "jsonrpc": "2.0",
                "id": next_rpc_id(),
                "method": method,
                "params": { "sessionId": session_id }
            }))
        }
        SessionRequest::Approve { call_id, allow } => {
            let id = pending.lock().ok()?.get(call_id).copied()?;
            Some(serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "outcome": if *allow { "allow-once" } else { "reject-once" }
                }
            }))
        }
        SessionRequest::Input { turn_id, prompt } => Some(serde_json::json!({
            "jsonrpc": "2.0",
            "id": next_rpc_id(),
            "method": "session/prompt",
            "params": {
                "sessionId": session_id,
                "prompt": [
                    { "type": "text", "text": format!("[{turn_id}] {prompt}") }
                ]
            }
        })),
        // ACP has no per-turn model selection (upstream limitation); the
        // field is ignored here.
        SessionRequest::Turn { prompt, .. } => Some(serde_json::json!({
            "jsonrpc": "2.0",
            "id": next_rpc_id(),
            "method": "session/prompt",
            "params": {
                "sessionId": session_id,
                "prompt": [ { "type": "text", "text": prompt } ]
            }
        })),
        // ACP has no mid-session context rebind; ignored (page keeps state).
        SessionRequest::ContextSet { .. } | SessionRequest::Pause | SessionRequest::Resume => None,
    }
}

fn next_rpc_id() -> i64 {
    use std::sync::atomic::{AtomicI64, Ordering};
    static NEXT_ID: AtomicI64 = AtomicI64::new(10);
    NEXT_ID.fetch_add(1, Ordering::Relaxed)
}

// ── Adapter ─────────────────────────────────────────────────────────────────

/// IO shape of the ACP endpoint.
pub enum AcpIo {
    /// Spawn a CLI that speaks ACP over stdio.
    Spawn(Vec<String>),
    /// Run the in-process mockAgent over a duplex pipe (dev/test).
    Mock,
}

/// ACP adapter. Bridges the unified [`StreamEvent`] protocol to an ACP
/// endpoint: a spawned child process, or the in-process mockAgent.
pub struct AcpAdapter {
    io: AcpIo,
    /// Wire format override. `None` = auto-detect based on command name.
    wire_format: Option<WireFormat>,
}

impl AcpAdapter {
    /// Create an ACP adapter that spawns the given command.
    #[must_use]
    pub fn new(cmd: Vec<String>) -> Self {
        // Auto-detect wire format based on command name.
        let wire_format = if cmd
            .first()
            .is_some_and(|c| c.contains("opencode") || c.contains("kilo"))
        {
            Some(WireFormat::Ndjson)
        } else {
            None
        };
        Self {
            io: AcpIo::Spawn(cmd),
            wire_format,
        }
    }

    /// Create an ACP adapter backed by the in-process mockAgent.
    #[must_use]
    pub const fn mock() -> Self {
        Self {
            io: AcpIo::Mock,
            wire_format: None,
        }
    }

    /// Create an ACP adapter with an explicit wire format.
    #[must_use]
    pub const fn with_wire_format(cmd: Vec<String>, format: WireFormat) -> Self {
        Self {
            io: AcpIo::Spawn(cmd),
            wire_format: Some(format),
        }
    }
}

#[async_trait]
impl AgentAdapter for AcpAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::Custom
    }

    async fn create(&self, ctx: &AgentContext) -> Result<Box<dyn AgentSession>, AppError> {
        let wire_format = self.wire_format.unwrap_or(WireFormat::ContentLength);
        log::info!(
            "[AcpAdapter::create] agent_id={}, wire_format={:?}",
            ctx.session_id,
            wire_format
        );
        match &self.io {
            AcpIo::Spawn(cmd) => {
                let target = ExecTarget::Local;
                let program = &cmd[0];
                let args: Vec<&str> = cmd[1..].iter().map(|s| s.as_str()).collect();
                log::info!("[AcpAdapter::create] Spawning: {} {:?}", program, args);
                let child = exec::spawn(&target, program, &args).await.map_err(|e| {
                    log::error!("[AcpAdapter::create] Failed to spawn: {e}");
                    AppError::Io(format!("failed to spawn acp agent: {e}"))
                })?;
                let stdout = child
                    .stdout
                    .map(BufReader::new)
                    .ok_or_else(|| AppError::Io("acp child has no stdout".into()))?;
                let stdin = child
                    .stdin
                    .ok_or_else(|| AppError::Io("acp child has no stdin".into()))?;
                log::info!("[AcpAdapter::create] Child spawned successfully, setting up session");
                Self::create_with_io(ctx, stdout, stdin, wire_format).await
            }
            AcpIo::Mock => {
                // In-process: a duplex pipe; one end drives run_mock_loop, the
                // other end is the ACP stdio pair seen by the session.
                let (client, mock) = tokio::io::duplex(65536);
                let (mock_reader, mock_writer) = tokio::io::split(mock);
                tokio::spawn(mock::run_mock_loop(mock_reader, mock_writer));
                let (client_reader, client_writer) = tokio::io::split(client);
                Self::create_with_io(
                    ctx,
                    BufReader::new(client_reader),
                    client_writer,
                    wire_format,
                )
                .await
            }
        }
    }
}

impl AcpAdapter {
    /// Shared session setup over an arbitrary ACP stdio pair: handshake
    /// (initialize → session/new), initial prompt, event pump, request channel.
    async fn create_with_io<R, W>(
        ctx: &AgentContext,
        stdout: BufReader<R>,
        stdin: W,
        wire_format: WireFormat,
    ) -> Result<Box<dyn AgentSession>, AppError>
    where
        R: tokio::io::AsyncRead + Unpin + Send + 'static,
        W: tokio::io::AsyncWrite + Unpin + Send + 'static,
    {
        let session_id = ctx.session_id.clone();

        // ── Handshake: initialize → session/new ───────────────────────────
        let (req_tx, mut req_rx) = mpsc::channel::<SessionRequest>(64);
        let pending = Arc::new(Mutex::new(HashMap::<String, i64>::new()));

        let mut writer = stdin;
        let init = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": ACP_PROTOCOL_VERSION,
                "clientCapabilities": {
                    "promptCapabilities": { "image": false, "audio": false, "embeddedContext": false }
                }
            }
        });
        log::info!("[AcpAdapter::create_with_io] Sending initialize");
        writer
            .write_all(&encode_frame(&init.to_string(), wire_format))
            .await
            .map_err(|e| AppError::Io(format!("acp initialize write: {e}")))?;

        let mut reader = stdout;
        // Drain until we see the response to id=1 (initialize).
        let init_response = wait_for_response(&mut reader, 1, wire_format)
            .await
            .map_err(|e| AppError::Io(format!("acp initialize handshake failed: {e}")))?;
        log::info!(
            "[AcpAdapter::create_with_io] Initialize response: {:?}",
            init_response
        );

        let new_session = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "session/new",
            "params": { "cwd": ctx.project_id, "mcpServers": [] }
        });
        log::info!("[AcpAdapter::create_with_io] Sending session/new");
        writer
            .write_all(&encode_frame(&new_session.to_string(), wire_format))
            .await
            .map_err(|e| AppError::Io(format!("acp session/new write: {e}")))?;
        let session_id_resp = wait_for_response(&mut reader, 2, wire_format)
            .await
            .map_err(|e| AppError::Io(format!("acp session/new handshake failed: {e}")))?;
        log::info!(
            "[AcpAdapter::create_with_io] session/new response: {:?}",
            session_id_resp
        );

        // Prefer the server-issued session id; fall back to ours.
        // OpenCode returns sessionId at the top level of the response.
        let acp_sid = session_id_resp
            .get("sessionId")
            .and_then(|v| v.as_str())
            .unwrap_or(&session_id)
            .to_string();

        // ── Send the initial prompt, then start the pump ──────────────────
        if !ctx.prompt.is_empty() {
            let prompt = serde_json::json!({
                "jsonrpc": "2.0",
                "id": next_rpc_id(),
                "method": "session/prompt",
                "params": {
                    "sessionId": acp_sid,
                    "prompt": [ { "type": "text", "text": ctx.prompt } ]
                }
            });
            writer
                .write_all(&encode_frame(&prompt.to_string(), wire_format))
                .await
                .map_err(|e| AppError::Io(format!("acp prompt write: {e}")))?;
        }

        // ── Event pump ────────────────────────────────────────────────────
        let (event_tx, event_rx) = mpsc::channel(64);
        let sid = session_id.clone();
        let pending_pump = Arc::clone(&pending);
        // ctx 是借用引用，闭包需持有 owned 快照（避免 E0521 借用逃逸）。
        let ctx_project_id = ctx.project_id.clone();
        let ctx_project_name = ctx.project_name.clone();
        let ctx_env = ctx.env.clone();
        let ctx_skills = ctx.skills.clone();
        let ctx_files = ctx.files.clone();
        let ctx_mode = ctx.mode.clone();
        let ctx_agent_id = ctx.agent_id.clone();
        tokio::spawn(async move {
            // SessionStart + ContextInit emitted immediately by the adapter
            // (lifecycle contract, independent of the agent's own output).
            let _ = event_tx
                .send(StreamEvent::SessionStart {
                    session_id: sid.clone(),
                    agent: ctx_agent_id,
                    model: None,
                    capabilities: Capabilities {
                        approvals: true,
                        command_echo: false,
                        diff: false,
                        resume: false,
                    },
                })
                .await;
            let _ = event_tx
                .send(StreamEvent::ContextInit {
                    session_id: sid.clone(),
                    manifest: ContextManifest {
                        project_id: ctx_project_id,
                        project_name: ctx_project_name,
                        env: ctx_env,
                        skills: ctx_skills,
                        files: ctx_files,
                        mode: ctx_mode,
                    },
                })
                .await;

            let mut buf: Vec<u8> = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                match reader.read(&mut chunk).await {
                    Ok(0) | Err(_) => break, // EOF / transport error
                    Ok(n) => {
                        buf.extend_from_slice(&chunk[..n]);
                        while let Some((body, consumed)) = try_decode_frame(&buf, wire_format) {
                            buf.drain(..consumed);
                            log::debug!("[AcpAdapter event pump] received frame: {body}");
                            if let Some(ev) = handle_inbound(&body, &sid, &pending_pump) {
                                log::debug!(
                                    "[AcpAdapter event pump] translated to event: {:?}",
                                    ev
                                );
                                if event_tx.send(ev).await.is_err() {
                                    return;
                                }
                            }
                        }
                    }
                }
            }
            // Stream closed → session done.
            let _ = event_tx
                .send(StreamEvent::SessionDone {
                    session_id: sid,
                    reason: DoneReason::Completed,
                })
                .await;
        });

        // ── Request channel: page → agent ─────────────────────────────────
        let pending_req = Arc::clone(&pending);
        let acp_sid_req = acp_sid.clone();
        let wire_format_req = wire_format;
        tokio::spawn(async move {
            while let Some(req) = req_rx.recv().await {
                let Some(msg) =
                    request_to_jsonrpc(&acp_sid_req, &req, &pending_req, wire_format_req)
                else {
                    continue;
                };
                if writer
                    .write_all(&encode_frame(&msg.to_string(), wire_format))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });

        Ok(Box::new(AcpSession {
            event_rx,
            request_tx: req_tx,
            resume: None,
        }))
    }
}

/// Read frames until the response matching `id` arrives; returns its `result`.
async fn wait_for_response(
    reader: &mut BufReader<impl tokio::io::AsyncRead + Unpin>,
    id: i64,
    wire_format: WireFormat,
) -> Result<serde_json::Value, AppError> {
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let n = reader
            .read(&mut chunk)
            .await
            .map_err(|e| AppError::Io(format!("acp read: {e}")))?;
        if n == 0 {
            return Err(AppError::Io("acp stream closed during handshake".into()));
        }
        buf.extend_from_slice(&chunk[..n]);
        while let Some((body, consumed)) = try_decode_frame(&buf, wire_format) {
            buf.drain(..consumed);
            let v: serde_json::Value = serde_json::from_str(&body)
                .map_err(|e| AppError::Io(format!("acp bad json: {e}")))?;
            if v.get("id").and_then(|i| i.as_i64()) == Some(id) {
                if let Some(err) = v.get("error") {
                    return Err(AppError::Io(format!("acp rpc error: {err}")));
                }
                return v
                    .get("result")
                    .cloned()
                    .ok_or_else(|| AppError::Io("acp response missing result".into()));
            }
        }
    }
}

/// Dispatch one inbound JSON-RPC message (notification, server request, or client response).
fn handle_inbound(
    body: &str,
    session_id: &str,
    pending: &Mutex<HashMap<String, i64>>,
) -> Option<StreamEvent> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;

    // Server → client requests / notifications carry a `method`. They may also
    // carry an `id` (JSON-RPC server request, e.g. `session/request_permission`)
    // — the method must be dispatched before the response branch below, which
    // would otherwise drop id-bearing requests.
    if let Some(method) = v.get("method").and_then(|m| m.as_str()) {
        let params = v.get("params")?;
        return match method {
            "session/update" => translate_notification(session_id, params),
            "session/request_permission" => {
                let id = v.get("id").and_then(|i| i.as_i64()).unwrap_or(0);
                translate_permission_request(session_id, id, params, pending)
            }
            _ => None,
        };
    }

    // Responses to our client requests (messages with `id` and `result`).
    if let Some(id) = v.get("id").and_then(|i| i.as_i64()) {
        if let Some(result) = v.get("result") {
            // Check if this is a turn-end response (has stopReason).
            if result.get("stopReason").is_some() {
                log::info!("[AcpAdapter handle_inbound] turn ended with id={}", id);
                return Some(StreamEvent::TurnEnd {
                    session_id: session_id.into(),
                    turn_id: String::new(),
                    reason: TurnEndReason::Completed,
                });
            }
        }
        // Other responses are ignored (e.g. session/new, session/prompt acknowledgments).
        return None;
    }

    None
}

/// A live ACP session.
struct AcpSession {
    event_rx: mpsc::Receiver<StreamEvent>,
    request_tx: mpsc::Sender<SessionRequest>,
    resume: Option<String>,
}

#[async_trait]
impl AgentSession for AcpSession {
    async fn next(&mut self) -> Option<Result<StreamEvent, AppError>> {
        self.event_rx.recv().await.map(Ok)
    }

    async fn send(&mut self, req: SessionRequest) -> Result<(), AppError> {
        self.request_tx
            .send(req)
            .await
            .map_err(|e| AppError::Io(format!("acp request channel closed: {e}")))
    }

    async fn cancel(&mut self) {
        let _ = self.send(SessionRequest::Cancel).await;
        self.event_rx.close();
    }

    fn resume_id(&self) -> Option<String> {
        self.resume.clone()
    }

    fn request_channel(&self) -> Option<mpsc::Sender<SessionRequest>> {
        Some(self.request_tx.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_roundtrip_content_length() {
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#;
        let frame = encode_frame(body, WireFormat::ContentLength);
        let (decoded, consumed) =
            try_decode_frame(&frame, WireFormat::ContentLength).expect("decode");
        assert_eq!(decoded, body);
        assert_eq!(consumed, frame.len());
    }

    #[test]
    fn frame_requires_more_bytes_content_length() {
        let body = r#"{"jsonrpc":"2.0","id":1}"#;
        let frame = encode_frame(body, WireFormat::ContentLength);
        assert!(try_decode_frame(&frame[..frame.len() - 5], WireFormat::ContentLength).is_none());
    }

    #[test]
    fn frame_roundtrip_ndjson() {
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#;
        let frame = encode_frame(body, WireFormat::Ndjson);
        let (decoded, consumed) = try_decode_frame(&frame, WireFormat::Ndjson).expect("decode");
        assert_eq!(decoded, body);
        assert_eq!(consumed, frame.len());
    }

    #[test]
    fn ndjson_skips_empty_lines() {
        let body = "\n\n{\"jsonrpc\":\"2.0\",\"id\":1}\n";
        let (decoded, _) = try_decode_frame(body.as_bytes(), WireFormat::Ndjson).expect("decode");
        assert_eq!(decoded, r#"{"jsonrpc":"2.0","id":1}"#);
    }

    #[test]
    fn text_chunk_notification() {
        let params = serde_json::json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": { "type": "text", "text": "hello" }
            }
        });
        let ev = translate_notification("s1", &params).expect("event");
        assert_eq!(
            ev,
            StreamEvent::TextDelta {
                session_id: "s1".into(),
                delta: "hello".into()
            }
        );
    }

    #[test]
    fn non_text_chunk_ignored() {
        let params = serde_json::json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": { "type": "image", "image": "base64..." }
            }
        });
        assert!(translate_notification("s1", &params).is_none());
    }

    #[test]
    fn permission_request_records_call_id() {
        let pending = Mutex::new(HashMap::new());
        let params = serde_json::json!({
            "sessionId": "s1",
            "toolCall": { "toolCallId": "c2", "toolName": "edit_file" },
            "title": "edit adapter.rs",
            "explanation": "ok?"
        });
        let ev = translate_permission_request("s1", 7, &params, &pending).expect("event");
        match ev {
            StreamEvent::RequestApproval { call_id, tool, .. } => {
                assert_eq!(call_id, "c2");
                assert_eq!(tool, "edit_file");
                assert_eq!(pending.lock().expect("lock").get("c2"), Some(&7));
            }
            other => panic!("expected RequestApproval, got {other:?}"),
        }
    }

    #[test]
    fn approve_replies_to_recorded_id() {
        let pending = Mutex::new(HashMap::from([("c2".to_string(), 7i64)]));
        let msg = request_to_jsonrpc(
            "s1",
            &SessionRequest::Approve {
                call_id: "c2".into(),
                allow: true,
            },
            &pending,
            WireFormat::ContentLength,
        )
        .expect("message");
        assert_eq!(msg.get("id").and_then(|v| v.as_i64()), Some(7));
        assert_eq!(
            msg.get("result")
                .and_then(|r| r.get("outcome"))
                .and_then(|v| v.as_str()),
            Some("allow-once")
        );
    }

    #[test]
    fn cancel_is_a_request_content_length() {
        let pending = Mutex::new(HashMap::new());
        let msg = request_to_jsonrpc(
            "s1",
            &SessionRequest::Cancel,
            &pending,
            WireFormat::ContentLength,
        )
        .expect("message");
        assert_eq!(
            msg.get("method").and_then(|v| v.as_str()),
            Some("session/cancel")
        );
        assert!(msg.get("id").is_some());
    }

    #[test]
    fn cancel_is_a_request_ndjson() {
        let pending = Mutex::new(HashMap::new());
        let msg = request_to_jsonrpc("s1", &SessionRequest::Cancel, &pending, WireFormat::Ndjson)
            .expect("message");
        assert_eq!(
            msg.get("method").and_then(|v| v.as_str()),
            Some("session/close")
        );
        assert!(msg.get("id").is_some());
    }
}
