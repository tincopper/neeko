//! Tauri commands for MCP server CRUD, tag groups, deployment targets, and registry.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

 use crate::library::LibraryStore;
use super::types::{McpTagGroupRecord, McpServerTargetRecord};
use crate::library::skill::types::McpServerRecord;
 use crate::agent::resource_deployer::ResourceDeployer;
use crate::common::runtime::{run_blocking, run_blocking_result};
use crate::AppError;

// ─── DTOs ─────────────────────────────────────────────────────────────────

/// MCP tag group DTO returned to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct McpTagGroupDto {
    /// Unique identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
    /// Optional icon identifier.
    pub icon: Option<String>,
    /// Sort order for display.
    pub sort_order: i64,
    /// Number of servers in this group.
    pub server_count: i64,
}

/// MCP server deployment target DTO.
#[derive(Debug, Clone, Serialize)]
pub struct McpServerTargetDto {
    /// Unique identifier.
    pub id: String,
    /// MCP server identifier.
    pub server_id: String,
    /// Target agent key.
    pub agent_id: String,
    /// Absolute path to the agent's config file.
    pub target_path: String,
    /// Deployment status.
    pub status: String,
    /// Timestamp of last successful deployment.
    pub deployed_at: Option<i64>,
    /// Last error message.
    pub last_error: Option<String>,
}

/// MCP server DTO returned to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct McpServerDtoOut {
    /// Unique MCP server identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
    /// Executable command.
    pub command: String,
    /// Remote endpoint URL for http/sse transports.
    pub url: Option<String>,
    /// Command arguments.
    pub args: Vec<serde_json::Value>,
    /// Environment variables.
    pub env: HashMap<String, String>,
    /// Transport type ("stdio" or "sse").
    pub transport: String,
    /// Scope ("global" or "project").
    pub scope: String,
    /// Project id when scope = "project".
    pub project_id: Option<String>,
    /// MCP Registry source when installed from marketplace.
    pub source_registry: Option<String>,
    /// Registry-unique name matching the marketplace entry.
    pub source_ref: Option<String>,
    /// Tag names.
    pub tags: Vec<String>,
    /// Whether enabled.
    pub enabled: bool,
    /// Usage counter.
    pub usage_count: i64,
    /// Timestamp of last use.
    pub last_used_at: Option<i64>,
    /// Creation timestamp.
    pub created_at: i64,
    /// Last update timestamp.
    pub updated_at: i64,
}

fn mcp_record_to_dto(s: &McpServerRecord) -> McpServerDtoOut {
    let args: Vec<serde_json::Value> = serde_json::from_str(&s.args_json).unwrap_or_default();
    let env: HashMap<String, String> =
        serde_json::from_str(&s.env_json).unwrap_or_default();
    McpServerDtoOut {
        id: s.id.clone(),
        name: s.name.clone(),
        description: s.description.clone(),
        command: s.command.clone(),
        url: s.url.clone(),
        args,
        env,
        transport: s.transport.clone(),
        scope: s.scope.clone(),
        project_id: s.project_id.clone(),
        source_registry: s.source_registry.clone(),
        source_ref: s.source_ref.clone(),
        tags: s.tags.clone(),
        enabled: s.enabled,
        usage_count: s.usage_count,
        last_used_at: s.last_used_at,
        created_at: s.created_at,
        updated_at: s.updated_at,
    }
}

/// Input for creating an MCP server.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMcpServerInput {
    /// Display name.
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
    /// Executable command.
    pub command: String,
    /// Remote endpoint URL for http/sse transports.
    pub url: Option<String>,
    /// Command arguments.
    pub args: Option<Vec<String>>,
    /// Environment variables.
    pub env: Option<HashMap<String, String>>,
    /// Transport type ("stdio" or "sse").
    pub transport: Option<String>,
    /// Scope ("global" or "project").
    pub scope: Option<String>,
    /// Project id when scope = "project".
    pub project_id: Option<String>,
    /// MCP Registry source (e.g. "registry.modelcontextprotocol.io") when installed from marketplace.
    pub source_registry: Option<String>,
    /// Registry-unique name (e.g. "io.github.modelcontextprotocol/filesystem") matching the source.
    pub source_ref: Option<String>,
    /// Tag names.
    pub tags: Option<Vec<String>>,
}

// ─── MCP Server Commands ───────────────────────────────────────────────────

/// List all MCP servers.
#[tauri::command]
pub async fn list_mcp_servers(
    store: State<'_, Arc<LibraryStore>>,
) -> Result<Vec<McpServerDtoOut>, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let servers = store.get_all_mcp_servers().map_err(AppError::from)?;
        Ok(servers.into_iter().map(|s| mcp_record_to_dto(&s)).collect())
    })
    .await
}

/// Get a single MCP server by ID.
#[tauri::command]
pub async fn get_mcp_server(
    id: String,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<McpServerDtoOut, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let server = store
            .get_mcp_server_by_id(&id)
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::NotFound(format!("MCP server not found: {id}")))?;
        Ok(mcp_record_to_dto(&server))
    })
    .await
}

