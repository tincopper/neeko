// ── Integration tests (real `opencode serve`, skipped by default) ───────────

use crate::agent::chat::adapter::{AgentAdapter, AgentContext};
use crate::agent::chat::events::StreamEvent;
use crate::common::executor::factory::ExecTarget;

use super::ServeAdapter;

/// Real opencode serve round-trip: create session → prompt → text deltas.
/// Marked `#[ignore]` (slow; requires `opencode` installed + a working
/// default model). Run with `cargo test -- --ignored`.
#[tokio::test]
#[ignore]
async fn serve_round_trip_streams_text_delta() {
    if !crate::core::exec::command_exists(&ExecTarget::Local, "opencode").await {
        eprintln!("Skipping: opencode not found");
        return;
    }
    let ctx = AgentContext {
        agent_id: "opencode".into(),
        session_id: "serve-integration".into(),
        cwd: std::env::temp_dir().display().to_string(),
        workspace: crate::common::git::WorkspaceSession::main("serve-integration"),
        project_name: "serve-integration".into(),
        env: "local".into(),
        skills: vec![],
        files: vec![],
        mode: "auto".into(),
        prompt: "Reply with exactly: hello".into(),
        model_id: None,
    };
    let adapter = ServeAdapter::new(vec!["opencode".into(), "serve".into()], Default::default());
    let mut session = adapter.create(&ctx).await.expect("create session");
    let mut saw_text = false;
    for _ in 0..300 {
        match session.next().await {
            Some(Ok(StreamEvent::TextDelta { delta, .. })) if !delta.is_empty() => {
                saw_text = true;
                break;
            }
            Some(Ok(StreamEvent::SessionDone { .. })) | None => break,
            Some(Ok(_)) => {}
            Some(Err(e)) => panic!("stream error: {e}"),
        }
    }
    assert!(saw_text, "expected at least one text delta");
    let _ = session.cancel().await;
}
