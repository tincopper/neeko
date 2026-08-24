//! Agent Chat — unified event protocol.
//!
//! This is the single stable surface (Contract C1) that every adapter translates
//! its native output into, and the frontend consumes. See
//! `.trellis/tasks/08-17-web-agent-page-design/design/first-principles-review.md`.

use serde::{Deserialize, Serialize};

/// Tauri event channel carrying [`StreamEvent`] to the frontend (red line 5).
pub const AGENT_CHAT_EVENT: &str = "agent-chat://event";

/// Lightweight capability declaration sent once at session start.
/// The page uses this to decide which UI (approval panel, diff panel, …) to show.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Capabilities {
    /// Whether the agent supports the approval Gate (A2).
    pub approvals: bool,
    /// Whether `CommandRun` events are emitted for Dock terminal echo.
    pub command_echo: bool,
    /// Whether `FileDiff` events are emitted.
    pub diff: bool,
    /// Whether the session supports resume via `resume_id`.
    pub resume: bool,
}

/// Context manifest bound to a session at start (and rebound on project switch).
/// This makes G4 (打通项目/文件/skills) a contract feature, not a per-adapter convention.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContextManifest {
    /// Project identifier.
    pub project_id: String,
    /// Human-readable project name.
    pub project_name: String,
    /// Execution environment: `local` | `wsl` | `ssh`.
    pub env: String,
    /// Skill IDs enabled for this session (injected into agent context).
    pub skills: Vec<String>,
    /// File paths attached as context (injected into agent context).
    pub files: Vec<String>,
    /// Approval mode: `auto` | `confirm`.
    pub mode: String,
}

/// Why a turn ended.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TurnEndReason {
    /// Turn completed normally.
    Completed,
    /// Turn was stopped by the user.
    Stopped,
    /// Turn ended due to an error.
    Error,
}

/// Why a session ended.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DoneReason {
    /// Session completed normally.
    Completed,
    /// Session was cancelled by the user.
    Cancelled,
    /// Session ended due to an error.
    Error,
}

/// Stream-level error kinds (A6).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    /// Error reported by the agent itself.
    Agent,
    /// Unparseable line / protocol violation.
    Protocol,
    /// IO / transport failure.
    Transport,
}

/// Token usage telemetry.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Usage {
    /// Input (prompt) token count, if reported by the agent.
    pub input_tokens: Option<u64>,
    /// Output (completion) token count, if reported by the agent.
    pub output_tokens: Option<u64>,
}

/// A single todo item in the agent's live plan (opencode `todo.updated`).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct TodoItem {
    /// Brief description of the task.
    pub content: String,
    /// `pending` | `in_progress` | `completed` | `cancelled`.
    pub status: String,
    /// `high` | `medium` | `low`.
    pub priority: String,
}

/// Page → agent messages, carried over the `send()` bidirectional channel (A2).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionRequest {
    /// Cancel the in-flight stream.
    Cancel,
    /// Approve or deny a pending tool call (Gate return).
    Approve {
        /// Call identifier matching the `RequestApproval`.
        call_id: String,
        /// `true` to allow, `false` to deny.
        allow: bool,
    },
    /// Send clarification input to the agent mid-turn.
    Input {
        /// Turn identifier the input belongs to.
        turn_id: String,
        /// User's clarifying message.
        prompt: String,
    },
    /// Start a new turn in an existing session (multi-turn dialogue).
    Turn {
        /// User's prompt for the new turn.
        prompt: String,
        /// Model ID selected by the user for this turn (per-turn model switching).
        /// `None` keeps the session's initial model / agent default.
        /// 仅传 ID 不传完整 ModelInfo，减少 IPC 负载（serve 适配器内部按 ID 做 slug split）。
        #[serde(default)]
        model_id: Option<String>,
    },
    /// Rebind context on project switch (A4).
    ContextSet {
        /// New context manifest to bind.
        #[serde(flatten)]
        manifest: ContextManifest,
    },
    /// Pause the stream (optional).
    Pause,
    /// Resume a paused stream (optional).
    Resume,
}

