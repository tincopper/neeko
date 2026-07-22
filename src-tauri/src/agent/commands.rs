//! Tauri commands for agent CRUD and installation checks.

use crate::common::agent::types::AgentConfig;
use crate::AppError;
use crate::AppStateWrapper;
use std::collections::HashMap;
use std::path::Path;
use tauri::State;

/// List all registered agents.
#[tauri::command]
pub fn list_agents(state: State<AppStateWrapper>) -> Result<Vec<AgentConfig>, AppError> {
    state
        .agent_manager
        .lock()
        .map_err(AppError::from)
        .map(|am| am.get_agents().to_vec())
}

/// Get a single agent by ID.
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

/// Add or update an agent and persist to config.
///
/// If an agent with the same ID already exists (built-in or custom),
/// it is replaced. The change is persisted to the `customAgents` config array.
#[tauri::command]
pub fn add_agent(agent: AgentConfig, state: State<AppStateWrapper>) -> Result<(), AppError> {
    {
        let mut am = state.agent_manager.lock().map_err(AppError::from)?;
        if am.get_agent(&agent.id).is_some() {
            am.remove_agent(&agent.id);
        }
        am.add_agent(agent.clone());
    }
    let mut config = state
        .storage_manager
        .load_config()
        .map_err(|e| AppError::Storage(format!("Failed to load config: {e}")))?;
    let custom_agents = config
        .as_object_mut()
        .and_then(|m| {
            m.entry("customAgents")
                .or_insert(serde_json::json!([]))
                .as_array_mut()
        })
        .ok_or_else(|| AppError::Storage("Failed to access config".to_string()))?;
    // Upsert: replace existing entry with same ID, or append
    if let Some(pos) = custom_agents
        .iter()
        .position(|a| a.get("id").and_then(|v| v.as_str()) == Some(&agent.id))
    {
        custom_agents[pos] = serde_json::to_value(&agent).map_err(AppError::from)?;
    } else {
        custom_agents.push(serde_json::to_value(&agent).map_err(AppError::from)?);
    }
    state
        .storage_manager
        .save_config(&config)
        .map_err(AppError::from)
}

/// Remove a custom agent and persist the change.
#[tauri::command]
pub fn remove_agent(agent_id: String, state: State<AppStateWrapper>) -> Result<(), AppError> {
    {
        let am = state.agent_manager.lock().map_err(AppError::from)?;
        if let Some(agent) = am.get_agent(&agent_id) {
            if agent.is_builtin {
                return Err(AppError::InvalidInput(format!(
                    "Cannot remove builtin agent: {}",
                    agent_id
                )));
            }
        }
    }
    state
        .agent_manager
        .lock()
        .map_err(AppError::from)?
        .remove_agent(&agent_id);
    let mut config = state
        .storage_manager
        .load_config()
        .map_err(|e| AppError::Storage(format!("Failed to load config: {e}")))?;
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

/// Set the selected agent for a project.
#[tauri::command]
pub fn set_project_agent(
    project_id: String,
    agent_id: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .project_manager
        .lock()
        .map_err(AppError::from)?
        .set_selected_agent(&project_id, agent_id);
    Ok(())
}

/// Check whether agent CLIs exist in a project's execution environment.
#[tauri::command]
pub async fn check_agents_installed(
    agent_ids: Option<Vec<String>>,
    project_id: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<HashMap<String, bool>, AppError> {
    let env = match project_id.as_deref() {
        Some(pid) => state.project_environment(pid)?,
        None => state.active_project_environment()?,
    };
    let target = env.to_exec_target();

    // Snapshot under lock — never hold the mutex across await / remote checks.
    let commands = {
        let am = state.agent_manager.lock().map_err(AppError::from)?;
        let ids =
            agent_ids.unwrap_or_else(|| am.get_agents().iter().map(|a| a.id.clone()).collect());
        am.resolve_commands(&ids)
    };

    log::info!(
        "[agent] check_agents_installed env={:?} count={}",
        std::mem::discriminant(&env),
        commands.len()
    );

    Ok(crate::agent::manager::AgentManager::check_installed(&commands, &target).await)
}

/// Import an agent icon image file into the app data directory.
#[tauri::command]
pub async fn import_agent_icon(
    source_path: String,
    app_handle: tauri::AppHandle,
) -> Result<String, AppError> {
    use tauri::Manager;

    let source = Path::new(&source_path);

    // Validate source exists
    if !source.exists() {
        return Err(AppError::Io(format!(
            "Source file not found: {source_path}"
        )));
    }

    // Validate file extension
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .filter(|e| {
            matches!(
                e.as_str(),
                "png" | "jpg" | "jpeg" | "svg" | "gif" | "webp" | "ico" | "bmp"
            )
        })
        .ok_or_else(|| {
            AppError::InvalidInput(
                "Unsupported image format. Supported: png, jpg, jpeg, svg, gif, webp, ico, bmp"
                    .to_string(),
            )
        })?;

    // Validate file size (max 1MB)
    let metadata = source.metadata().map_err(AppError::from)?;
    if metadata.len() > 1_048_576 {
        return Err(AppError::InvalidInput(format!(
            "File too large ({} bytes). Maximum is 1MB.",
            metadata.len()
        )));
    }

    // Determine destination directory
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(format!("Failed to resolve app data directory: {e}")))?;
    let dest_dir = app_data_dir.join("agent-icons");
    tokio::fs::create_dir_all(&dest_dir)
        .await
        .map_err(AppError::from)?;

    // Generate unique filename
    let uuid = uuid::Uuid::new_v4();
    let dest_filename = format!("{uuid}.{ext}");
    let dest_path = dest_dir.join(&dest_filename);

    // Copy file
    tokio::fs::copy(source, &dest_path)
        .await
        .map_err(AppError::from)?;

    log::info!(
        "Imported agent icon: {source_path} -> {}",
        dest_path.display()
    );

    Ok(dest_path.to_string_lossy().to_string())
}
