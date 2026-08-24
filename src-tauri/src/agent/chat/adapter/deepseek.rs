//! DeepSeek Harness adapter — first reference adapter (v3).
//!
//! Spawns a local DeepSeek Harness session process via the unified exec facade
//! (core::exec, red line 1) and speaks a JSON-Lines protocol over stdio.
//! Each stdout line is translated into a [`StreamEvent`] and forwarded.

use async_trait::async_trait;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

use crate::agent::chat::adapter::{AgentAdapter, AgentContext, AgentKind, AgentSession};
use crate::agent::chat::events::{
    Capabilities, ContextManifest, DoneReason, ErrorKind, SessionRequest, StreamEvent,
    TurnEndReason,
};
use crate::common::error::AppError;
use crate::common::executor::factory::ExecTarget;
use crate::core::exec;

/// DeepSeek Harness adapter. Spawns the harness CLI and translates its
/// JSON-Lines output into the unified [`StreamEvent`] protocol.
pub struct DeepSeekHarnessAdapter {
    /// Command to spawn (resolved from AgentConfig).
    cmd: Vec<String>,
}

impl DeepSeekHarnessAdapter {
    /// Create a new adapter with the given command.
    #[must_use]
    pub const fn new(cmd: Vec<String>) -> Self {
        Self { cmd }
    }
}

#[async_trait]
impl AgentAdapter for DeepSeekHarnessAdapter {
    fn kind(&self) -> AgentKind {
        AgentKind::DeepSeekHarness
    }

    async fn create(&self, ctx: &AgentContext) -> Result<Box<dyn AgentSession>, AppError> {
        let target = ExecTarget::Local;
        let program = &self.cmd[0];
        let args: Vec<&str> = self.cmd[1..].iter().map(|s| s.as_str()).collect();
        let child = exec::spawn(&target, program, &args)
            .await
            .map_err(|e| AppError::Io(format!("failed to spawn harness: {e}")))?;
        let stdout = child
            .stdout
            .map(BufReader::new)
            .ok_or_else(|| AppError::Io("harness child has no stdout".into()))?;
        let mut stdin = child
            .stdin
            .ok_or_else(|| AppError::Io("harness child has no stdin".into()))?;
        let (event_tx, event_rx) = mpsc::channel(64);
        let session_id = ctx.session_id.clone();

        // 会话生命周期事件：不等 harness 回包，立即发 SessionStart（能力声明）
        // + ContextInit（上下文清单），前端据此即时渲染「会话已开始」。
        let _ = event_tx
            .send(StreamEvent::SessionStart {
                session_id: session_id.clone(),
                agent: "deepseek-harness".into(),
                model: None,
                capabilities: Capabilities {
                    approvals: true,
                    command_echo: true,
                    diff: true,
                    resume: true,
                },
            })
            .await;
        let _ = event_tx
            .send(StreamEvent::ContextInit {
                session_id: session_id.clone(),
                manifest: ContextManifest {
                    project_id: ctx.project_id.clone(),
                    project_name: ctx.project_name.clone(),
                    env: ctx.env.clone(),
                    skills: ctx.skills.clone(),
                    files: ctx.files.clone(),
                    mode: ctx.mode.clone(),
                },
            })
            .await;

        // init 请求行（§4.2：Neeko → Harness 上下文清单）。
        let init_line = serde_json::json!({
            "type": "init",
            "session_id": session_id,
            "context": {
                "project": {"id": ctx.project_id, "name": ctx.project_name},
                "env": ctx.env,
                "skills": ctx.skills,
                "files": ctx.files,
                "mode": ctx.mode,
            }
        });
        let mut init_bytes = init_line.to_string();
        init_bytes.push('\n');
        stdin
            .write_all(init_bytes.as_bytes())
            .await
            .map_err(|e| AppError::Io(format!("write init to harness stdin: {e}")))?;

        // 首个话轮：prompt 前发 TurnStart，再写 turn 请求行。
        if !ctx.prompt.is_empty() {
            let turn_id = "t1".to_string();
            let _ = event_tx
                .send(StreamEvent::TurnStart {
                    session_id: session_id.clone(),
                    turn_id: turn_id.clone(),
                })
                .await;
            let turn_line =
                serde_json::json!({"type":"turn","turn_id":turn_id,"prompt":ctx.prompt});
            let mut turn_bytes = turn_line.to_string();
            turn_bytes.push('\n');
            stdin
                .write_all(turn_bytes.as_bytes())
                .await
                .map_err(|e| AppError::Io(format!("write turn to harness stdin: {e}")))?;
        }

        // Pump task: read JSON-Lines → translate → forward.
        // 跳过 harness 的 `ready`（Neeko 已主动发 SessionStart，避免重复）。
        let sid = session_id.clone();
        tokio::spawn(async move {
            let mut lines = stdout.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let ev = translate_line(&sid, &line);
                if matches!(ev, StreamEvent::SessionStart { .. }) {
                    continue;
                }
                if event_tx.send(ev).await.is_err() {
                    break;
                }
            }
        });