/// Create a new MCP server.
#[tauri::command]
pub async fn save_mcp_server(
    input: CreateMcpServerInput,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<McpServerDtoOut, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let now = chrono::Utc::now().timestamp_millis();
        let id = uuid::Uuid::new_v4().to_string();
        let args_json = serde_json::to_string(&input.args.unwrap_or_default())
            .unwrap_or_else(|_| "[]".to_string());
        let env_json = serde_json::to_string(&input.env.unwrap_or_default())
            .unwrap_or_else(|_| "{}".to_string());
        let server = McpServerRecord {
            id: id.clone(),
            name: input.name.clone(),
            description: input.description.clone(),
            command: input.command.clone(),
            url: input.url.clone(),
            args_json,
            env_json,
            transport: input.transport.unwrap_or_else(|| "stdio".to_string()),
            scope: input.scope.unwrap_or_else(|| "global".to_string()),
            project_id: input.project_id.clone(),
            source_registry: input.source_registry.clone(),
            source_ref: input.source_ref.clone(),
            tags: input.tags.unwrap_or_default(),
            enabled: true,
            usage_count: 0,
            last_used_at: None,
            created_at: now,
            updated_at: now,
        };
        store.insert_mcp_server(&server).map_err(AppError::from)?;
        Ok(mcp_record_to_dto(&server))
    })
    .await
}

/// Update an existing MCP server.
#[tauri::command]
pub async fn update_mcp_server_cmd(
    id: String,
    input: CreateMcpServerInput,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<McpServerDtoOut, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let mut server = store
            .get_mcp_server_by_id(&id)
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::NotFound(format!("MCP server not found: {id}")))?;
        server.name = input.name;
        server.description = input.description;
        server.command = input.command;
        if let Some(url) = input.url {
            server.url = Some(url);
        }
        if let Some(args) = input.args {
            server.args_json = serde_json::to_string(&args).unwrap_or_else(|_| "[]".to_string());
        }
        if let Some(env) = input.env {
            server.env_json = serde_json::to_string(&env).unwrap_or_else(|_| "{}".to_string());
        }
        if let Some(transport) = input.transport {
            server.transport = transport;
        }
        if let Some(scope) = input.scope {
            server.scope = scope;
        }
        server.project_id = input.project_id;
        server.source_registry = input.source_registry;
        server.source_ref = input.source_ref;
        if let Some(tags) = input.tags {
            server.tags = tags;
        }
        store.update_mcp_server(&server).map_err(AppError::from)?;
        Ok(mcp_record_to_dto(&server))
    })
    .await
}

/// Delete an MCP server by ID.
#[tauri::command]
pub async fn delete_mcp_server_cmd(
    id: String,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || store.delete_mcp_server(&id).map_err(AppError::from)).await
}

// ─── MCP Tag Group Commands ───────────────────────────────────────────────────

/// Get all MCP tag groups with server counts.
#[tauri::command]
pub async fn get_mcp_tag_groups(
    store: State<'_, Arc<LibraryStore>>,
) -> Result<Vec<McpTagGroupDto>, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let groups = store.get_all_mcp_tag_groups().map_err(AppError::from)?;
        let mut dtos: Vec<McpTagGroupDto> = Vec::new();
        for g in groups {
            let server_ids = store
                .get_servers_for_mcp_tag_group(&g.id)
                .map_err(AppError::from)?;
            dtos.push(McpTagGroupDto {
                id: g.id,
                name: g.name,
                description: g.description,
                icon: g.icon,
                sort_order: g.sort_order,
                server_count: i64::try_from(server_ids.len()).unwrap_or(i64::MAX),
            });
        }
        Ok(dtos)
    })
    .await
}

/// Create a new MCP tag group.
#[tauri::command]
pub async fn create_mcp_tag_group(
    name: String,
    description: Option<String>,
    icon: Option<String>,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<McpTagGroupDto, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();
        let group = McpTagGroupRecord {
            id: id.clone(),
            name,
            description,
            icon,
            sort_order: 0,
            created_at: now,
            updated_at: now,
        };
        store.insert_mcp_tag_group(&group).map_err(AppError::from)?;
        Ok(McpTagGroupDto {
            id,
            name: group.name,
            description: group.description,
            icon: group.icon,
            sort_order: 0,
            server_count: 0,
        })
    })
    .await
}

/// Delete an MCP tag group.
#[tauri::command]
pub async fn delete_mcp_tag_group_cmd(
    id: String,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || store.delete_mcp_tag_group(&id).map_err(AppError::from)).await
}

/// Update an MCP tag group.
#[tauri::command]
pub async fn update_mcp_tag_group_cmd(
    id: String,
    name: Option<String>,
    description: Option<String>,
    icon: Option<String>,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<McpTagGroupDto, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let mut group = store
            .get_mcp_tag_group_by_id(&id)
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::NotFound(format!("MCP tag group not found: {id}")))?;
        if let Some(n) = name {
            group.name = n;
        }
        if let Some(d) = description {
            group.description = Some(d);
        }
        if let Some(i) = icon {
            group.icon = Some(i);
        }
        store.update_mcp_tag_group(&id, &group.name, group.description.as_deref(), group.icon.as_deref()).map_err(AppError::from)?;
        let server_ids = store
            .get_servers_for_mcp_tag_group(&id)
            .map_err(AppError::from)?;
        Ok(McpTagGroupDto {
            id: group.id,
            name: group.name,
            description: group.description,
            icon: group.icon,
            sort_order: group.sort_order,
            server_count: i64::try_from(server_ids.len()).unwrap_or(i64::MAX),
        })
    })
    .await
}

/// Reorder MCP tag groups.
#[tauri::command]
pub async fn reorder_mcp_tag_groups_cmd(
    ids: Vec<String>,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || store.reorder_mcp_tag_groups(&ids).map_err(AppError::from)).await
}

