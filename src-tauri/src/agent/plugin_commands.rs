//! Tauri commands for AgentPlugin CRUD, path resolution, and deployment.

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::agent::path_resolver::PathResolver;
use crate::agent::plugin::AgentPlugin;
use crate::agent::registry::default_agent_plugins;
use crate::agent::schema_validator::validate_config;
use crate::common::runtime::run_blocking_result;
use crate::skill::skill_store::SkillStore;
use crate::AppError;
use crate::AppStateWrapper;

/// List all built-in AgentPlugin definitions.
#[tauri::command]
pub fn list_agent_plugins() -> Result<Vec<AgentPlugin>, AppError> {
    Ok(default_agent_plugins())
}

/// List all custom (user-defined) AgentPlugin records from the database.
#[tauri::command]
pub async fn list_custom_plugins(
    store: State<'_, Arc<SkillStore>>,
) -> Result<Vec<serde_json::Value>, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || store.get_custom_agent_plugins().map_err(AppError::from)).await
}

/// Get a single built-in AgentPlugin by ID.
#[tauri::command]
pub fn get_agent_plugin(plugin_id: String) -> Result<AgentPlugin, AppError> {
    default_agent_plugins()
        .into_iter()
        .find(|p| p.id == plugin_id)
        .ok_or_else(|| AppError::NotFound(format!("Plugin not found: {plugin_id}")))
}

/// Resolve a plugin's path template to an absolute path.
#[tauri::command]
pub fn resolve_plugin_path(
    plugin_id: String,
    resource_type: String,
    project_path: Option<String>,
) -> Result<String, AppError> {
    let plugin = default_agent_plugins()
        .into_iter()
        .find(|p| p.id == plugin_id)
        .ok_or_else(|| AppError::NotFound(format!("Plugin not found: {plugin_id}")))?;

    let project = project_path.as_deref().map(std::path::Path::new);
    let resolver = PathResolver::new(project).with_agent_id(&plugin_id);

    let template = match resource_type.as_str() {
        "config" => &plugin.paths.config,
        "skills" => &plugin.paths.skills,
        "commands" => &plugin.paths.commands,
        "mcp" => &plugin.paths.mcp,
        "hooks" => &plugin.paths.hooks,
        "plugins" => &plugin.paths.plugins,
        other => {
            return Err(AppError::InvalidInput(format!(
                "Unknown resource type: {other}"
            )))
        }
    };

    let resolved = resolver.resolve(template);
    Ok(resolved.to_string_lossy().to_string())
}

/// Result of detecting installed agents.
#[derive(Debug, Serialize)]
pub struct AgentDetectionResultDto {
    pub plugin_id: String,
    pub installed: bool,
    pub resolved_target: Option<String>,
}

/// Detect which built-in AgentPlugins are installed on the current machine.
#[tauri::command]
pub fn detect_installed_agents(
    project_path: Option<String>,
) -> Result<Vec<AgentDetectionResultDto>, AppError> {
    let project = project_path.as_deref().map(std::path::Path::new);
    let resolver = PathResolver::new(project);

    let mut results = Vec::new();
    for plugin in default_agent_plugins() {
        let resolved_target = plugin.execution.detection.as_ref().map(|d| {
            resolver
                .resolve_str(&d.target)
                .to_string_lossy()
                .to_string()
        });
        let installed = resolver.is_installed(&plugin);
        results.push(AgentDetectionResultDto {
            plugin_id: plugin.id,
            installed,
            resolved_target,
        });
    }

    Ok(results)
}

/// Input for deploying a skill to an agent via the plugin system.
#[derive(Debug, Deserialize)]
pub struct DeploySkillInput {
    pub skill_id: String,
    pub agent_id: String,
    pub project_path: Option<String>,
}

