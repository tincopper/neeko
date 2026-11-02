//! `wiring::chat` 测试：信号映射穷举、标题优先级、批量投影的状态序列、
//! 以及用假 session 驱动 `AgentChatBridge`（有界读取，不起真进程）。

use async_trait::async_trait;

use super::*;
use crate::agent::chat::adapter::AgentSession;
use crate::agent::chat::bridge::AgentChatBridge;
use crate::agent::chat::events::{DoneReason, ErrorKind, SessionRequest, TurnEndReason};
use crate::agent::chat::session_store::SqliteSessionStore;
use crate::common::git::WorkspaceSession;
use crate::live_sessions::entry::SessionState;
use crate::live_sessions::state::Signal;
use crate::AppError;

fn fresh_registry() -> Registry {
    Registry::new(std::sync::Arc::new(
        SqliteSessionStore::open_in_memory().expect("in-memory session store"),
    ))
}

fn seq(index: u64, event: StreamEvent) -> SequencedEvent {
    SequencedEvent { seq: index, event }
}

fn session_start() -> StreamEvent {
    StreamEvent::SessionStart {
        session_id: "s1".into(),
        agent: "pi".into(),
        model: None,
        capabilities: Default::default(),
        config_options: Vec::new(),
    }
}

fn turn_start() -> StreamEvent {
    StreamEvent::TurnStart {
        session_id: "s1".into(),
        turn_id: "turn-1".into(),
    }
}

fn turn_end() -> StreamEvent {
    StreamEvent::TurnEnd {
        session_id: "s1".into(),
        turn_id: "turn-1".into(),
        reason: TurnEndReason::Completed,
    }
}

fn approval_request() -> StreamEvent {
    StreamEvent::RequestApproval {
        session_id: "s1".into(),
        call_id: "call-1".into(),
        tool: "bash".into(),
        title: "rm -rf build".into(),
        prompt: "allow?".into(),
        diff: None,
        cmd: None,
    }
}

fn error_event() -> StreamEvent {
    StreamEvent::Error {
        session_id: "s1".into(),
        kind: ErrorKind::Agent,
        code: "E_TURN_FAILED".into(),
        message: "upstream 403".into(),
    }
}

fn done_event() -> StreamEvent {
    StreamEvent::SessionDone {
        session_id: "s1".into(),
        reason: DoneReason::Completed,
    }
}

/// 信号映射按约定表逐条断言（新增 `StreamEvent` variant 时需要显式表态）。
#[test]
fn signal_of_maps_every_lifecycle_event() {
    let cases = [
        (session_start(), Some(Signal::Created)),
        (
            StreamEvent::ContextInit {
                session_id: "s1".into(),
                manifest: crate::agent::chat::events::ContextManifest {
                    cwd: "/proj".into(),
                    project_name: "proj".into(),
                    env: "local".into(),
                    skills: Vec::new(),
                    files: Vec::new(),
                    mode: "auto".into(),
                    workspace_key: WorkspaceSession::main("p1").key(),
                },
            },
            Some(Signal::Created),
        ),
        (turn_start(), Some(Signal::TurnStarted)),
        (approval_request(), Some(Signal::ApprovalRequested)),
        (
            StreamEvent::UserInput {
                session_id: "s1".into(),
                turn_id: "turn-1".into(),
                prompt: "which one?".into(),
                options: Vec::new(),
            },
            Some(Signal::ApprovalResolved),
        ),
        (turn_end(), Some(Signal::TurnFinished)),
        (error_event(), Some(Signal::Failed)),
        (done_event(), Some(Signal::Exited)),
        // 回合内容 ⇒ 在跑（pi 传输从不发 `TurnStart`，内容流动是唯一信号）。
        (
            StreamEvent::TextDelta {
                session_id: "s1".into(),
                delta: "hi".into(),
            },
            Some(Signal::TurnStarted),
        ),
        (
            StreamEvent::ToolStart {
                session_id: "s1".into(),
                call_id: "c1".into(),
                name: "bash".into(),
                title: "rm -rf build".into(),
            },
            Some(Signal::TurnStarted),
        ),
        // 纯载荷事件（元信息 / 配置）不改变状态。
        (
            StreamEvent::Meta {
                session_id: "s1".into(),
                model: None,
                usage: None,
            },
            None,
        ),
    ];
    for (event, expected) in cases {
        assert_eq!(signal_of(&event), expected, "{event:?}");
    }
}