/// The unified event protocol (Contract C1). Every adapter yields these;
/// the frontend renders these. `#[serde(tag = "type")]` gives each variant a
/// discriminating `type` field for the JSON-Lines / IPC wire format.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    /// Session start + capability negotiation (A7).
    SessionStart {
        /// Opaque session identifier.
        session_id: String,
        /// Agent kind that started the session.
        agent: String,
        /// Model in use, if known.
        model: Option<String>,
        /// Capabilities the agent declares for this session.
        #[serde(default)]
        capabilities: Capabilities,
    },
    /// Context bound at session start (A4).
    ContextInit {
        /// Session identifier.
        session_id: String,
        /// Context manifest (flattened into the event).
        #[serde(flatten)]
        manifest: ContextManifest,
    },
    /// Turn boundary start (A3).
    TurnStart {
        /// Session identifier.
        session_id: String,
        /// Turn identifier.
        turn_id: String,
    },
    /// Turn boundary end (A3).
    TurnEnd {
        /// Session identifier.
        session_id: String,
        /// Turn identifier.
        turn_id: String,
        /// Why the turn ended.
        reason: TurnEndReason,
    },
    /// Streaming text delta (typewriter).
    TextDelta {
        /// Session identifier.
        session_id: String,
        /// Incremental text chunk.
        delta: String,
    },
    /// Streaming reasoning/thinking delta (model's internal reasoning).
    ReasoningDelta {
        /// Session identifier.
        session_id: String,
        /// Incremental reasoning text chunk.
        delta: String,
    },
    /// Tool call lifecycle — start.
    ToolStart {
        /// Session identifier.
        session_id: String,
        /// Call identifier for correlating start/output/end.
        call_id: String,
        /// Tool name (e.g. `read_file`, `edit_file`).
        name: String,
        /// Human-readable title (usually a file path).
        title: String,
    },
    /// Tool call lifecycle — incremental output.
    ToolOutput {
        /// Session identifier.
        session_id: String,
        /// Call identifier.
        call_id: String,
        /// Incremental tool output chunk.
        output: String,
    },
    /// Tool call lifecycle — end.
    ToolEnd {
        /// Session identifier.
        session_id: String,
        /// Call identifier.
        call_id: String,
        /// `done` | `failed`.
        status: String,
    },
    /// Gate: agent requests user approval (A2). The page shows a diff/confirm UI
    /// and replies via `SessionRequest::Approve`.
    RequestApproval {
        /// Session identifier.
        session_id: String,
        /// Call identifier for the approval response.
        call_id: String,
        /// Tool requesting approval.
        tool: String,
        /// Human-readable title.
        title: String,
        /// Explanation shown to the user.
        prompt: String,
        /// Unified diff preview, if applicable.
        #[serde(default)]
        diff: Option<String>,
        /// Command to be run, if applicable.
        #[serde(default)]
        cmd: Option<String>,
    },
    /// Gate: agent asks for clarification (A2).
    UserInput {
        /// Session identifier.
        session_id: String,
        /// Turn identifier the input belongs to.
        turn_id: String,
        /// Question posed by the agent.
        prompt: String,
    },
    /// Command the agent wants to run (optional Dock terminal echo).
    CommandRun {
        /// Session identifier.
        session_id: String,
        /// Call identifier.
        call_id: String,
        /// Working directory for the command.
        cwd: String,
        /// Command string to execute.
        cmd: String,
    },
    /// Agent's live todo list snapshot (opencode `todo.updated`).
    TodoUpdated {
        /// Session identifier.
        session_id: String,
        /// Current todo items.
        todos: Vec<TodoItem>,
    },
    /// File diff produced by the agent.
    FileDiff {
        /// Session identifier.
        session_id: String,
        /// Call identifier that produced the diff.
        call_id: String,
        /// File path the diff applies to.
        path: String,
        /// Unified diff content.
        diff: String,
    },
    /// Usage / model telemetry (A6).
    Meta {
        /// Session identifier.
        session_id: String,
        /// Model name, if known.
        #[serde(default)]
        model: Option<String>,
        /// Token usage, if reported.
        #[serde(default)]
        usage: Option<Usage>,
    },
    /// Session finished.
    SessionDone {
        /// Session identifier.
        session_id: String,
        /// Why the session ended.
        reason: DoneReason,
    },
    /// Typed stream error (A6).
    Error {
        /// Session identifier.
        session_id: String,
        /// Error kind discriminator.
        kind: ErrorKind,
        /// Machine-readable error code.
        code: String,
        /// Human-readable error message.
        message: String,
    },
}

