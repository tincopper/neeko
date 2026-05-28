use crate::AppError;
use crate::AppStateWrapper;
use crate::agent::services::commit;
use crate::utils::path_resolver;
use tauri::State;

// ─── Tauri Command ──────────────────────────────────────────────────────────

/// 通过当前项目选择的 Agent CLI，根据 selected diff 和近期 commit 历史，
/// 自动生成 commit message。
#[tauri::command]
pub async fn generate_commit_message_command(
    project_id: String,
    agent_id: String,
    agent_command_override: Option<String>,
    file_paths: Vec<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<String, AppError> {
    let project_path = path_resolver::resolve_project_path(&state, &project_id)?;
    let config = resolve_agent_config(&state, &agent_id, agent_command_override.as_deref())?;
    commit::generate_commit_message(&project_path, &config, &file_paths)
}

// ─── Agent Config Bridge (State → Plain Data) ──────────────────────────────

/// 解析 agent 配置：从 agent_manager 获取 agent → 提取 prompt_args / post_prompt_args。
pub(crate) fn resolve_agent_config(
    state: &AppStateWrapper,
    agent_id: &str,
    command_override: Option<&str>,
) -> Result<commit::AgentInvokeConfig, AppError> {
    let agent_manager = state.agent_manager.lock().map_err(AppError::from)?;
    let agent = agent_manager
        .get_agent(agent_id)
        .ok_or_else(|| AppError::NotFound(format!("Agent not found: {}", agent_id)))?;

    let prompt_args = agent.resolve_prompt_args().ok_or_else(|| {
        AppError::InvalidInput(format!(
            "Agent '{}' does not support prompt mode.",
            agent.name
        ))
    })?;

    let command = command_override
        .filter(|s| !s.is_empty())
        .unwrap_or(&agent.command)
        .to_string();

    let post_prompt_args = agent.resolve_post_prompt_args();

    log::info!(
        "[AI commit] agent_id={} command={} prompt_args={:?} post_prompt_args={:?}",
        agent_id,
        command,
        prompt_args,
        post_prompt_args
    );

    Ok(commit::AgentInvokeConfig {
        command,
        prompt_args,
        post_prompt_args,
    })
}

/// WSL/SSH 场景解析 agent 配置。
///
/// `selected_agent` 可能是 agent ID 或 WSL/SSH 内的完整命令路径。
/// 返回 `(command, prompt_args, post_prompt_args)`。
pub(crate) fn resolve_agent_for_remote(
    state: &AppStateWrapper,
    selected_agent: &str,
) -> (String, Vec<String>, Vec<String>) {
    log::info!(
        "[AI commit remote] resolve_agent_for_remote: selected_agent='{}'",
        selected_agent
    );

    // 1. 按 ID 直接查找
    if let Ok(config) = resolve_agent_config(state, selected_agent, None) {
        log::info!(
            "[AI commit remote] resolved by id: command='{}' prompt_args={:?} post_prompt_args={:?}",
            selected_agent, config.prompt_args, config.post_prompt_args
        );
        return (
            selected_agent.to_string(),
            config.prompt_args,
            config.post_prompt_args,
        );
    }

    // 2. 按 ID 找不到 → 可能是完整路径，从路径提取命令名再尝试匹配
    let cmd_name = selected_agent
        .rsplit('/')
        .next()
        .unwrap_or(selected_agent)
        .trim_end_matches(".exe")
        .trim_end_matches(".cmd");

    log::info!(
        "[AI commit remote] id lookup failed, trying filename='{}'",
        cmd_name
    );

    if let Ok(config) = resolve_agent_config(state, cmd_name, None) {
        log::info!(
            "[AI commit remote] resolved by filename: command='{}' prompt_args={:?} post_prompt_args={:?}",
            selected_agent, config.prompt_args, config.post_prompt_args
        );
        return (
            selected_agent.to_string(),
            config.prompt_args,
            config.post_prompt_args,
        );
    }

    // 3. 完全未知 agent，用传入值作为命令，无 prompt_args（普通 inline 模式）
    log::info!(
        "[AI commit remote] unknown agent, using as-is: command='{}' prompt_args=[]",
        selected_agent
    );
    (selected_agent.to_string(), vec![], vec![])
}