        // Request channel: page→agent messages are serialized and written to
        // stdin here, so `send()` never races the pump over stdin.
        let (req_tx, mut req_rx) = mpsc::channel::<SessionRequest>(64);
        tokio::spawn(async move {
            while let Some(req) = req_rx.recv().await {
                let line = request_to_line(&req);
                let mut bytes = line.to_string();
                bytes.push('\n');
                if stdin.write_all(bytes.as_bytes()).await.is_err() {
                    break;
                }
            }
        });

        Ok(Box::new(DeepSeekSession {
            event_rx,
            request_tx: req_tx,
            resume: None,
        }))
    }
}

/// Serialize a page→agent request into the harness's JSON-Lines shape.
fn request_to_line(req: &SessionRequest) -> serde_json::Value {
    match req {
        SessionRequest::Approve { call_id, allow } => {
            serde_json::json!({"type":"approval","call_id":call_id,"allow":allow})
        }
        SessionRequest::Input { turn_id, prompt } => {
            serde_json::json!({"type":"input","turn_id":turn_id,"prompt":prompt})
        }
        // The harness currently has no per-turn model field; ignored here.
        SessionRequest::Turn { prompt, .. } => {
            serde_json::json!({"type":"turn","prompt":prompt})
        }
        SessionRequest::ContextSet { manifest } => {
            serde_json::json!({"type":"context","context":manifest})
        }
        SessionRequest::Cancel => serde_json::json!({"type":"cancel"}),
        SessionRequest::Pause => serde_json::json!({"type":"pause"}),
        SessionRequest::Resume => serde_json::json!({"type":"resume"}),
    }
}

/// A live DeepSeek Harness session.
struct DeepSeekSession {
    event_rx: mpsc::Receiver<StreamEvent>,
    request_tx: mpsc::Sender<SessionRequest>,
    resume: Option<String>,
}

#[async_trait]
impl AgentSession for DeepSeekSession {
    async fn next(&mut self) -> Option<Result<StreamEvent, AppError>> {
        self.event_rx.recv().await.map(Ok)
    }

