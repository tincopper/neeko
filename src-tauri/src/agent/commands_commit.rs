use crate::common::agent::services::commit as ai_svc;
use crate::common::executor::factory::ExecTarget;
use crate::common::executor::sync::exec_on;
use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

#[tauri::command]
pub async fn generate_commit_message(
    project_id: String,
    agent_id: String,
    agent_command_override: Option<String>,
    file_paths: Vec<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<String, AppError> {
    let _ = agent_command_override;

    let (agent_cmd, prompt_args, post_prompt_args) = resolve_agent_for_remote(&state, &agent_id);
    let prompt = ai_svc::build_simple_commit_prompt(&file_paths);
    let (t, wd) = state.resolve_project(&project_id)?;

    let output = match t.exec_target() {
        ExecTarget::Local => {
            run_agent_local(&state, &wd, &agent_id, agent_command_override.as_deref(), &file_paths).await?
        }
        ExecTarget::Remote { ref host, port, ref username, ref auth } => {
            run_agent_remote(&wd, &agent_cmd, &prompt_args, &post_prompt_args, &prompt, host.as_str(), port, username.as_str(), auth).await?
        }
        ExecTarget::Wsl { ref distro } => {
            run_agent_wsl(&wd, &agent_cmd, &prompt_args, &post_prompt_args, &prompt, distro).await?
        }
    };

    let message = ai_svc::clean_ai_output(&output);
    if message.is_empty() {
        return Err(AppError::InvalidInput("Agent returned an empty response.".to_string()));
    }
    Ok(message)
}

async fn run_agent_local(
    state: &AppStateWrapper,
    wd: &str,
    agent_id: &str,
    command_override: Option<&str>,
    file_paths: &[String],
) -> Result<String, AppError> {
    let sp = std::path::PathBuf::from(wd);
    let config = resolve_agent_config(state, agent_id, command_override)?;
    ai_svc::generate_commit_message(&sp, &config, file_paths).map_err(AppError::from)
}

async fn run_agent_remote(
    wd: &str,
    agent_cmd: &str,
    prompt_args: &[String],
    post_prompt_args: &[String],
    prompt: &str,
    host: &str,
    port: u16,
    username: &str,
    auth: &crate::common::connection::types::AuthMethod,
) -> Result<String, AppError> {
    let sp = crate::common::utils::command::local::safe_path(wd);
    let actual_cmd = ai_svc::build_agent_commit_cmd(&sp, agent_cmd, prompt_args, post_prompt_args, prompt);

    log::info!("[AI commit Remote] agent_cmd='{}'", agent_cmd);

    // PATH/profile loading is handled by SshExecutor (login shell).
    let target = ExecTarget::Remote {
        host: host.to_string(),
        port,
        username: username.to_string(),
        auth: auth.clone(),
    };
    match exec_on(&target, "bash", &["-c", &actual_cmd]).await {
        Ok(o) => {
            log::info!("[AI commit Remote] success, stdout_len={}", o.len());
            Ok(o)
        }
        Err(e) => {
            log::error!("[AI commit Remote] exec failed: {}", e);
            Err(AppError::InvalidInput(format!("Failed to run agent on remote: {}", e)))
        }
    }
}

async fn run_agent_wsl(
    wd: &str,
    agent_cmd: &str,
    prompt_args: &[String],
    post_prompt_args: &[String],
    prompt: &str,
    distro: &str,
) -> Result<String, AppError> {
    let sp = crate::common::utils::command::local::safe_path(wd);
    let actual_cmd = ai_svc::build_agent_commit_cmd(&sp, agent_cmd, prompt_args, post_prompt_args, prompt);

    // PATH/profile loading is handled by WslExecutor (login shell).
    let target = ExecTarget::Wsl {
        distro: distro.to_string(),
    };
    match exec_on(&target, "bash", &["-c", &actual_cmd]).await {
        Ok(o) => {
            log::info!("[AI commit WSL] success, stdout_len={}", o.len());
            Ok(o)
        }
        Err(e) => {
            log::error!("[AI commit WSL] exec failed: {}", e);
            Err(AppError::InvalidInput(format!(
                "Failed to run agent in WSL: {}",
                e
            )))
        }
    }
}

fn resolve_agent_config(
    state: &AppStateWrapper,
    agent_id: &str,
    command_override: Option<&str>,
) -> Result<ai_svc::AgentInvokeConfig, AppError> {
    let agent_manager = state.agent_manager.lock().map_err(AppError::from)?;
    let agent = agent_manager
        .get_agent(agent_id)
        .ok_or_else(|| AppError::NotFound(format!("Agent not found: {}", agent_id)))?;

    let prompt_args = agent.resolve_prompt_args().ok_or_else(|| {
        AppError::InvalidInput(format!("Agent '{}' does not support prompt mode.", agent.name))
    })?;

    let command = command_override
        .filter(|s| !s.is_empty())
        .unwrap_or(&agent.command)
        .to_string();

    let post_prompt_args = agent.resolve_post_prompt_args();
    Ok(ai_svc::AgentInvokeConfig { command, prompt_args, post_prompt_args })
}

fn resolve_agent_for_remote(
    state: &AppStateWrapper,
    selected_agent: &str,
) -> (String, Vec<String>, Vec<String>) {
    if let Ok(config) = resolve_agent_config(state, selected_agent, None) {
        return (selected_agent.to_string(), config.prompt_args, config.post_prompt_args);
    }

    let cmd_name = selected_agent
        .rsplit('/')
        .next()
        .unwrap_or(selected_agent)
        .trim_end_matches(".exe")
        .trim_end_matches(".cmd");

    if let Ok(config) = resolve_agent_config(state, cmd_name, None) {
        return (selected_agent.to_string(), config.prompt_args, config.post_prompt_args);
    }

    (selected_agent.to_string(), vec![], vec![])
}