/// Add a server to an MCP tag group.
#[tauri::command]
pub async fn add_server_to_mcp_tag_group_cmd(
    tag_group_id: String,
    server_id: String,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        store
            .add_server_to_mcp_tag_group(&tag_group_id, &server_id)
            .map_err(AppError::from)
    })
    .await
}

/// Remove a server from an MCP tag group.
#[tauri::command]
pub async fn remove_server_from_mcp_tag_group_cmd(
    tag_group_id: String,
    server_id: String,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        store
            .remove_server_from_mcp_tag_group(&tag_group_id, &server_id)
            .map_err(AppError::from)
    })
    .await
}

/// Get servers for an MCP tag group.
#[tauri::command]
pub async fn get_servers_for_mcp_tag_group_cmd(
    tag_group_id: String,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<Vec<McpServerDtoOut>, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let server_ids = store
            .get_servers_for_mcp_tag_group(&tag_group_id)
            .map_err(AppError::from)?;
        let mut servers = Vec::new();
        for sid in &server_ids {
            if let Some(s) = store.get_mcp_server_by_id(sid).map_err(AppError::from)? {
                servers.push(mcp_record_to_dto(&s));
            }
        }
        Ok(servers)
    })
    .await
}

/// Set the agent toggle for a server in a tag group.
#[tauri::command]
pub async fn set_mcp_server_agent_toggle_cmd(
    tag_group_id: String,
    server_id: String,
    agent_id: String,
    enabled: bool,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        store
            .set_mcp_server_agent_toggle(&tag_group_id, &server_id, &agent_id, enabled)
            .map_err(AppError::from)
    })
    .await
}

// ─── MCP Project Bindings ──────────────────────────────────────────────────

/// Get MCP tag group bindings for a project.
#[tauri::command]
pub async fn get_project_mcp_tag_groups_cmd(
    project_id: String,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<Vec<McpTagGroupDto>, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let tg_ids = store
            .get_project_mcp_tag_groups(&project_id)
            .map_err(AppError::from)?;
        let mut dtos = Vec::new();
        for tg_id in &tg_ids {
            if let Some(g) = store
                .get_mcp_tag_group_by_id(tg_id)
                .map_err(AppError::from)?
            {
                let server_ids = store
                    .get_servers_for_mcp_tag_group(tg_id)
                    .map_err(AppError::from)?;
                dtos.push(McpTagGroupDto {
                    id: g.id,
                    name: g.name,
                    description: g.description,
                    icon: g.icon,
                    sort_order: g.sort_order,
                    server_count: i64::try_from(server_ids.len()).unwrap_or(i64::MAX),
                });
            }
        }
        Ok(dtos)
    })
    .await
}

/// Set MCP tag group bindings for a project (atomic replace).
#[tauri::command]
pub async fn set_project_mcp_tag_groups_cmd(
    project_id: String,
    tag_group_ids: Vec<String>,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        store
            .set_project_mcp_tag_groups(&project_id, &tag_group_ids)
            .map_err(AppError::from)
    })
    .await
}

/// Add a single MCP tag group binding to a project.
#[tauri::command]
pub async fn add_project_mcp_tag_group_cmd(
    project_id: String,
    tag_group_id: String,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        store
            .insert_project_mcp_tag_group(&project_id, &tag_group_id)
            .map_err(AppError::from)
    })
    .await
}

/// Remove a single MCP tag group binding from a project.
#[tauri::command]
pub async fn remove_project_mcp_tag_group_cmd(
    project_id: String,
    tag_group_id: String,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        store
            .delete_project_mcp_tag_group(&project_id, &tag_group_id)
            .map_err(AppError::from)
    })
    .await
}

/// Get all project MCP tag group counts.
#[tauri::command]
pub async fn get_all_project_mcp_tag_group_counts_cmd(
    store: State<'_, Arc<LibraryStore>>,
) -> Result<Vec<(String, i64)>, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        store
            .get_all_project_mcp_tag_group_counts()
            .map_err(AppError::from)
    })
    .await
}

// ─── MCP Deployment Targets ────────────────────────────────────────────────

/// Get deployment targets for an MCP server.
#[tauri::command]
pub async fn get_mcp_server_targets_cmd(
    server_id: String,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<Vec<McpServerTargetDto>, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        let targets = store
            .get_mcp_server_targets(&server_id)
            .map_err(AppError::from)?;
        Ok(targets
            .into_iter()
            .map(|t| McpServerTargetDto {
                id: t.id,
                server_id: t.server_id,
                agent_id: t.agent_id,
                target_path: t.target_path,
                status: t.status,
                deployed_at: t.deployed_at,
                last_error: t.last_error,
            })
            .collect())
    })
    .await
}

