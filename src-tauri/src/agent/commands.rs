//! Tauri commands for agent CRUD and installation checks.

use crate::common::agent::types::{AgentConfig, ModelInfo};
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

/// List agents that support Agent Chat（声明了 CHAT 能力）。
///
/// 前端 Agent Chat 页面的 agent 列表单一事实源：只有 `chat: Some(_)` 的
/// agent 才会出现，避免把仅终端 TUI 的 agent 误展示在页面选择器里。
#[tauri::command]
pub fn list_chat_agents(state: State<AppStateWrapper>) -> Result<Vec<AgentConfig>, AppError> {
    state
        .agent_manager
        .lock()
        .map_err(AppError::from)
        .map(|am| {
            am.get_agents()
                .iter()
                .filter(|a| a.chat.is_some())
                .cloned()
                .collect()
        })
}

/// List model IDs an agent supports in Agent Chat（运行时动态发现，不持久化）。
///
/// OpenCode 执行 `opencode models --verbose` 动态发现；其他 agent 返回空列表
/// （模型是 agent 自己的事，Neeko 不管理模型配置）。
#[tauri::command]
pub async fn list_agent_models(
    agent_id: String,
    _state: State<'_, AppStateWrapper>,
) -> Result<Vec<ModelInfo>, AppError> {
    if agent_id == "opencode" {
        return crate::agent::model_discovery::discover_opencode_models(None).await;
    }
    Ok(Vec::new())
}

/// Add or update an agent and persist to config.
///
/// 内置 agent → 内存原位覆盖 + 持久化到 config.json `agentOverrides`（不写
/// `customAgents`，避免产生内置副本）；
/// 自定义 agent → 现状（`customAgents` 数组 upsert）。
#[tauri::command]
pub fn add_agent(agent: AgentConfig, state: State<AppStateWrapper>) -> Result<(), AppError> {
    let is_builtin = {
        let am = state.agent_manager.lock().map_err(AppError::from)?;
        am.is_builtin_id(&agent.id)
    };
    if is_builtin {
        // 内置：内存原位覆盖（AgentManager 保留 is_builtin 身份）+ 持久化覆盖层。
        state
            .agent_manager
            .lock()
            .map_err(AppError::from)?
            .add_agent(agent.clone());
        return state
            .storage_manager
            .save_agent_override(&agent.id, Some(&agent))
            .map_err(|e| AppError::Storage(format!("Failed to persist agent override: {e}")));
    }

    {
        let mut am = state.agent_manager.lock().map_err(AppError::from)?;
        if am.get_agent(&agent.id).is_some() {
            am.remove_agent(&agent.id);
        }
        am.add_agent(agent.clone());
    }
    // Upsert: replace existing entry with same ID, or append
    let mut custom = state.storage_manager.load_custom_agents();
    if let Some(pos) = custom
        .iter()
        .position(|a| a.get("id").and_then(|v| v.as_str()) == Some(&agent.id))
    {
        custom[pos] = serde_json::to_value(&agent).map_err(AppError::from)?;
    } else {
        custom.push(serde_json::to_value(&agent).map_err(AppError::from)?);
    }
    state
        .storage_manager
        .save_custom_agents(&custom)
        .map_err(|e| AppError::Storage(format!("Failed to persist custom agents: {e}")))
}

/// Remove an agent and persist the change.
///
/// 内置 agent → 内存恢复出厂 + 清除 config.json `agentOverrides` 覆盖（不是删除）；
/// 自定义 agent → 现状（从内存与 `customAgents` 移除）。
#[tauri::command]
pub fn remove_agent(agent_id: String, state: State<AppStateWrapper>) -> Result<(), AppError> {
    let is_builtin = {
        let am = state.agent_manager.lock().map_err(AppError::from)?;
        am.is_builtin_id(&agent_id)
    };
    if is_builtin {
        // 内置：恢复出厂（清除覆盖）。
        state
            .agent_manager
            .lock()
            .map_err(AppError::from)?
            .remove_agent(&agent_id);
        return state
            .storage_manager
            .save_agent_override(&agent_id, None)
            .map_err(|e| AppError::Storage(format!("Failed to clear agent override: {e}")));
    }
    state
        .agent_manager
        .lock()
        .map_err(AppError::from)?
        .remove_agent(&agent_id);
    let mut custom = state.storage_manager.load_custom_agents();
    custom.retain(|a| a.get("id").and_then(|v| v.as_str()) != Some(&agent_id));
    state
        .storage_manager
        .save_custom_agents(&custom)
        .map_err(|e| AppError::Storage(format!("Failed to persist custom agents: {e}")))
}

/// Set the selected agents for a project.
#[tauri::command]
pub fn set_project_agents(
    project_id: String,
    agent_ids: Vec<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .project_manager
        .lock()
        .map_err(AppError::from)?
        .set_selected_agents(&project_id, agent_ids);
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

/// Discover models supported by OpenCode.
///
/// Thin wrapper over [`crate::agent::model_discovery::discover_opencode_models`]:
/// executes `opencode models --verbose` and parses the JSON output to extract
/// model information. The actual execution + parsing lives in the domain layer.
#[tauri::command]
pub async fn discover_opencode_models(
    binary_path: Option<String>,
) -> Result<Vec<ModelInfo>, AppError> {
    crate::agent::model_discovery::discover_opencode_models(binary_path).await
}