/// Deploy a managed skill to an agent's skills directory using the plugin system.
#[tauri::command]
pub async fn deploy_skill_to_agent(
    input: DeploySkillInput,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError> {
    let store = state.skill_store.clone();

    let plugin = default_agent_plugins()
        .into_iter()
        .find(|p| p.id == input.agent_id)
        .ok_or_else(|| AppError::NotFound(format!("Plugin not found: {}", input.agent_id)))?;

    // Resolve agent skill path override from agent manager
    let skill_path_override = {
        let am = state.agent_manager.lock().map_err(AppError::from)?;
        am.get_agent(&input.agent_id)
            .and_then(|a| a.skill_path.clone())
    };

    run_blocking_result(move || {
        let skill = store
            .get_skill_by_id(&input.skill_id)
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::NotFound(format!("Skill '{}' not found", input.skill_id)))?;

        if !skill.enabled {
            return Err(AppError::InvalidInput(format!(
                "Skill '{}' is disabled in the library",
                skill.name
            )));
        }

        let source = std::path::PathBuf::from(&skill.central_path);
        if !source.exists() {
            return Err(AppError::NotFound(format!(
                "Skill directory not found: {}",
                skill.central_path
            )));
        }

        let project = input
            .project_path
            .as_deref()
            .map(std::path::Path::new)
            .ok_or_else(|| AppError::InvalidInput("Project path required".to_string()))?;

        let resolver = PathResolver::new(Some(project)).with_agent_id(&input.agent_id);

        let skills_dir = resolver.resolve_skills_dir(&plugin, skill_path_override.as_deref());

        let dest = skills_dir.join(&skill.name);

        // Ensure parent
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(AppError::from)?;
        }

        // Remove existing
        if dest.exists() || dest.is_symlink() {
            let _ = std::fs::remove_file(&dest);
        }

        // Create symlink (or copy on non-unix)
        #[cfg(unix)]
        std::os::unix::fs::symlink(&source, &dest).map_err(AppError::from)?;
        #[cfg(not(unix))]
        {
            crate::skill::sync_engine::copy_dir_recursive(&source, &dest)
                .map_err(AppError::from)?;
        }

        // Record in skill_targets
        let target_rec = crate::skill::types::SkillTargetRecord {
            id: uuid::Uuid::new_v4().to_string(),
            skill_id: skill.id,
            tool: input.agent_id,
            target_path: dest.to_string_lossy().to_string(),
            mode: "symlink".to_string(),
            status: "ok".to_string(),
            synced_at: Some(chrono::Utc::now().timestamp_millis()),
            last_error: None,
        };
        store.insert_target(&target_rec).map_err(AppError::from)?;

        Ok(())
    })
    .await
}

/// Get all resource paths for a plugin (resolved).
#[tauri::command]
pub fn get_plugin_resource_paths(
    plugin_id: String,
    project_path: Option<String>,
) -> Result<HashMap<String, String>, AppError> {
    let plugin = default_agent_plugins()
        .into_iter()
        .find(|p| p.id == plugin_id)
        .ok_or_else(|| AppError::NotFound(format!("Plugin not found: {plugin_id}")))?;

    let project = project_path.as_deref().map(std::path::Path::new);
    let resolver = PathResolver::new(project).with_agent_id(&plugin_id);

    let mut result = HashMap::new();
    for (key, path, _project_level) in resolver.resolve_all_paths(&plugin) {
        result.insert(key, path.to_string_lossy().to_string());
    }

    Ok(result)
}

/// Input for creating / updating a custom agent plugin.
#[derive(Debug, Deserialize)]
pub struct SaveCustomPluginInput {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
    pub execution_json: String,
    pub configuration_json: String,
    pub capabilities_json: String,
    pub paths_json: String,
    pub lifecycle_json: Option<String>,
}