/// `agent_chat_open` 建的**静默**会话被用户用起来时，必须在这一步变得可见。
///
/// 这是真正的主链路：`openAgentChat`（静默）→ 用户发首条消息 → `agent_stream` 命中
/// `manager.owns` 后**不进** `spawn_session_pipeline`。少了 `register_or_engage` 的第二分支，
/// 该会话的 `has_user_input` 永远是 `false`，侧栏与 tab 标题也永远不会引用它的标题。
#[test]
fn silent_session_becomes_visible_on_the_first_turn() {
    let registry = fresh_registry();
    let ws = WorkspaceSession::main("p1");
    let registration = |kind, prompt| ChatRegistration {
        session_id: "s1",
        agent_id: "pi",
        workspace: &ws,
        cwd: "/proj",
        topic: None,
        prompt,
        kind,
    };

    // 静默建连：登记但不可见（也没有标题素材）
    assert!(register_or_engage(
        &registry,
        registration(ChatRegistrationKind::Silent, "")
    ));
    let entry = &registry.snapshot()[0];
    assert!(!entry.has_user_input, "只打开 tab 不算用过");
    assert_eq!(entry.title, "", "静默建连没有标题素材");

    // 用户发出第一条消息：同一会话 id，形态变成 Turn
    assert!(register_or_engage(
        &registry,
        registration(ChatRegistrationKind::Turn, "修复登录竞态")
    ));
    let entry = &registry.snapshot()[0];
    assert!(entry.has_user_input, "发出第一条消息 ⇒ 侧栏立刻列出");
    assert_eq!(entry.title, "修复登录竞态", "补上首条 prompt 当标题");
    assert_eq!(entry.title_source, TitleSource::Prompt);
}

/// 续聊分支使用的 Engage 原语：首次补标题 + 置位，之后重复调用不改变标题。
///
/// 命令路径 `agent_stream` 命中 `manager.owns` 后不能进 `spawn_session_pipeline`
/// （那会重新登记），所以这里必须直接覆盖「Silent 已被登记、用户刚发出第一条消息」
/// 的契约，避免只测试 `register_or_engage` 而漏掉命令实际走的分支。
#[test]
fn first_engagement_titles_only_once() {
    let registry = fresh_registry();
    let ws = WorkspaceSession::main("p1");
    assert!(register_or_engage(
        &registry,
        ChatRegistration {
            session_id: "s1",
            agent_id: "pi",
            workspace: &ws,
            cwd: "/proj",
            topic: None,
            prompt: "",
            kind: ChatRegistrationKind::Silent,
        },
    ));
    assert!(!registry.snapshot()[0].has_user_input);

    assert!(registry.report_first("s1", &[(TitleSource::Prompt, "first message")]));
    let entry = &registry.snapshot()[0];
    assert!(entry.has_user_input);
    assert_eq!(entry.title, "first message");
    assert_eq!(entry.title_source, TitleSource::Prompt);

    assert!(!registry.report_first("s1", &[(TitleSource::Prompt, "second message")]));
    assert_eq!(registry.snapshot()[0].title, "first message");
}

/// 续聊不重新登记：会话在侧栏不该「闪一下」也不该改名，标题保持第一条。
#[test]
fn follow_up_turn_keeps_the_first_title_and_visibility() {
    let registry = fresh_registry();
    let ws = WorkspaceSession::main("p1");
    // 首轮：用户发出第一条消息 ⇒ 登记即可见（`Turn` 形态）
    assert!(register_or_engage(
        &registry,
        ChatRegistration {
            session_id: "s1",
            agent_id: "pi",
            workspace: &ws,
            cwd: "/proj",
            topic: None,
            prompt: "first message",
            kind: ChatRegistrationKind::Turn,
        },
    ));
    observe(
        &registry,
        "s1",
        &[seq(0, session_start()), seq(1, turn_end())],
    );
    assert!(
        registry.snapshot()[0].has_user_input,
        "发送即可见（不等 TurnEnd）"
    );

    // 续聊：同一会话 id 的第二条消息
    register_or_engage(
        &registry,
        ChatRegistration {
            session_id: "s1",
            agent_id: "pi",
            workspace: &ws,
            cwd: "/proj",
            topic: None,
            prompt: "second message",
            kind: ChatRegistrationKind::Turn,
        },
    );
    let entry = &registry.snapshot()[0];
    assert_eq!(entry.title, "first message", "会话名不随每轮改名");
    assert!(entry.has_user_input, "续聊不该把它从侧栏抹掉");
    assert_eq!(registry.snapshot().len(), 1, "续聊不重复登记");
}

