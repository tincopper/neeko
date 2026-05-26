use crate::models::*;
use crate::AppError;
use crate::AppStateWrapper;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub fn list_agents(state: State<AppStateWrapper>) -> Vec<AgentConfig> {
    state
        .agent_manager
        .lock()
        .map(|am| am.get_agents())
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_agent(agent_id: String, state: State<AppStateWrapper>) -> Result<AgentConfig, AppError> {
    state
        .agent_manager
        .lock()
        .map_err(AppError::from)?
        .get_agent(&agent_id)
        .cloned()
        .ok_or_else(|| AppError::NotFound(format!("Agent not found: {}", agent_id)))
}

#[tauri::command]
pub fn add_agent(mut agent: AgentConfig, state: State<AppStateWrapper>) -> Result<(), AppError> {
    // 防御：用户自定义 agent 永远不能伪造 is_builtin / default_skill_path
    agent.is_builtin = false;
    agent.default_skill_path = None;
    state
        .agent_manager
        .lock()
        .map_err(AppError::from)?
        .add_agent(agent.clone());
    let mut config = state.storage_manager.load_config().unwrap_or_default();
    let custom_agents = config
        .as_object_mut()
        .and_then(|m| {
            m.entry("customAgents")
                .or_insert(serde_json::json!([]))
                .as_array_mut()
        })
        .ok_or_else(|| AppError::Storage("Failed to access config".to_string()))?;
    if !custom_agents
        .iter()
        .any(|a| a.get("id").and_then(|v| v.as_str()) == Some(&agent.id))
    {
        custom_agents.push(serde_json::to_value(&agent).map_err(AppError::from)?);
    }
    state
        .storage_manager
        .save_config(&config)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn remove_agent(agent_id: String, state: State<AppStateWrapper>) -> Result<(), AppError> {
    state
        .agent_manager
        .lock()
        .map_err(AppError::from)?
        .remove_agent(&agent_id);
    let mut config = state.storage_manager.load_config().unwrap_or_default();
    if let Some(custom_agents) = config
        .as_object_mut()
        .and_then(|m| m.get_mut("customAgents"))
        .and_then(|v| v.as_array_mut())
    {
        custom_agents.retain(|a| a.get("id").and_then(|v| v.as_str()) != Some(&agent_id));
    }
    state
        .storage_manager
        .save_config(&config)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn set_project_agent(
    project_id: String,
    agent_id: Option<String>,
    state: State<AppStateWrapper>,
) {
    if let Ok(mut pm) = state.project_manager.lock() {
        pm.set_selected_agent(&project_id, agent_id);
    }
}

#[tauri::command]
pub async fn check_agents_installed(
    agent_ids: Option<Vec<String>>,
    state: State<'_, AppStateWrapper>,
) -> Result<HashMap<String, bool>, AppError> {
    let ids = agent_ids.unwrap_or_else(|| {
        state
            .agent_manager
            .lock()
            .map(|am| am.get_agents().iter().map(|a| a.id.clone()).collect())
            .unwrap_or_default()
    });
    // Drop lock before await point
    let agents = state
        .agent_manager
        .lock()
        .map_err(AppError::from)?
        .get_agents();
    // Perform async check without holding lock
    let mut result = HashMap::new();
    for id in &ids {
        let command = agents
            .iter()
            .find(|a| a.id == *id)
            .map(|a| a.command.clone());
        let installed = match command {
            Some(cmd) => {
                tokio::task::spawn_blocking(move || crate::agent::check_command_exists(&cmd))
                    .await
                    .unwrap_or(false)
            }
            None => false,
        };
        result.insert(id.clone(), installed);
    }
    Ok(result)
}
