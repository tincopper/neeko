//! Data types and DTOs for MCP (Model Context Protocol) management.

use serde::{Deserialize, Serialize};

// -- MCP Tag Group --

/// A named group of MCP servers (analogous to `TagGroupRecord` for skills).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTagGroupRecord {
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
    /// Creation timestamp.
    pub created_at: i64,
    /// Last update timestamp.
    pub updated_at: i64,
}

/// Deployment target record for an MCP server (analogous to `SkillTargetRecord`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerTargetRecord {
    /// Unique identifier.
    pub id: String,
    /// MCP server identifier.
    pub server_id: String,
    /// Target agent key (e.g. "claude-code", "opencode").
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

// -- MCP Server --

/// An MCP (Model Context Protocol) server definition stored in the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerRecord {
    /// Unique MCP server identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
    /// Executable command to launch the MCP server.
    pub command: String,
    /// Remote endpoint URL for http/sse transports.
    pub url: Option<String>,
    /// Serialized JSON array of command arguments.
    pub args_json: String,
    /// Serialized JSON object of environment variables.
    pub env_json: String,
    /// Transport type: "stdio", "sse", or "http".
    pub transport: String,
    /// Scope: "global" or "project".
    pub scope: String,
    /// Project id when scope = "project".
    pub project_id: Option<String>,
    /// MCP Registry source (e.g. "registry.modelcontextprotocol.io") when installed from marketplace.
    pub source_registry: Option<String>,
    /// Registry-unique name (e.g. "io.github.modelcontextprotocol/filesystem") matching the source.
    pub source_ref: Option<String>,
    /// Tag names.
    pub tags: Vec<String>,
    /// Whether the MCP server is enabled.
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
