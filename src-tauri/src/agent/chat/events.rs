//! Agent Chat — unified event protocol.
//!
//! This is the single stable surface (Contract C1) that every adapter translates
//! its native output into, and the frontend consumes. See
//! `.trellis/tasks/08-17-web-agent-page-design/design/first-principles-review.md`.

use serde::{Deserialize, Serialize};

/// Tauri event channel carrying [`StreamEvent`] to the frontend (red line 5).
pub const AGENT_CHAT_EVENT: &str = "agent-chat://event";

/// Tauri event channel for ephemeral document translation turns
/// (same [`StreamEvent`] protocol, separate channel so chat listeners
/// never see translation traffic and vice versa).
pub const TRANSLATION_EVENT: &str = "translation://event";

/// Lightweight capability declaration sent once at session start.
/// The page uses this to decide which UI (approval panel, diff panel, …) to show.
///
/// # 必须由 `AgentAdapter::chat_capabilities()` **派生**，不得各 adapter 手填
///
/// 历史上这里是四个互不校验的硬编码布尔：四个 adapter 全填 `approvals: true`，
/// 包括 `deepseek`（495 行里没有任何审批实现）—— 前端因此给它渲染了审批面板，
/// 而 agent 永远不发 `RequestApproval`。
///
/// 现在统一走 [`Capabilities::from_chat_capabilities`]，把「适配器声明」与
/// 「会话下发」收成一条链。新增字段时只需在 `ChatCapabilities` 加一次，
/// 这里的投影随之更新，不会有两份真相。
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
    /// 是否能列出 slash 命令（前端 `/` 补全入口的**唯一**判据）。
    #[serde(default)]
    pub commands: bool,
    /// 会话配置项的读写机制（`session_config` / `per_turn` / `none`）。
    ///
    /// 前端据此决定「配置项控件是否可见」与「写入走哪条通道」——
    /// 不再靠 `configOptions` 是否非空推断（那种推断无法区分
    /// 「不支持」与「会话还没建立」）。
    #[serde(default)]
    pub config: crate::agent::chat::capabilities::ConfigCapability,
}

impl Capabilities {
    /// 从适配器的能力快照派生（**唯一**构造入口）。
    ///
    /// `command_echo` / `diff` 是**传输特性**而非能力开关（某个 adapter 会不会
    /// 发那类事件），目前没有适配器级声明，暂由调用方传入。
    #[must_use]
    pub const fn from_chat_capabilities(
        caps: crate::agent::chat::capabilities::ChatCapabilities,
        command_echo: bool,
        diff: bool,
    ) -> Self {
        Self {
            approvals: caps.approvals,
            command_echo,
            diff,
            resume: caps.resume,
            commands: caps.commands,
            config: caps.config,
        }
    }
}