/// Apply project-bound MCP tag groups: deploy all servers in bound tag groups
/// to the project's local agents.
#[tauri::command]
pub async fn apply_project_mcp_servers_cmd(
    project_id: String,
    project_path: String,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    let path = PathBuf::from(project_path);
    run_blocking_result(move || {
        let tg_ids = store
            .get_project_mcp_tag_groups(&project_id)
            .map_err(AppError::from)?;
        let deployer = ResourceDeployer::new();
        for tg_id in &tg_ids {
            let server_ids = store
                .get_servers_for_mcp_tag_group(tg_id)
                .map_err(AppError::from)?;
            for sid in &server_ids {
                if let Some(server) = store.get_mcp_server_by_id(sid).map_err(AppError::from)? {
                    let toggles = store
                        .get_mcp_tag_group_agent_toggles(tg_id, sid)
                        .map_err(AppError::from)?;
                    let enabled_agents: Vec<String> = if toggles.is_empty() {
                        deployer.agents_supporting("mcp")
                    } else {
                        toggles
                            .into_iter()
                            .filter(|(_, enabled)| *enabled)
                            .map(|(agent_id, _)| agent_id)
                            .collect()
                    };
                    for agent_id in &enabled_agents {
                        if let Err(e) = deployer.deploy_mcp(&server, agent_id, Some(&path)) {
                            log::error!(
                                "Failed to deploy MCP server '{}' to agent '{}': {e}",
                                server.name, agent_id
                            );
                        }
                    }
                }
            }
        }
        Ok(())
    })
    .await
}

// ─── MCP Test Command ─────────────────────────────────────────────────────

/// Result of an MCP connection test.
#[derive(Debug, Serialize)]
pub struct McpTestResult {
    /// Whether the command was found.
    pub command_found: bool,
    /// The command that was checked.
    pub command: String,
    /// Optional message.
    pub message: String,
}

/// Test an MCP server connection.
#[tauri::command]
pub async fn test_mcp_server_cmd(
    id: String,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<McpTestResult, AppError> {
    let store = store.inner().clone();
    let server = run_blocking(move || {
        store
            .get_mcp_server_by_id(&id)
            .map_err(|e| AppError::Unknown(e.to_string()))?
            .ok_or_else(|| AppError::NotFound(format!("MCP server not found: {id}")))
    })
    .await
    .map_err(|e| AppError::Unknown(format!("blocking task join error: {e}")))??;

    test_mcp_connection_logic(server).await
}

async fn test_mcp_connection_logic(
    server: McpServerRecord,
) -> Result<McpTestResult, AppError> {
    let env: HashMap<String, String> =
        serde_json::from_str(&server.env_json).unwrap_or_default();
    let args: Vec<String> = serde_json::from_str(&server.args_json).unwrap_or_default();

    let outcome = if server.transport == "http" {
        let url = server.url.as_deref().unwrap_or("");
        crate::library::mcp::mcp_probe::McpProbe::probe_http(url).await
    } else if server.transport == "sse" {
        let url = server.url.as_deref().unwrap_or("");
        crate::library::mcp::mcp_probe::McpProbe::probe_sse(url).await
    } else {
        crate::library::mcp::mcp_probe::McpProbe::probe_stdio(&server.command, &args, &env).await
    };

    Ok(McpTestResult {
        command_found: outcome.ok,
        command: String::new(),
        message: outcome.message,
    })
}

// ─── MCP Registry Commands ────────────────────────────────────────────────

/// MCP Registry search result returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRegistrySearchDto {
    /// Matching servers for the current page.
    pub servers: Vec<crate::library::mcp::mcp_registry_api::McpRegistryServerSummary>,
    /// Next pagination cursor when more pages exist.
    pub next_cursor: Option<String>,
}

/// Per-server metrics cache entry (GitHub stars + package downloads).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct McpRegistryMetricsCache {
    stars: Option<u64>,
    downloads: Option<u64>,
}