/// pi 形态（无 `TurnStart`）：首个内容事件把 `Ready` 推进到 `Running`，`TurnEnd` 落回 `Ready`。
///
/// 这是「状态点永远不动」的回归钉子：只认 `TurnStart` 时，pi 会话整轮都停在 `Ready`。
#[test]
fn content_events_drive_running_without_turn_start() {
    let registry = fresh_registry();
    let ws = WorkspaceSession::main("p1");
    register_or_engage(
        &registry,
        ChatRegistration {
            session_id: "s1",
            agent_id: "pi",
            workspace: &ws,
            cwd: "/proj",
            topic: None,
            prompt: "fix the parser",
            kind: ChatRegistrationKind::Turn,
        },
    );
    assert_eq!(registry.snapshot()[0].state, SessionState::Ready);

    assert!(observe(
        &registry,
        "s1",
        &[seq(
            1,
            StreamEvent::TextDelta {
                session_id: "s1".into(),
                delta: "hel".into(),
            }
        )]
    ));
    assert_eq!(registry.snapshot()[0].state, SessionState::Running);

    // 后续增量不再 bump（`Running + TurnStarted` 幂等）。
    assert!(!observe(
        &registry,
        "s1",
        &[seq(
            2,
            StreamEvent::TextDelta {
                session_id: "s1".into(),
                delta: "lo".into(),
            }
        )]
    ));

    assert!(observe(&registry, "s1", &[seq(3, turn_end())]));
    assert_eq!(registry.snapshot()[0].state, SessionState::Ready);
}

#[test]
fn register_prefers_native_title_then_prompt_then_leaves_it_empty() {
    let ws = WorkspaceSession::of("p1", None);
    let registry = fresh_registry();
    register_or_engage(
        &registry,
        ChatRegistration {
            session_id: "s1",
            agent_id: "pi",
            workspace: &ws,
            cwd: "/proj",
            topic: Some("Native title"),
            prompt: "fix the parser",
            kind: ChatRegistrationKind::Turn,
        },
    );
    let entry = &registry.snapshot()[0];
    assert_eq!(entry.title, "Native title");
    assert_eq!(entry.title_source, TitleSource::Native);

    let registry = fresh_registry();
    register_or_engage(
        &registry,
        ChatRegistration {
            session_id: "s2",
            agent_id: "pi",
            workspace: &ws,
            cwd: "/proj",
            topic: None,
            prompt: "fix the parser",
            kind: ChatRegistrationKind::Turn,
        },
    );
    let entry = &registry.snapshot()[0];
    assert_eq!(entry.title, "fix the parser");
    assert_eq!(entry.title_source, TitleSource::Prompt);

    // 静默会话（`agent_chat_open`：无 prompt 无 topic）⇒ **空标题**，不拿 agent 名占位。
    // 视图据此只画图标（侧栏）/ 兜底 `tab.title`（tab），首条 prompt 一到就升级。
    let registry = fresh_registry();
    register_or_engage(
        &registry,
        ChatRegistration {
            session_id: "s3",
            agent_id: "pi",
            workspace: &ws,
            cwd: "/proj",
            topic: None,
            prompt: "",
            kind: ChatRegistrationKind::Silent,
        },
    );
    let entry = &registry.snapshot()[0];
    assert_eq!(entry.title, "", "不替会话编名字");
    assert_eq!(entry.title_source, TitleSource::Placeholder);
    assert_eq!(entry.agent_id.as_deref(), Some("pi"), "agent 只留给图标");
}

