//! ACP adapter + in-process mockAgent end-to-end integration test.
//!
//! Drives `AcpAdapter::mock()` (in-process ACP mock over a duplex pipe,
//! `agent_chat::mock::run_mock_loop`) through the full agent-chat lifecycle:
//! SessionStart → ContextInit → TextDelta stream → ToolStart/Output/End →
//! RequestApproval (edit gate) → Approve → RequestApproval (command gate) →
//! Approve → TextDelta → TurnEnd → Cancel → SessionDone.

use neeko_lib::agent::chat::adapter::{AcpAdapter, AgentAdapter, AgentContext, AgentSession};
use neeko_lib::agent::chat::events::{SessionRequest, StreamEvent};
use neeko_lib::common::executor::factory::ExecTarget;

/// Drain non-gate events (text deltas + tool lifecycle + command echo) until
/// the next `RequestApproval`, returning its `call_id`.
async fn drain_to_gate(session: &mut dyn AgentSession) -> String {
    loop {
        let ev = session.next().await.expect("event").expect("ok");
        match ev {
            StreamEvent::TextDelta { .. }
            | StreamEvent::ToolStart { .. }
            | StreamEvent::ToolOutput { .. }
            | StreamEvent::ToolEnd { .. }
            | StreamEvent::CommandRun { .. } => continue,
            StreamEvent::RequestApproval { call_id, .. } => break call_id,
            other => panic!("expected RequestApproval, got {other:?}"),
        }
    }
}

#[tokio::test]
async fn acp_full_flow_with_in_process_mock() {
    let adapter = AcpAdapter::mock();
    let ctx = AgentContext {
        agent_id: "mockAgent".into(),
        session_id: "acp-test-1".into(),
        project_id: "p1".into(),
        project_name: "mock-project".into(),
        env: "local".into(),
        skills: vec![],
        files: vec![],
        mode: "confirm".into(),
        prompt: "hello mock".into(),
        model_id: None,
    };

    let mut session = adapter.create(&ctx).await.expect("create session");

    // 1. Lifecycle: SessionStart + ContextInit emitted by the adapter.
    let ev = session.next().await.expect("event").expect("ok");
    assert!(
        matches!(ev, StreamEvent::SessionStart { .. }),
        "expected SessionStart, got {ev:?}"
    );
    let ev = session.next().await.expect("event").expect("ok");
    assert!(
        matches!(ev, StreamEvent::ContextInit { .. }),
        "expected ContextInit, got {ev:?}"
    );

    // 2. TextDelta stream from the mock.
    let ev = session.next().await.expect("event").expect("ok");
    assert!(
        matches!(ev, StreamEvent::TextDelta { .. }),
        "expected TextDelta, got {ev:?}"
    );

    // 3. First gate: edit approval.
    let edit_call = drain_to_gate(session.as_mut()).await;
    session
        .send(SessionRequest::Approve {
            call_id: edit_call,
            allow: true,
        })
        .await
        .expect("approve edit");

    // 4. Second gate: command approval.
    let cmd_call = drain_to_gate(session.as_mut()).await;
    session
        .send(SessionRequest::Approve {
            call_id: cmd_call,
            allow: true,
        })
        .await
        .expect("approve command");

    // 5. Post-approval text + tool output/end + turn end.
    let mut saw_turn_end = false;
    for _ in 0..20 {
        let ev = session.next().await.expect("event").expect("ok");
        match ev {
            StreamEvent::TextDelta { .. }
            | StreamEvent::ToolStart { .. }
            | StreamEvent::ToolOutput { .. }
            | StreamEvent::ToolEnd { .. } => {}
            StreamEvent::TurnEnd { .. } => {
                saw_turn_end = true;
                break;
            }
            other => panic!("unexpected event mid-turn: {other:?}"),
        }
    }
    assert!(saw_turn_end, "expected TurnEnd after approvals");

    // 6. Cancel → mock exits → SessionDone.
    session.send(SessionRequest::Cancel).await.expect("cancel");
    let mut saw_done = false;
    while let Some(result) = session.next().await {
        if matches!(result.expect("ok"), StreamEvent::SessionDone { .. }) {
            saw_done = true;
            break;
        }
    }
    assert!(saw_done, "expected SessionDone after cancel");
}

/// Real OpenCode ACP round-trip test.
///
/// This test drives the real `opencode acp` command through a full conversation:
/// handshake → prompt → text response → turn end → cancel.
///
/// This is the test that verifies the actual opencode integration works.
/// It skips if `opencode` is not installed.
#[tokio::test]
async fn acp_opencode_real_roundtrip() {
    use neeko_lib::agent::chat::adapter::AcpAdapter;
    use neeko_lib::agent::chat::events::{SessionRequest, StreamEvent};

    // Skip if opencode is not available.
    if !neeko_lib::core::exec::command_exists(&ExecTarget::Local, "opencode").await {
        eprintln!("Skipping test: opencode not found");
        return;
    }

    let adapter = AcpAdapter::new(vec!["opencode".into(), "acp".into()]);
    let ctx = AgentContext {
        agent_id: "opencode".into(),
        session_id: "acp-opencode-test".into(),
        project_id: "/tmp".into(),
        project_name: "opencode-test".into(),
        env: "local".into(),
        skills: vec![],
        files: vec![],
        mode: "auto".into(),
        prompt: "Say hello in one sentence.".into(),
        model_id: None,
    };

    let mut session = adapter.create(&ctx).await.expect("create session");

    // 1. SessionStart
    let ev = session.next().await.expect("event").expect("ok");
    assert!(
        matches!(ev, StreamEvent::SessionStart { .. }),
        "expected SessionStart, got {ev:?}"
    );

    // 2. ContextInit
    let ev = session.next().await.expect("event").expect("ok");
    assert!(
        matches!(ev, StreamEvent::ContextInit { .. }),
        "expected ContextInit, got {ev:?}"
    );

    // 3. Collect text deltas and tool events until turn end.
    let mut text = String::new();
    let mut saw_turn_end = false;
    for _ in 0..100 {
        match session.next().await {
            Some(Ok(ev)) => match ev {
                StreamEvent::TextDelta { delta, .. } => text += &delta,
                StreamEvent::TurnEnd { .. } => {
                    saw_turn_end = true;
                    break;
                }
                StreamEvent::RequestApproval { call_id, .. } => {
                    // Auto-approve any gate requests.
                    session
                        .send(SessionRequest::Approve {
                            call_id,
                            allow: true,
                        })
                        .await
                        .expect("approve");
                }
                StreamEvent::Error { message, .. } => {
                    panic!("unexpected error: {message}");
                }
                _ => {}
            },
            Some(Err(e)) => panic!("session error: {e}"),
            None => break,
        }
    }

    assert!(
        !text.is_empty(),
        "expected some text response from opencode"
    );
    assert!(saw_turn_end, "expected TurnEnd from opencode");
    eprintln!("Got response: {text}");

    // 4. Cancel the session.
    session.send(SessionRequest::Cancel).await.expect("cancel");
}