/// Search the MCP Registry marketplace (cached 5 minutes).
#[tauri::command]
pub async fn search_mcp_registry_cmd(
    query: String,
    limit: Option<usize>,
    cursor: Option<String>,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<McpRegistrySearchDto, AppError> {
    let store = store.inner().clone();
    let store_for_search = store.clone();
    let limit = limit.unwrap_or(20);
    let cache_key = format!(
        "mcp_registry_search_{}_{}_{}",
        query,
        limit,
        cursor.clone().unwrap_or_default()
    );

    // Try cache first (5 minute TTL)
    if let Ok(Some(cached)) = store.get_cache(&cache_key, 300) {
        if let Ok(dto) = serde_json::from_str::<McpRegistrySearchDto>(&cached) {
            return Ok(dto);
        }
    }

    let (servers, next_cursor) = run_blocking_result(move || {
        let proxy_url = store_for_search.get_setting("proxy_url").ok().flatten();
        crate::library::mcp::mcp_registry_api::search_registry(
            &query,
            limit,
            cursor.as_deref(),
            proxy_url.as_deref(),
        )
        .map_err(AppError::from)
    })
    .await?;

    const METRICS_CONCURRENCY: usize = 8;
    let store_for_metrics = store.clone();
    let servers = run_blocking_result(move || {
        let proxy_url = store_for_metrics.get_setting("proxy_url").ok().flatten();
        let client = crate::library::mcp::mcp_registry_api::build_http_client(proxy_url.as_deref())
            .map_err(AppError::from)?;
        let mut enriched = servers;
        for chunk in enriched.chunks_mut(METRICS_CONCURRENCY) {
            std::thread::scope(|scope| {
                for s in chunk {
                    scope.spawn(|| {
                        let mkey = format!("mcp_registry_metrics_{}", s.name);
                        if let Ok(Some(cached)) = store_for_metrics.get_cache(&mkey, 3600) {
                            if let Ok(m) = serde_json::from_str::<McpRegistryMetricsCache>(&cached)
                            {
                                s.stars = m.stars;
                                s.downloads = m.downloads;
                                return;
                            }
                        }
                        let (stars, downloads) =
                            crate::library::mcp::mcp_registry_api::fetch_server_metrics(s, &client);
                        s.stars = stars;
                        s.downloads = downloads;
                        if let Ok(json) =
                            serde_json::to_string(&McpRegistryMetricsCache { stars, downloads })
                        {
                            let _ = store_for_metrics.set_cache(&mkey, &json);
                        }
                    });
                }
            });
        }
        Ok::<_, AppError>(enriched)
    })
    .await?;

    let dto = McpRegistrySearchDto {
        servers,
        next_cursor,
    };

    if let Ok(json) = serde_json::to_string(&dto) {
        let _ = store.set_cache(&cache_key, &json);
    }

    Ok(dto)
}

/// Fetch a single MCP Registry server's full detail.
#[tauri::command]
pub async fn fetch_mcp_registry_server_cmd(
    name: String,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<crate::library::mcp::mcp_registry_api::McpRegistryServerDetail, AppError> {
    let store = store.inner().clone();
    let store_for_fetch = store.clone();
    let cache_key = format!("mcp_registry_server_{}", name);

    if let Ok(Some(cached)) = store.get_cache(&cache_key, 300) {
        if let Ok(detail) =
            serde_json::from_str::<crate::library::mcp::mcp_registry_api::McpRegistryServerDetail>(&cached)
        {
            return Ok(detail);
        }
    }

    let detail = run_blocking_result(move || {
        let proxy_url = store_for_fetch.get_setting("proxy_url").ok().flatten();
        crate::library::mcp::mcp_registry_api::fetch_server(&name, proxy_url.as_deref())
            .map_err(AppError::from)
    })
    .await?;

    if let Ok(json) = serde_json::to_string(&detail) {
        let _ = store.set_cache(&cache_key, &json);
    }

    Ok(detail)
}

// ─── MCP Deployment Commands ──────────────────────────────────────────────

/// Input for deploying an MCP server to an agent.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployMcpInput {
    /// MCP server ID.
    pub mcp_id: String,
    /// Target agent ID.
    pub agent_id: String,
    /// Optional project path for project-level deployment.
    pub project_path: Option<String>,
}

/// Deploy an MCP server to an agent's configuration file.
#[tauri::command]
pub async fn deploy_mcp_to_agent(
    input: DeployMcpInput,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    let server = run_blocking_result(move || {
        store
            .get_mcp_server_by_id(&input.mcp_id)
            .map_err(AppError::from)?
            .ok_or_else(|| AppError::NotFound(format!("MCP server not found: {}", input.mcp_id)))
    })
    .await?;

    let project = input.project_path.as_deref().map(std::path::Path::new);
    let deployer = ResourceDeployer::new();
    deployer.deploy_mcp(&server, &input.agent_id, project)?;
    Ok(())
}

/// Result of listing deployed MCP servers from an agent's config file.
#[derive(Debug, Serialize)]
pub struct DeployedMcpDto {
    /// Agent ID.
    pub agent_id: String,
    /// MCP servers found in the agent's config file.
    pub servers: Vec<serde_json::Value>,
}

/// List deployed MCP servers for a given agent (reads from disk).
#[tauri::command]
pub fn list_deployed_mcp(
    agent_id: String,
    project_path: Option<String>,
) -> Result<Vec<serde_json::Value>, AppError> {
    let project = project_path.as_deref().map(std::path::Path::new);
    let deployer = ResourceDeployer::new();
    deployer.list_deployed_mcp(&agent_id, project)
}

/// Input for removing a deployed MCP server.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveDeployedMcpInput {
    /// Server name (as stored in config).
    pub server_name: String,
    /// Agent ID.
    pub agent_id: String,
    /// Optional project path.
    pub project_path: Option<String>,
}

/// Remove an MCP server from an agent's configuration file.
#[tauri::command]
pub fn remove_deployed_mcp(input: RemoveDeployedMcpInput) -> Result<(), AppError> {
    let project = input.project_path.as_deref().map(std::path::Path::new);
    let deployer = ResourceDeployer::new();
    deployer.remove_mcp(&input.server_name, &input.agent_id, project)
}

// ─── Commands (slash commands) ───────────────────────────────────────────

/// Deploy a command (kind='command' prompt) to an agent's commands directory.
#[tauri::command]
pub async fn deploy_command_to_agent(
    input: DeployCommandInput,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    let command = run_blocking_result(move || {
        let record = store
            .get_prompt_by_id(&input.command_id)
            .map_err(AppError::from)?
            .ok_or_else(|| {
                AppError::NotFound(format!("Command not found: {}", input.command_id))
            })?;
        if record.kind != "command" {
            return Err(AppError::InvalidInput(format!(
                "Prompt '{}' is not a command (kind={})",
                input.command_id, record.kind
            )));
        }
        Ok(record)
    })
    .await?;

    let project = input.project_path.as_deref().map(std::path::Path::new);
    let deployer = ResourceDeployer::new();
    deployer.deploy_command(&command, &input.agent_id, project)?;
    Ok(())
}

/// Input for deploying a command to an agent.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployCommandInput {
    /// Prompt/command ID.
    pub command_id: String,
    /// Target agent ID.
    pub agent_id: String,
    /// Optional project path for project-level deployment.
    pub project_path: Option<String>,
}

/// List deployed command names for a given agent (reads from disk).
#[tauri::command]
pub fn list_deployed_commands(
    agent_id: String,
    project_path: Option<String>,
) -> Result<Vec<String>, AppError> {
    let project = project_path.as_deref().map(std::path::Path::new);
    let deployer = ResourceDeployer::new();
    deployer.list_deployed_commands(&agent_id, project)
}