// ── TDD: protocol contract tests (Red → Green) ────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// SessionStart serializes with the discriminating `type` field and
    /// capabilities default to falsy when absent (forward-compatible JSON).
    #[test]
    fn session_start_roundtrip() {
        let ev = StreamEvent::SessionStart {
            session_id: "s1".into(),
            agent: "deepseek-harness".into(),
            model: Some("deepseek-v4-flash".into()),
            capabilities: Capabilities {
                approvals: true,
                command_echo: true,
                diff: true,
                resume: true,
            },
        };
        let json = serde_json::to_string(&ev).expect("serialize");
        assert!(
            json.contains(r#""type":"session_start"#),
            "missing type tag: {json}"
        );
        assert!(json.contains(r#""agent":"deepseek-harness"#));
        assert!(json.contains(r#""approvals":true"#));

        let back: StreamEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, ev);
    }

    /// The approval gate round-trip (A2) — the central v3 addition.
    #[test]
    fn request_approval_roundtrip() {
        let ev = StreamEvent::RequestApproval {
            session_id: "s1".into(),
            call_id: "c2".into(),
            tool: "edit_file".into(),
            title: "src-tauri/src/agent_chat/adapter.rs".into(),
            prompt: "Apply diff?".into(),
            diff: Some("@@ -12,3 +12,7 @@".into()),
            cmd: None,
        };
        let json = serde_json::to_string(&ev).expect("serialize");
        assert!(json.contains(r#""type":"request_approval"#));
        assert!(json.contains(r#""tool":"edit_file"#));

        let back: StreamEvent = serde_json::from_str(&json).expect("deserialize");
        match &back {
            StreamEvent::RequestApproval { diff, cmd, .. } => {
                assert!(diff.is_some());
                assert!(cmd.is_none());
            }
            other => panic!("wrong variant: {other:?}"),
        }
    }

    /// SessionRequest::Approve (the page→agent Gate return) round-trips.
    #[test]
    fn session_request_approve_roundtrip() {
        let req = SessionRequest::Approve {
            call_id: "c2".into(),
            allow: true,
        };
        let json = serde_json::to_string(&req).expect("serialize");
        assert!(json.contains(r#""type":"approve"#));
        assert!(json.contains(r#""allow":true"#));

        let back: SessionRequest = serde_json::from_str(&json).expect("deserialize");
        match back {
            SessionRequest::Approve { call_id, allow } => {
                assert_eq!(call_id, "c2");
                assert!(allow);
            }
            other => panic!("wrong variant: {other:?}"),
        }
    }

    /// SessionRequest::Turn carries an optional per-turn model_id (serve transport
    /// applies it on every `prompt_async`); absent model round-trips as `None`.
    #[test]
    fn session_request_turn_roundtrips_model() {
        let req = SessionRequest::Turn {
            prompt: "next turn".into(),
            model_id: Some("anthropic/claude-sonnet-4-5".into()),
        };
        let json = serde_json::to_string(&req).expect("serialize");
        assert!(json.contains(r#""type":"turn"#));
        assert!(json.contains(r#""anthropic/claude-sonnet-4-5""#));

        let back: SessionRequest = serde_json::from_str(&json).expect("deserialize");
        match back {
            SessionRequest::Turn { prompt, model_id } => {
                assert_eq!(prompt, "next turn");
                assert_eq!(model_id.as_deref(), Some("anthropic/claude-sonnet-4-5"));
            }
            other => panic!("wrong variant: {other:?}"),
        }
    }

    /// Backwards compatible: a legacy `turn` payload without `model` still
    /// deserializes (serde default).
    #[test]
    fn session_request_turn_without_model_deserializes() {
        let json = r#"{"type":"turn","prompt":"hi"}"#;
        let back: SessionRequest = serde_json::from_str(json).expect("deserialize");
        match back {
            SessionRequest::Turn { prompt, model_id } => {
                assert_eq!(prompt, "hi");
                assert!(model_id.is_none());
            }
            other => panic!("wrong variant: {other:?}"),
        }
    }

    /// Error kind discrimination (A6).
    #[test]
    fn error_kind_roundtrip() {
        let ev = StreamEvent::Error {
            session_id: "s1".into(),
            kind: ErrorKind::Protocol,
            code: "E_PARSE".into(),
            message: "bad line".into(),
        };
        let json = serde_json::to_string(&ev).expect("serialize");
        assert!(json.contains(r#""kind":"protocol"#));

        let back: StreamEvent = serde_json::from_str(&json).expect("deserialize");
        match back {
            StreamEvent::Error { kind, .. } => assert_eq!(kind, ErrorKind::Protocol),
            other => panic!("wrong variant: {other:?}"),
        }
    }

    /// Unknown `type` must fail loudly rather than silently falling into a wrong variant.
    #[test]
    fn unknown_type_rejected() {
        let bad = r#"{"type":"nonexistent_event","session_id":"s1"}"#;
        serde_json::from_str::<StreamEvent>(bad)
            .err()
            .expect("should reject unknown type");
    }
}

// ── SequencedEvent: event reducer idempotency (P3) ────────────────────────────

/// A [`StreamEvent`] wrapped with a monotonic sequence number.
///
/// The frontend uses `seq` to deduplicate events during resume/replay: if an
/// event with the same `seq` has already been applied, it is skipped. This makes
/// the event reducer idempotent — a core requirement for reliable session
/// recovery (P3 — state consistency).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SequencedEvent {
    /// Monotonic sequence number (per-session, assigned by the bridge).
    pub seq: u64,
    /// The underlying stream event.
    #[serde(flatten)]
    pub event: StreamEvent,
}

#[cfg(test)]
mod sequenced_event_tests {
    use super::*;

    #[test]
    fn sequenced_event_serializes_with_seq_and_flattens_event() {
        let ev = SequencedEvent {
            seq: 42,
            event: StreamEvent::SessionStart {
                session_id: "s1".into(),
                agent: "deepseek-harness".into(),
                model: None,
                capabilities: Capabilities::default(),
            },
        };
        let json = serde_json::to_string(&ev).expect("serialize");
        assert!(json.contains(r#""seq":42"#));
        // serde(flatten) means the event fields are at the top level alongside seq.
        assert!(json.contains(r#""type":"session_start"#));
        assert!(json.contains(r#""session_id":"s1"#));
    }

    #[test]
    fn sequenced_event_roundtrip() {
        let ev = SequencedEvent {
            seq: 7,
            event: StreamEvent::TextDelta {
                session_id: "s1".into(),
                delta: "hello".into(),
            },
        };
        let json = serde_json::to_string(&ev).expect("serialize");
        let back: SequencedEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.seq, 7);
        assert_eq!(back, ev);
    }
}