    async fn send(&mut self, req: SessionRequest) -> Result<(), AppError> {
        self.request_tx
            .send(req)
            .await
            .map_err(|e| AppError::Io(format!("write to harness stdin: {e}")))
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

/// Translate a single JSON-Lines line into a [`StreamEvent`].
fn translate_line(session_id: &str, line: &str) -> StreamEvent {
    let val: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => {
            return StreamEvent::Error {
                session_id: session_id.into(),
                kind: ErrorKind::Protocol,
                code: "E_PARSE".into(),
                message: format!("unparseable line: {line}"),
            }
        }
    };
    let typ = val
        .get("type")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    match typ {
        "ready" => StreamEvent::SessionStart {
            session_id: session_id.into(),
            agent: "deepseek-harness".into(),
            model: None,
            capabilities: Capabilities::default(),
        },
        "turn_start" => StreamEvent::TurnStart {
            session_id: session_id.into(),
            turn_id: val
                .get("turn_id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .into(),
        },
        "turn_end" => StreamEvent::TurnEnd {
            session_id: session_id.into(),
            turn_id: val
                .get("turn_id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .into(),
            reason: match val
                .get("reason")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
            {
                "stopped" => TurnEndReason::Stopped,
                "error" => TurnEndReason::Error,
                _ => TurnEndReason::Completed,
            },
        },
        "text" => StreamEvent::TextDelta {
            session_id: session_id.into(),
            delta: val
                .get("delta")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .into(),
        },
        "tool" => {
            let call_id = val
                .get("call_id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .into();
            match val
                .get("event")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
            {
                "start" => StreamEvent::ToolStart {
                    session_id: session_id.into(),
                    call_id,
                    name: val
                        .get("name")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("")
                        .into(),
                    title: val
                        .get("title")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("")
                        .into(),
                },
                "output" => StreamEvent::ToolOutput {
                    session_id: session_id.into(),
                    call_id,
                    output: val
                        .get("output")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("")
                        .into(),
                },
                _ => StreamEvent::ToolEnd {
                    session_id: session_id.into(),
                    call_id,
                    status: val
                        .get("status")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("done")
                        .into(),
                },
            }
        }
        "approval" => StreamEvent::RequestApproval {
            session_id: session_id.into(),
            call_id: val
                .get("call_id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .into(),
            tool: val
                .get("tool")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .into(),
            title: val
                .get("title")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .into(),
            prompt: val
                .get("prompt")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .into(),
            diff: val
                .get("diff")
                .and_then(serde_json::Value::as_str)
                .map(String::from),
            cmd: val
                .get("cmd")
                .and_then(serde_json::Value::as_str)
                .map(String::from),
        },
        "command" => StreamEvent::CommandRun {
            session_id: session_id.into(),
            call_id: val
                .get("call_id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .into(),
            cwd: val
                .get("cwd")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .into(),
            cmd: val
                .get("cmd")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .into(),
        },
        "file_diff" => StreamEvent::FileDiff {
            session_id: session_id.into(),
            call_id: val
                .get("call_id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .into(),
            path: val
                .get("path")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .into(),
            diff: val
                .get("diff")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .into(),
        },
        "done" => StreamEvent::SessionDone {
            session_id: session_id.into(),
            reason: match val
                .get("reason")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
            {
                "error" => DoneReason::Error,
                "stopped" => DoneReason::Cancelled,
                _ => DoneReason::Completed,
            },
        },
        "error" => StreamEvent::Error {
            session_id: session_id.into(),
            kind: ErrorKind::Agent,
            code: val
                .get("code")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("E_UNKNOWN")
                .into(),
            message: val
                .get("message")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .into(),
        },
        _ => StreamEvent::Error {
            session_id: session_id.into(),
            kind: ErrorKind::Protocol,
            code: "E_UNKNOWN_TYPE".into(),
            message: format!("unknown event type: {typ}"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translate_text_delta() {
        let ev = translate_line("s1", r#"{"type":"text","delta":"hello"}"#);
        assert_eq!(
            ev,
            StreamEvent::TextDelta {
                session_id: "s1".into(),
                delta: "hello".into(),
            }
        );
    }

    #[test]
    fn translate_request_approval() {
        let ev = translate_line(
            "s1",
            r#"{"type":"approval","request":true,"call_id":"c2","tool":"edit_file","title":"a.rs","prompt":"ok?","diff":"@@ -1,1 +1,1 @@"}"#,
        );
        match ev {
            StreamEvent::RequestApproval {
                call_id,
                tool,
                diff,
                ..
            } => {
                assert_eq!(call_id, "c2");
                assert_eq!(tool, "edit_file");
                assert!(diff.is_some());
            }
            other => panic!("expected RequestApproval, got {other:?}"),
        }
    }

    #[test]
    fn translate_session_done() {
        let ev = translate_line("s1", r#"{"type":"done","reason":"completed"}"#);
        match ev {
            StreamEvent::SessionDone { reason, .. } => assert_eq!(reason, DoneReason::Completed),
            other => panic!("expected SessionDone, got {other:?}"),
        }
    }

    #[test]
    fn translate_unknown_type() {
        let ev = translate_line("s1", r#"{"type":"nonexistent"}"#);
        match ev {
            StreamEvent::Error { kind, .. } => assert_eq!(kind, ErrorKind::Protocol),
            other => panic!("expected Error, got {other:?}"),
        }
    }

    #[test]
    fn translate_unparseable_line() {
        let ev = translate_line("s1", "not json at all");
        match ev {
            StreamEvent::Error { kind, .. } => assert_eq!(kind, ErrorKind::Protocol),
            other => panic!("expected Error, got {other:?}"),
        }
    }
}