/// Input for removing a deployed command.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveDeployedCommandInput {
    /// Command name (file stem or directory name).
    pub command_name: String,
    /// Agent ID.
    pub agent_id: String,
    /// Optional project path.
    pub project_path: Option<String>,
}

/// Remove a deployed command from an agent's commands directory.
#[tauri::command]
pub fn remove_deployed_command(input: RemoveDeployedCommandInput) -> Result<(), AppError> {
    let project = input.project_path.as_deref().map(std::path::Path::new);
    let deployer = ResourceDeployer::new();
    deployer.remove_command(&input.command_name, &input.agent_id, project)
}

/// Resource resolved from a slash command — either a prompt or a command.
#[derive(Debug, Serialize)]
pub struct SlashResourceDto {
    /// Resource kind: "prompt" or "command".
    pub kind: String,
    /// Resource ID.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Resolved content (with variables intact).
    pub content: String,
    /// Slash trigger.
    pub slash: Option<String>,
}

/// Resolve a slash command to a prompt or command (project scope overrides global).
#[tauri::command]
pub async fn resolve_slash_resource(
    slash: String,
    project_id: Option<String>,
    store: State<'_, Arc<LibraryStore>>,
) -> Result<Option<SlashResourceDto>, AppError> {
    let store = store.inner().clone();
    run_blocking_result(move || {
        for kind in ["command", "prompt"] {
            let target_kind = kind.to_string();
            let found = {
                let store_ref = &store;
                let store_ref2 = &store;
                let project_match: Option<crate::library::skill::types::PromptRecord> = store_ref
                    .get_all_prompts()
                    .map_err(AppError::from)?
                    .into_iter()
                    .find(|p| {
                        p.kind == target_kind
                            && p.slash.as_deref() == Some(slash.as_str())
                            && p.scope == "project"
                            && p.project_id.as_deref() == project_id.as_deref()
                    });
                if project_match.is_some() {
                    project_match
                } else {
                    store_ref2
                        .get_all_prompts()
                        .map_err(AppError::from)?
                        .into_iter()
                        .find(|p| {
                            p.kind == target_kind
                                && p.slash.as_deref() == Some(slash.as_str())
                                && p.scope == "global"
                        })
                }
            };
            if let Some(p) = found {
                return Ok(Some(SlashResourceDto {
                    kind: p.kind,
                    id: p.id,
                    name: p.name,
                    content: p.content,
                    slash: p.slash,
                }));
            }
        }
        Ok(None)
    })
    .await
}

/// Get agent capabilities (what resource types each agent supports).
#[tauri::command]
pub fn get_agent_capabilities(
    agent_id: String,
) -> Result<Option<crate::agent::resource_deployer::AgentCapabilitiesDto>, AppError> {
    let deployer = ResourceDeployer::new();
    Ok(deployer.agent_capabilities(&agent_id))
}

/// List agent IDs that support a given capability.
#[tauri::command]
#[must_use]
pub fn list_agents_supporting(capability: String) -> Vec<String> {
    let deployer = ResourceDeployer::new();
    deployer.agents_supporting(&capability)
}

#[cfg(test)]
mod mcp_test_logic_tests {
    use super::*;