/// 批量投影：状态序列与「Error 之后 TurnEnd 不改写失败态」。
#[test]
fn observe_drives_the_state_sequence() {
    let registry = fresh_registry();
    let ws = WorkspaceSession::main("p1");
    register_or_engage(
        &registry,
        ChatRegistration {
            session_id: "s1",
            agent_id: "pi",
            workspace: &ws,
            cwd: "/proj",
            topic: None,
            prompt: "hello",
            kind: ChatRegistrationKind::Turn,
        },
    );

    assert!(observe(
        &registry,
        "s1",
        &[seq(0, session_start()), seq(1, turn_start())]
    ));
    assert_eq!(registry.snapshot()[0].state, SessionState::Running);

    assert!(observe(&registry, "s1", &[seq(2, approval_request())]));
    assert_eq!(registry.snapshot()[0].state, SessionState::AwaitingApproval);

    // 审批解决 → 回合继续跑。
    assert!(observe(
        &registry,
        "s1",
        &[seq(
            3,
            StreamEvent::UserInput {
                session_id: "s1".into(),
                turn_id: "turn-1".into(),
                prompt: "yes".into(),
                options: Vec::new(),
            }
        )]
    ));
    assert_eq!(registry.snapshot()[0].state, SessionState::Running);

    // 失败锁死：同一批次里的迟到 TurnEnd 不得把 Failed 改写回 Ready。
    let version_before = registry.version();
    assert!(observe(
        &registry,
        "s1",
        &[seq(4, error_event()), seq(5, turn_end())]
    ));
    assert_eq!(registry.snapshot()[0].state, SessionState::Failed);
    assert_eq!(
        registry.version(),
        version_before + 1,
        "只有真正的状态变化才 bump：迟到 TurnEnd 不得再 +1"
    );

    // 纯载荷批次不改变任何东西（不 bump）。
    let version_before = registry.version();
    assert!(!observe(
        &registry,
        "s1",
        &[seq(
            6,
            StreamEvent::TextDelta {
                session_id: "s1".into(),
                delta: "ignored".into(),
            }
        )]
    ));
    assert_eq!(registry.version(), version_before);
}

/// 假 session：脚本化事件，读完即结束（**有界**：`for _ in 0..N` 语义，
/// 不用 `while let` —— 那会在事件流不关闭时永久阻塞）。
struct ScriptedSession {
    events: Vec<StreamEvent>,
    idx: usize,
}

#[async_trait]
impl AgentSession for ScriptedSession {
    async fn next(&mut self) -> Option<Result<StreamEvent, AppError>> {
        if self.idx >= self.events.len() {
            return None;
        }
        let event = self.events[self.idx].clone();
        self.idx += 1;
        Some(Ok(event))
    }

    async fn send(&mut self, _req: SessionRequest) -> Result<(), AppError> {
        Ok(())
    }

    async fn cancel(&mut self) {}

    fn resume_id(&self) -> Option<String> {
        None
    }
}

/// 端到端接线形状：合帧 `emit` 闭包里调用 `observe`（与通知投影同级），
/// 事件按批次到达后注册表状态随之收敛。
#[tokio::test]
async fn bridge_batches_reach_the_registry() {
    let registry = std::sync::Arc::new(fresh_registry());
    let ws = WorkspaceSession::main("p1");
    register_or_engage(
        &registry,
        ChatRegistration {
            session_id: "s1",
            agent_id: "pi",
            workspace: &ws,
            cwd: "/proj",
            topic: None,
            prompt: "hello",
            kind: ChatRegistrationKind::Turn,
        },
    );

    let scripted = ScriptedSession {
        events: vec![session_start(), turn_start(), turn_end(), done_event()],
        idx: 0,
    };
    let emit_registry = std::sync::Arc::clone(&registry);
    let emit = move |batch: Vec<SequencedEvent>| {
        observe(&emit_registry, "s1", &batch);
    };

    AgentChatBridge::run("s1".into(), Box::new(scripted), emit)
        .await
        .expect("bridge run");

    // SessionDone → Exited → Stopped（回合结束先回 Ready，再被 Exited 落 Stopped）。
    assert_eq!(registry.snapshot()[0].state, SessionState::Stopped);
    assert_eq!(registry.snapshot()[0].turn_count, 1);
}