/// Context manifest bound to a session at start (and rebound on project switch).
/// This makes G4 (打通项目/文件/skills) a contract feature, not a per-adapter convention.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ContextManifest {
    /// **执行根**（agent 进程的 cwd）。不是项目 ID —— 见 `AgentContext::cwd`。
    pub cwd: String,
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
    /// 本次会话的执行地址 key（`WorkspaceSession::key()` 的产物；主 checkout 尾段为空）。
    ///
    /// **为什么是 key 而不是 `{projectId, worktreePath}` 两个字段**：分量化的 wire 形态
    /// 可独立缺失/错配（护栏 `check_workspace_session_addressing` 列为「可拆分」失真），
    /// 而仓内其余事件（`git.ts` / `file.ts`）一律只带 `workspace_key` —— 前端经
    /// `WorkspaceSession.fromKeyOrId` 这一个 codec 取分量，双端只有一种表示。
    ///
    /// 恒存在：项目级通道用 `WorkspaceSession::main` 显式声明「按主仓执行」。
    pub workspace_key: String,
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
    /// 当前上下文占用（pi `get_session_stats.contextUsage.tokens`）。
    ///
    /// 与 [`Self::input_tokens`]（会话累计）不同口径：这是当前窗口的实时估计，
    /// compaction 后到新 assistant 响应前可能为 `null`（正常降级，非错误）。
    #[serde(default)]
    pub context_tokens: Option<u64>,
    /// 模型上下文窗口上限（pi `contextUsage.contextWindow`）。
    #[serde(default)]
    pub context_limit: Option<u64>,
    /// 会话累计缓存读取 token（pi `tokens.cacheRead`）。
    #[serde(default)]
    pub cache_read_tokens: Option<u64>,
    /// 会话累计缓存写入 token（pi `tokens.cacheWrite`）。
    #[serde(default)]
    pub cache_write_tokens: Option<u64>,
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
        /// Model ID selected by the user.
        ///
        /// **语义按传输不同**：
        /// - `serve`：per-turn（每次 prompt 都带 model，可逐轮切换）；
        /// - `acp`：会话级 —— ACP 没有 per-turn 模型参数，适配器会在发 prompt **之前**
        ///   先发 `session/set_config_option`，因此语义是「本轮开始前切到这个模型」。
        ///   并发回合不可能用不同模型（协议决定的，不是实现缺陷）。
        ///
        /// `None` 保持会话当前模型 / agent 默认。
        #[serde(default)]
        model_id: Option<String>,
    },
    /// Set one session config option (ACP `session/set_config_option`).
    ///
    /// 用于 `model_config` / `thought_level` 等非模型选择器的配置项 —— 用户在下拉
    /// 旁边改「上下文大小」「推理档位」时走这条通道。模型切换**不走这里**（它是
    /// `Turn.model_id`），但两者最终发出的是同一个协议方法。
    SetConfigOption {
        /// 选项标识（`configOptions[].id`）。
        config_id: String,
        /// 目标值：select 形态给文本，boolean 形态给布尔。
        value: crate::agent::chat::adapter::acp_config::SessionConfigValue,
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
        /// Session configuration options (ACP `configOptions`).
        ///
        /// 这是**模型列表的唯一来源**：ACP 没有独立的「列模型」方法，`session/new`
        /// 响应里的 `configOptions` 就是全部信息。不把它送到前端，UI 即使在会话内
        /// 也拿不到可选项。
        ///
        /// 其余传输（serve / jsonl）不发这个字段 → 前端看到空数组，走各自路径。
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        config_options: Vec<crate::agent::chat::adapter::acp_config::SessionConfigOption>,
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
        /// 候选答案（opencode question 工具的 `options[].label`）。空 = 自由文本输入。
        /// 前端 `UserInputPanel` 据此渲染单选/多选；缺这个字段时用户只能手打答案，
        /// 而 agent 给的明明是可选项（TS 镜像 `agentChat.ts` 早已声明 `options?`，
        /// 只是 Rust 侧从来没有生产者 —— 2026-10-14 第二遍复核补齐）。
        #[serde(default)]
        options: Vec<String>,
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
    /// Agent pushed new session config options (`config_option_update`).
    ///
    /// ACP 允许 agent **主动**变更配置 —— 最典型的是 rate limit 时 fallback 到另一个
    /// 模型。不订阅它，UI 显示的当前模型会与真实会话脱节。
    ///
    /// 载荷是**全量**：协议要求整体替换，不做增量合并。
    ConfigOptionUpdate {
        /// Session identifier.
        session_id: String,
        /// Complete configuration state after the change.
        config_options: Vec<crate::agent::chat::adapter::acp_config::SessionConfigOption>,
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
            config_options: Vec::new(),
            session_id: "s1".into(),
            agent: "opencode".into(),
            model: Some("deepseek-v4-flash".into()),
            capabilities: Capabilities {
                config: crate::agent::chat::capabilities::ConfigCapability::SessionConfig,
                approvals: true,
                command_echo: true,
                diff: true,
                resume: true,
                commands: true,
            },
        };
        let json = serde_json::to_string(&ev).expect("serialize");
        assert!(
            json.contains(r#""type":"session_start"#),
            "missing type tag: {json}"
        );
        assert!(json.contains(r#""agent":"opencode"#));
        assert!(json.contains(r#""approvals":true"#));

        let back: StreamEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, ev);
    }

    /// **能力位投影必须完整**（红线 14 同源）：`from_chat_capabilities` 是
    /// 「适配器声明 → 会话下发」的唯一链路，漏投一个字段 = 前端永远拿不到它
    /// 而无任何报错。
    ///
    /// 变异验证：删掉投影里的 `commands: caps.commands` → 本用例红。
    #[test]
    fn from_chat_capabilities_projects_every_declared_field() {
        let caps = crate::agent::chat::capabilities::ChatCapabilities {
            approvals: true,
            commands: true,
            resume: true,
            ..Default::default()
        };
        let projected = Capabilities::from_chat_capabilities(caps, true, true);
        assert_eq!(projected.approvals, caps.approvals);
        assert_eq!(projected.resume, caps.resume);
        assert_eq!(
            projected.commands, caps.commands,
            "commands 必须投影到会话事件"
        );
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
        serde_json::from_str::<StreamEvent>(bad).expect_err("should reject unknown type");
    }

    /// `Usage` 的上下文/缓存字段 roundtrip（pi `get_session_stats` 语义）。
    #[test]
    fn usage_context_and_cache_fields_roundtrip() {
        let usage = Usage {
            input_tokens: Some(1234),
            output_tokens: Some(567),
            context_tokens: Some(205_000),
            context_limit: Some(1_000_000),
            cache_read_tokens: Some(197_400),
            cache_write_tokens: Some(1_200),
        };
        let json = serde_json::to_string(&usage).expect("serialize");
        assert!(json.contains("\"context_tokens\":205000"));
        assert!(json.contains("\"context_limit\":1000000"));
        assert!(json.contains("\"cache_read_tokens\":197400"));
        assert!(json.contains("\"cache_write_tokens\":1200"));

        let back: Usage = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, usage);
    }

    /// 旧 JSON（无新字段）必须能反序列化，四个新字段全为 `None`（向后兼容红线）。
    #[test]
    fn usage_legacy_json_deserializes_with_new_fields_none() {
        let legacy = r#"{"input_tokens":1,"output_tokens":2}"#;
        let usage: Usage = serde_json::from_str(legacy).expect("legacy JSON must deserialize");
        assert_eq!(usage.input_tokens, Some(1));
        assert_eq!(usage.output_tokens, Some(2));
        assert_eq!(usage.context_tokens, None);
        assert_eq!(usage.context_limit, None);
        assert_eq!(usage.cache_read_tokens, None);
        assert_eq!(usage.cache_write_tokens, None);
    }

    /// `Meta` 事件携带新 usage 字段 roundtrip（C1 线上格式）。
    #[test]
    fn meta_event_roundtrips_usage_with_context_fields() {
        let ev = StreamEvent::Meta {
            session_id: "s1".into(),
            model: Some("auto/dv4".into()),
            usage: Some(Usage {
                input_tokens: Some(1234),
                output_tokens: None,
                context_tokens: Some(205_000),
                context_limit: Some(1_000_000),
                cache_read_tokens: Some(197_400),
                cache_write_tokens: Some(1_200),
            }),
        };
        let json = serde_json::to_string(&ev).expect("serialize");
        assert!(json.contains(r#""type":"meta""#));
        let back: StreamEvent = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, ev);
    }
    /// `context_init` 的 wire 形态：地址**只**以 `workspace_key` 字符串出现（snake_case，
    /// 与 `git.ts` / `file.ts` 的 `workspace_key` 同形），`cwd` 是执行根。
    /// 前端按这个形状读，改了就是跨栈静默失配。
    #[test]
    fn manifest_carries_workspace_key_not_split_components() {
        let manifest = ContextManifest {
            cwd: "/repo/wt".into(),
            project_name: "neeko".into(),
            env: "local".into(),
            skills: vec![],
            files: vec![],
            mode: "auto".into(),
            workspace_key: crate::common::git::WorkspaceSession::of("p1", Some("/repo/wt".into()))
                .key(),
        };
        let json = serde_json::to_value(&manifest).expect("serialize");
        assert_eq!(
            json["workspace_key"],
            crate::common::git::WorkspaceSession::of("p1", Some("/repo/wt".into())).key()
        );
        assert_eq!(json["cwd"], "/repo/wt");
        // 分量化的第二个表示不得再出现在 wire 上。
        assert!(json.get("workspace").is_none());
        assert!(json.get("project_id").is_none());
    }

    /// 项目级调用（`agent_chat_context`）同样回显主 checkout 地址：
    /// 地址是**总存在的**，「没有地址」不是一种状态（否则回显缺省就得靠猜）。
    #[test]
    fn manifest_of_main_checkout_echoes_key_with_empty_tail() {
        let manifest = ContextManifest {
            cwd: "/repo".into(),
            project_name: "neeko".into(),
            env: "local".into(),
            skills: vec![],
            files: vec![],
            mode: "auto".into(),
            workspace_key: crate::common::git::WorkspaceSession::main("p1").key(),
        };
        let json = serde_json::to_value(&manifest).expect("serialize");
        assert_eq!(
            json["workspace_key"],
            crate::common::git::WorkspaceSession::main("p1").key()
        );
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
                config_options: Vec::new(),
                session_id: "s1".into(),
                agent: "opencode".into(),
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