    fn remote_server(url: Option<&str>, transport: &str) -> McpServerRecord {
        McpServerRecord {
            id: "mcp-test".to_string(),
            name: "remote-server".to_string(),
            description: None,
            command: String::new(),
            url: url.map(str::to_string),
            args_json: "[]".to_string(),
            env_json: "{}".to_string(),
            transport: transport.to_string(),
            scope: "global".to_string(),
            project_id: None,
            source_registry: None,
            source_ref: None,
            tags: vec![],
            enabled: true,
            usage_count: 0,
            last_used_at: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    #[tokio::test]
    async fn remote_http_server_with_url_reports_ready() {
        let server = remote_server(Some("https://mcp.example.com/mcp"), "http");
        let result = test_mcp_connection_logic(server).await.unwrap();
        assert!(!result.command_found, "message: {}", result.message);
    }

    #[tokio::test]
    async fn remote_sse_server_with_url_reports_ready() {
        let server = remote_server(Some("https://mcp.example.com/sse"), "sse");
        let result = test_mcp_connection_logic(server).await.unwrap();
        assert!(!result.command_found);
    }

    #[tokio::test]
    async fn remote_http_server_without_url_errors() {
        let server = remote_server(None, "http");
        let result = test_mcp_connection_logic(server).await.unwrap();
        assert!(!result.command_found);
        assert!(result.message.contains("URL is required"));
    }

    #[tokio::test]
    async fn remote_http_server_with_non_http_url_errors() {
        let server = remote_server(Some("ftp://example.com/mcp"), "http");
        let result = test_mcp_connection_logic(server).await.unwrap();
        assert!(!result.command_found);
        assert!(result.message.contains("must start with"));
    }

    #[tokio::test]
    async fn stdio_server_still_checks_command() {
        let mut server = remote_server(None, "stdio");
        server.command = "__neeko_definitely_missing_cmd__".to_string();
        let result = test_mcp_connection_logic(server).await.unwrap();
        assert!(!result.command_found);
        assert!(
            result.message.contains("Failed to launch") || result.message.contains("not found")
        );
    }

    // ─── DTO conversion tests ──────────────────────────────────────────────

    fn make_mcp_record() -> McpServerRecord {
        McpServerRecord {
            id: "test-id".to_string(),
            name: "test-server".to_string(),
            description: Some("A test server".to_string()),
            command: "npx".to_string(),
            url: None,
            args_json: r#"["-y","@modelcontextprotocol/server-filesystem"]"#.to_string(),
            env_json: r#"{"KEY":"value"}"#.to_string(),
            transport: "stdio".to_string(),
            scope: "global".to_string(),
            project_id: None,
            source_registry: None,
            source_ref: None,
            tags: vec!["fs".to_string()],
            enabled: true,
            usage_count: 5,
            last_used_at: Some(1234567890),
            created_at: 1000,
            updated_at: 2000,
        }
    }

    #[test]
    fn mcp_record_to_dto_preserves_all_fields() {
        let record = make_mcp_record();
        let dto = mcp_record_to_dto(record);
        assert_eq!(dto.id, "test-id");
        assert_eq!(dto.name, "test-server");
        assert_eq!(dto.description.as_deref(), Some("A test server"));
        assert_eq!(dto.command, "npx");
        assert_eq!(dto.url, None);
        assert_eq!(dto.transport, "stdio");
        assert_eq!(dto.scope, "global");
        assert_eq!(dto.project_id, None);
        assert!(dto.enabled);
        assert_eq!(dto.usage_count, 5);
        assert_eq!(dto.last_used_at, Some(1234567890));
        assert_eq!(dto.tags, vec!["fs".to_string()]);
    }

    #[test]
    fn mcp_record_to_dto_parses_args_and_env() {
        let record = make_mcp_record();
        let dto = mcp_record_to_dto(record);
        assert_eq!(dto.args.len(), 2);
        assert_eq!(dto.args[0], "-y");
        assert_eq!(dto.args[1], "@modelcontextprotocol/server-filesystem");
        assert_eq!(dto.env.get("KEY").map(String::as_str), Some("value"));
    }

    #[test]
    fn mcp_record_to_dto_invalid_json_falls_back_to_defaults() {
        let mut record = make_mcp_record();
        record.args_json = "not valid json".to_string();
        record.env_json = "also not valid".to_string();
        let dto = mcp_record_to_dto(record);
        assert!(dto.args.is_empty(), "invalid args_json should fall back to empty vec");
        assert!(dto.env.is_empty(), "invalid env_json should fall back to empty map");
        // Other fields must still be preserved
        assert_eq!(dto.name, "test-server");
        assert_eq!(dto.command, "npx");
    }

    #[test]
    fn mcp_record_to_dto_empty_args_and_env() {
        let mut record = make_mcp_record();
        record.args_json = "[]".to_string();
        record.env_json = "{}".to_string();
        let dto = mcp_record_to_dto(record);
        assert!(dto.args.is_empty());
        assert!(dto.env.is_empty());
    }

    #[test]
    fn mcp_record_to_dto_preserves_timestamps() {
        let record = make_mcp_record();
        let dto = mcp_record_to_dto(record);
        assert_eq!(dto.created_at, 1000);
        assert_eq!(dto.updated_at, 2000);
    }

    // ─── Input deserialization tests ───────────────────────────────────────

    #[test]
    fn create_server_input_defaults_from_minimal_json() {
        let json = r#"{"name":"test","command":"npx"}"#;
        let input: CreateMcpServerInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.name, "test");
        assert_eq!(input.command, "npx");
        assert_eq!(input.args, None);
        assert_eq!(input.env, None);
        assert_eq!(input.transport, None);
        assert_eq!(input.scope, None);
        assert_eq!(input.project_id, None);
        assert_eq!(input.source_registry, None);
        assert_eq!(input.source_ref, None);
        assert_eq!(input.tags, None);
        assert_eq!(input.description, None);
        assert_eq!(input.url, None);
    }

    #[test]
    fn create_server_input_parses_all_fields() {
        let json = r#"{
            "name": "fs",
            "description": "Filesystem server",
            "command": "npx",
            "url": null,
            "args": ["-y", "@modelcontextprotocol/server-filesystem"],
            "env": {"TOKEN": "abc"},
            "transport": "stdio",
            "scope": "project",
            "projectId": "proj-123",
            "sourceRegistry": "registry.modelcontextprotocol.io",
            "sourceRef": "io.github.modelcontextprotocol/filesystem",
            "tags": ["fs", "local"]
        }"#;
        let input: CreateMcpServerInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.name, "fs");
        assert_eq!(input.description.as_deref(), Some("Filesystem server"));
        assert_eq!(input.command, "npx");
        assert_eq!(input.args.as_deref(), Some(&["-y".to_string(), "@modelcontextprotocol/server-filesystem".to_string()][..]));
        assert_eq!(input.env.as_ref().unwrap().get("TOKEN").map(String::as_str), Some("abc"));
        assert_eq!(input.transport.as_deref(), Some("stdio"));
        assert_eq!(input.scope.as_deref(), Some("project"));
        assert_eq!(input.project_id.as_deref(), Some("proj-123"));
        assert_eq!(input.source_registry.as_deref(), Some("registry.modelcontextprotocol.io"));
        assert_eq!(input.source_ref.as_deref(), Some("io.github.modelcontextprotocol/filesystem"));
        assert_eq!(input.tags.as_deref(), Some(&["fs".to_string(), "local".to_string()][..]));
    }

    #[test]
    fn deploy_mcp_input_round_trip() {
        let input = DeployMcpInput {
            mcp_id: "mcp-1".to_string(),
            agent_id: "claude".to_string(),
            project_path: Some("/Users/test/project".to_string()),
        };
        let json = serde_json::to_string(&input).unwrap();
        let parsed: DeployMcpInput = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.mcp_id, "mcp-1");
        assert_eq!(parsed.agent_id, "claude");
        assert_eq!(parsed.project_path.as_deref(), Some("/Users/test/project"));
    }

    #[test]
    fn deploy_command_input_round_trip() {
        let input = DeployCommandInput {
            command_id: "cmd-1".to_string(),
            agent_id: "gemini".to_string(),
            project_path: None,
        };
        let json = serde_json::to_string(&input).unwrap();
        let parsed: DeployCommandInput = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.command_id, "cmd-1");
        assert_eq!(parsed.agent_id, "gemini");
        assert_eq!(parsed.project_path, None);
    }

    #[test]
    fn remove_deployed_mcp_input_round_trip() {
        let input = RemoveDeployedMcpInput {
            server_name: "my-server".to_string(),
            agent_id: "codex".to_string(),
            project_path: Some("/tmp/proj".to_string()),
        };
        let json = serde_json::to_string(&input).unwrap();
        let parsed: RemoveDeployedMcpInput = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.server_name, "my-server");
        assert_eq!(parsed.agent_id, "codex");
        assert_eq!(parsed.project_path.as_deref(), Some("/tmp/proj"));
    }

    #[test]
    fn remove_deployed_command_input_round_trip() {
        let input = RemoveDeployedCommandInput {
            command_name: "my-cmd".to_string(),
            agent_id: "opencode".to_string(),
            project_path: None,
        };
        let json = serde_json::to_string(&input).unwrap();
        let parsed: RemoveDeployedCommandInput = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.command_name, "my-cmd");
        assert_eq!(parsed.agent_id, "opencode");
        assert_eq!(parsed.project_path, None);
    }

    // ─── Output DTO tests ──────────────────────────────────────────────────

    #[test]
    fn mcp_test_result_serialization() {
        let result = McpTestResult {
            command_found: true,
            command: "npx".to_string(),
            message: "ready".to_string(),
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["command_found"], true);
        assert_eq!(json["command"], "npx");
        assert_eq!(json["message"], "ready");
    }

    #[test]
    fn mcp_test_result_serialization_false_command_found() {
        let result = McpTestResult {
            command_found: false,
            command: "missing".to_string(),
            message: "not found".to_string(),
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["command_found"], false);
        assert_eq!(json["command"], "missing");
    }

    #[test]
    fn mcp_tag_group_dto_clone_and_debug() {
        let dto = McpTagGroupDto {
            id: "tg-1".to_string(),
            name: "My Group".to_string(),
            description: Some("desc".to_string()),
            icon: Some("folder".to_string()),
            sort_order: 3,
            server_count: 7,
        };
        let cloned = dto.clone();
        assert_eq!(cloned.id, dto.id);
        assert_eq!(cloned.server_count, 7);
        // Debug trait must be implemented
        let debug = format!("{:?}", dto);
        assert!(debug.contains("McpTagGroupDto"));
    }

    #[test]
    fn mcp_server_target_dto_clone_and_debug() {
        let dto = McpServerTargetDto {
            id: "tgt-1".to_string(),
            server_id: "srv-1".to_string(),
            agent_id: "claude".to_string(),
            target_path: "/home/user/.claude.json".to_string(),
            status: "success".to_string(),
            deployed_at: Some(1234567890),
            last_error: None,
        };
        let cloned = dto.clone();
        assert_eq!(cloned.id, dto.id);
        assert_eq!(cloned.target_path, "/home/user/.claude.json");
        let debug = format!("{:?}", dto);
        assert!(debug.contains("McpServerTargetDto"));
    }

    #[test]
    fn mcp_server_dto_out_clone_and_debug() {
        let dto = McpServerDtoOut {
            id: "srv-1".to_string(),
            name: "fs".to_string(),
            description: None,
            command: "npx".to_string(),
            url: None,
            args: vec![],
            env: HashMap::new(),
            transport: "stdio".to_string(),
            scope: "global".to_string(),
            project_id: None,
            source_registry: None,
            source_ref: None,
            tags: vec![],
            enabled: true,
            usage_count: 0,
            last_used_at: None,
            created_at: 0,
            updated_at: 0,
        };
        let cloned = dto.clone();
        assert_eq!(cloned.id, dto.id);
        let debug = format!("{:?}", dto);
        assert!(debug.contains("McpServerDtoOut"));
    }

    // ─── Slash resource DTO tests ──────────────────────────────────────────

    #[test]
    fn slash_resource_dto_serialization() {
        let dto = SlashResourceDto {
            kind: "command".to_string(),
            id: "cmd-1".to_string(),
            name: "deploy".to_string(),
            content: "/deploy {{project}}".to_string(),
            slash: Some("deploy".to_string()),
        };
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["kind"], "command");
        assert_eq!(json["slash"], "deploy");
    }

    #[test]
    fn deployed_mcp_dto_serialization() {
        let dto = DeployedMcpDto {
            agent_id: "claude".to_string(),
            servers: vec![
                serde_json::json!({"name": "fs"}),
                serde_json::json!({"name": "git"}),
            ],
        };
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["agent_id"], "claude");
        assert_eq!(json["servers"].as_array().unwrap().len(), 2);
    }
}
