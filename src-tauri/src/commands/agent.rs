use crate::state::*;
use crate::AppStateWrapper;
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
pub fn get_agent(agent_id: String, state: State<AppStateWrapper>) -> Result<AgentConfig, String> {
    state
        .agent_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?
        .get_agent(&agent_id)
        .cloned()
        .ok_or_else(|| format!("Agent not found: {}", agent_id))
}

#[tauri::command]
pub fn add_agent(agent: AgentConfig, state: State<AppStateWrapper>) -> Result<(), String> {
    state
        .agent_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?
        .add_agent(agent.clone());
    let mut config = state.storage_manager.load_config().unwrap_or_default();
    let custom_agents = config
        .as_object_mut()
        .and_then(|m| {
            m.entry("customAgents")
                .or_insert(serde_json::json!([]))
                .as_array_mut()
        })
        .ok_or_else(|| "Failed to access config".to_string())?;
    if !custom_agents
        .iter()
        .any(|a| a.get("id").and_then(|v| v.as_str()) == Some(&agent.id))
    {
        custom_agents.push(serde_json::to_value(&agent).map_err(|e| e.to_string())?);
    }
    state
        .storage_manager
        .save_config(&config)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_agent(agent_id: String, state: State<AppStateWrapper>) -> Result<(), String> {
    state
        .agent_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?
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
        .map_err(|e| e.to_string())
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