/// Save (insert) a custom agent plugin into the database.
#[tauri::command]
pub async fn save_custom_plugin(
    input: SaveCustomPluginInput,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    // Validate JSON blobs before persisting.
    serde_json::from_str::<serde_json::Value>(&input.execution_json)
        .map_err(|e| AppError::InvalidInput(format!("Invalid execution_json: {e}")))?;
    serde_json::from_str::<serde_json::Value>(&input.configuration_json)
        .map_err(|e| AppError::InvalidInput(format!("Invalid configuration_json: {e}")))?;
    serde_json::from_str::<serde_json::Value>(&input.capabilities_json)
        .map_err(|e| AppError::InvalidInput(format!("Invalid capabilities_json: {e}")))?;
    serde_json::from_str::<serde_json::Value>(&input.paths_json)
        .map_err(|e| AppError::InvalidInput(format!("Invalid paths_json: {e}")))?;
    if let Some(ref lifecycle) = input.lifecycle_json {
        serde_json::from_str::<serde_json::Value>(lifecycle)
            .map_err(|e| AppError::InvalidInput(format!("Invalid lifecycle_json: {e}")))?;
    }

    if input.name.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Plugin name is required".to_string(),
        ));
    }

    let store = store.inner().clone();
    run_blocking_result(move || {
        store
            .insert_agent_plugin(
                &input.id,
                &input.name,
                input.icon.as_deref(),
                input.description.as_deref(),
                input.version.as_deref().unwrap_or("1.0"),
                false,
                &input.execution_json,
                &input.configuration_json,
                &input.capabilities_json,
                &input.paths_json,
                input.lifecycle_json.as_deref(),
            )
            .map_err(AppError::from)
    })
    .await
}

/// Delete a custom agent plugin by ID. Built-in plugins cannot be deleted.
#[tauri::command]
pub async fn delete_custom_plugin(
    plugin_id: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        store
            .delete_custom_agent_plugin(&plugin_id)
            .map_err(AppError::from)
    })
    .await
}

/// Input for validating agent configuration against its schema.
#[derive(Debug, Deserialize)]
pub struct ValidateConfigInput {
    /// Plugin ID whose schema to validate against.
    pub plugin_id: String,
    /// Configuration value to validate.
    pub config: serde_json::Value,
}

/// Validate an agent configuration against its plugin schema.
///
/// Returns the config with defaults applied on success, or a list of
/// field-level validation errors.
#[tauri::command]
pub fn validate_agent_config(input: ValidateConfigInput) -> Result<serde_json::Value, AppError> {
    let plugin = default_agent_plugins()
        .into_iter()
        .find(|p| p.id == input.plugin_id)
        .ok_or_else(|| AppError::NotFound(format!("Plugin not found: {}", input.plugin_id)))?;

    match validate_config(&plugin.configuration.schema, &input.config) {
        Ok(applied) => Ok(applied),
        Err(errors) => {
            let messages: Vec<String> = errors
                .into_iter()
                .map(|e| {
                    if e.path.is_empty() {
                        e.message
                    } else {
                        format!("{}: {}", e.path, e.message)
                    }
                })
                .collect();
            Err(AppError::InvalidInput(messages.join("; ")))
        }
    }
}

/// Get the schema for a given plugin (exposed for frontend form generation).
#[tauri::command]
pub fn get_agent_schema(plugin_id: String) -> Result<serde_json::Value, AppError> {
    default_agent_plugins()
        .into_iter()
        .find(|p| p.id == plugin_id)
        .map(|p| p.configuration.schema)
        .ok_or_else(|| AppError::NotFound(format!("Plugin not found: {}", plugin_id)))
}

/// Validate a configuration value against an arbitrary schema (frontend mirror).
#[tauri::command]
pub fn validate_against_schema(
    schema: serde_json::Value,
    config: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    match validate_config(&schema, &config) {
        Ok(applied) => Ok(applied),
        Err(errors) => {
            let messages: Vec<String> = errors
                .into_iter()
                .map(|e| {
                    if e.path.is_empty() {
                        e.message
                    } else {
                        format!("{}: {}", e.path, e.message)
                    }
                })
                .collect();
            Err(AppError::InvalidInput(messages.join("; ")))
        }
    }
}
