//! Document translation — one-shot agent turn over the [`AgentAdapter`]
//! abstraction (adapter_for → AgentSession → AgentChatBridge), never bound to
//! a concrete agent (opencode / deepseek / ACP / future LLM API adapters).
//!
//! Differences from Agent Chat:
//! - ephemeral: no resume cursor persisted (translation results live only in
//!   the frontend view per the product consensus);
//! - events flow on [`TRANSLATION_EVENT`], a channel chat listeners ignore;
//! - sessions are still registered in the chat manager (in-memory only) so
//!   `agent_stream_cancel` can cancel an in-flight translation.

use tauri::State;

use crate::agent::chat::adapter::{adapter_for, AgentContext};
use crate::agent::chat::commands::{
    resolve_agent_config, resolve_workspace_ctx, spawn_session_pipeline,
};
use crate::agent::chat::events::TRANSLATION_EVENT;
use crate::common::agent::types::AgentConfig;
use crate::AppError;
use crate::AppStateWrapper;

/// Request body for starting a streamed translation turn.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationRequest {
    /// Agent identifier (user-selected in the translation toolbar).
    pub agent_id: String,
    /// Project identifier (binding context, same as agent chat).
    pub project_id: String,
    /// Fully assembled translation prompt (built by the frontend pipeline:
    /// target language + numbered segments + output format).
    pub prompt: String,
    /// Model ID (user-selected). `None` → agent default.
    #[serde(default)]
    pub model_id: Option<String>,
}

/// Generate a translation session id: `tr_{project_prefix}_{nanos:hex}`.
/// The `tr_` prefix marks the session as ephemeral (no resume cursor).
fn new_translation_session_id(project_id: &str) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("tr_{}_{:x}", &project_id[..8.min(project_id.len())], nanos)
}

/// Build the agent context for a translation turn (fixed `auto` mode, no
/// files / skills — the prompt carries the whole payload).
fn build_translation_context(
    req: &TranslationRequest,
    workspace: crate::common::git::WorkspaceSession,
    cwd: &str,
    project_name: &str,
    env: &str,
    session_id: &str,
) -> AgentContext {
    AgentContext {
        agent_id: req.agent_id.clone(),
        session_id: session_id.to_string(),
        cwd: cwd.to_string(),
        workspace,
        project_name: project_name.to_string(),
        env: env.to_string(),
        skills: vec![],
        files: vec![],
        mode: "auto".into(),
        prompt: req.prompt.clone(),
        model_id: req.model_id.clone(),
    }
}

/// Start a streamed translation turn. Events arrive on `translation://event`;
/// cancel with the regular `agent_stream_cancel` command.
#[tauri::command]
pub async fn translation_stream(
    req: TranslationRequest,
    state: State<'_, AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<String, AppError> {
    log::info!(
        "[translation_stream] Starting: agent_id={}, project_id={}, model_id={:?}",
        req.agent_id,
        req.project_id,
        req.model_id
    );

    let agent: AgentConfig = resolve_agent_config(&state, &req.agent_id)?;
    // 翻译通道按**项目级**发起（`TranslationRequest` 没有 worktree 维度）：用命名构造点
    // `WorkspaceSession::main` 显式声明「按主 checkout 执行」，仍走同一个解析入口 ——
    // 不手写 `WorkspaceSession { .., None }` 字面量（护栏判据 F 禁）。
    let workspace = crate::common::git::WorkspaceSession::main(req.project_id.clone());
    let (project_name, env, cwd) = resolve_workspace_ctx(&state, &workspace).await?;
    let session_id = new_translation_session_id(&req.project_id);

    // StreamRequest is the pipeline's shared shape — mirror the translation
    // request into it so the shared spawn path stays single-sourced.
    let stream_req = crate::agent::chat::commands::StreamRequest {
        agent_id: req.agent_id.clone(),
        workspace: workspace.clone(),
        prompt: req.prompt.clone(),
        files: vec![],
        skills: vec![],
        mode: Some("auto".into()),
        session_id: None,
        model_id: req.model_id.clone(),
        topic: None, // 翻译会话不产生系统通知（translate 通道不投影，见 spawn_session_pipeline）
    };

    let context =
        build_translation_context(&req, workspace, &cwd, &project_name, &env, &session_id);
    let adapter = adapter_for(&agent)?;
    let session = adapter.create(&context).await?;

    spawn_session_pipeline(
        &state,
        &app_handle,
        &stream_req,
        session_id.clone(),
        session,
        TRANSLATION_EVENT,
        None, // ephemeral: no resume cursor persisted
        &cwd,
        // 翻译会话不登记进 live-sessions（临时流），形态无意义。
        crate::live_sessions::wiring::chat::ChatRegistrationKind::Silent,
    );

    Ok(session_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translation_session_id_has_tr_prefix_and_project_hint() {
        let sid = new_translation_session_id("neeko-app");
        // 与 chat 的 ac_ 同规则：项目 id 截断到 8 字符
        assert!(sid.starts_with("tr_neeko-ap_"), "unexpected id: {sid}");
        let other = new_translation_session_id("neeko-app");
        assert_ne!(sid, other, "ids must be unique across calls");
    }

    #[test]
    fn translation_context_is_read_only_and_auto() {
        let req = TranslationRequest {
            agent_id: "opencode".into(),
            project_id: "p1".into(),
            prompt: "translate this".into(),
            model_id: Some("m1".into()),
        };
        let ctx = build_translation_context(
            &req,
            crate::common::git::WorkspaceSession::main("p1"),
            "/tmp/demo",
            "demo",
            "local",
            "tr_x_1",
        );
        assert_eq!(ctx.mode, "auto");
        assert!(ctx.files.is_empty());
        assert!(ctx.skills.is_empty());
        assert_eq!(ctx.prompt, "translate this");
        assert_eq!(ctx.model_id, Some("m1".into()));
        assert_eq!(ctx.project_name, "demo");
        assert_eq!(ctx.env, "local");
        assert_eq!(ctx.cwd, "/tmp/demo");
        // 项目级通道仍携带地址（主 checkout）—— 「没有地址」不是一种状态。
        assert_eq!(
            ctx.workspace_key(),
            crate::common::git::WorkspaceSession::main("p1").key()
        );
    }
}
