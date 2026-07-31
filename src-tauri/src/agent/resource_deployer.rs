//! Unified resource deployer for MCP servers and Commands.
//!
//! Resolves target paths through AgentPlugin path templates and writes
//! resources in the format each agent expects (JSON, TOML, or markdown).
//!
//! Core principle: **no hardcoded paths** — everything goes through AgentPlugin.

use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;

use super::path_resolver::PathResolver;
use super::plugin::{AgentPlugin, PathTemplate};
use crate::skill::types::{McpServerRecord, PromptRecord};
use crate::AppError;

/// Supported resource kinds for deployment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResourceKind {
    /// MCP server configuration.
    Mcp,
    /// Slash command (markdown file).
    Command,
}
impl ResourceKind {
    /// Returns the string representation of the resource kind.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Mcp => "mcp",
            Self::Command => "command",
        }
    }
}

/// Result of a deploy operation.
#[derive(Debug, Clone, Serialize)]
pub struct ResourceDeployResult {
    /// Whether the operation succeeded.
    pub success: bool,
    /// The target path that was written.
    pub target_path: String,
    /// The plugin/agent ID the resource was deployed to.
    pub agent_id: String,
    /// The resource name.
    pub resource_name: String,
    /// Error message if failed.
    pub error: Option<String>,
}

/// Unified deployer for MCP servers and Commands.
///
/// Resolves paths through AgentPlugin templates and handles format-specific
/// writing (JSON merge for MCP, file write for commands).
pub struct ResourceDeployer {
    /// Cache of built-in plugins (refreshed per call to allow test overrides).
    plugins: HashMap<String, AgentPlugin>,
}

impl ResourceDeployer {
    /// Create a new ResourceDeployer with the default built-in plugins.
    #[must_use]
    pub fn new() -> Self {
        Self {
            plugins: super::registry::plugin_map(),
        }
    }

    /// Create a ResourceDeployer with a custom plugin map (for testing).
    #[must_use]
    pub const fn with_plugins(plugins: HashMap<String, AgentPlugin>) -> Self {
        Self { plugins }
    }
    /// Get a plugin by ID.
    #[must_use]
    pub fn plugin(&self, agent_id: &str) -> Option<&AgentPlugin> {
        self.plugins.get(agent_id)
    }

    /// Register or override a plugin (used by tests and for custom plugins).
    pub fn upsert_plugin(&mut self, plugin: AgentPlugin) {
        self.plugins.insert(plugin.id.clone(), plugin);
    }

    // ── MCP Deployment ─────────────────────────────────────────────────────

    /// Deploy an MCP server to an agent's configuration file.
    ///
    /// Reads the existing config (JSON or TOML based on the plugin's
    /// `paths.mcp.format`), merges the server definition, and writes it back.
    pub fn deploy_mcp(
        &self,
        server: &McpServerRecord,
        agent_id: &str,
        project_path: Option<&Path>,
    ) -> Result<ResourceDeployResult, AppError> {
        let plugin = self
            .plugins
            .get(agent_id)
            .ok_or_else(|| AppError::NotFound(format!("Plugin not found: {agent_id}")))?;

        if !plugin.supports("mcp") {
            return Err(AppError::InvalidInput(format!(
                "Agent '{agent_id}' does not support MCP"
            )));
        }

        let resolver = PathResolver::new(project_path).with_agent_id(agent_id);
        let config_path = resolver.resolve(&plugin.paths.mcp);
        let format = plugin.paths.mcp.format.as_str();

        // Ensure parent directory exists
        if let Some(parent) = config_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                AppError::Io(format!(
                    "Failed to create parent dir for {:?}: {}",
                    config_path, e
                ))
            })?;
        }

        match format {
            "toml" => Self::merge_mcp_toml(&config_path, server, plugin),
            _ => Self::merge_mcp_json(&config_path, server, plugin),
        }?;

        Ok(ResourceDeployResult {
            success: true,
            target_path: config_path.to_string_lossy().to_string(),
            agent_id: agent_id.to_string(),
            resource_name: server.name.clone(),
            error: None,
        })
    }

    /// Read deployed MCP servers from an agent's config file.
    pub fn list_deployed_mcp(
        &self,
        agent_id: &str,
        project_path: Option<&Path>,
    ) -> Result<Vec<serde_json::Value>, AppError> {
        let plugin = self
            .plugins
            .get(agent_id)
            .ok_or_else(|| AppError::NotFound(format!("Plugin not found: {agent_id}")))?;

        let resolver = PathResolver::new(project_path).with_agent_id(agent_id);
        let config_path = resolver.resolve(&plugin.paths.mcp);

        if !config_path.exists() {
            return Ok(Vec::new());
        }

        let content = std::fs::read_to_string(&config_path).map_err(AppError::from)?;
        let format = plugin.paths.mcp.format.as_str();

        match format {
            "toml" => Self::read_mcp_toml(&content),
            _ => Self::read_mcp_json(&content),
        }
    }

    /// Remove an MCP server from an agent's configuration file.
    pub fn remove_mcp(
        &self,
        server_name: &str,
        agent_id: &str,
        project_path: Option<&Path>,
    ) -> Result<(), AppError> {
        let plugin = self
            .plugins
            .get(agent_id)
            .ok_or_else(|| AppError::NotFound(format!("Plugin not found: {agent_id}")))?;

        let resolver = PathResolver::new(project_path).with_agent_id(agent_id);
        let config_path = resolver.resolve(&plugin.paths.mcp);

        if !config_path.exists() {
            return Ok(());
        }

        let content = std::fs::read_to_string(&config_path).map_err(AppError::from)?;
        let format = plugin.paths.mcp.format.as_str();

        let updated = match format {
            "toml" => Self::remove_mcp_toml(&content, server_name),
            _ => Self::remove_mcp_json(&content, server_name),
        }?;

        std::fs::write(&config_path, updated).map_err(AppError::from)?;
        Ok(())
    }

    // ── Command Deployment ──────────────────────────────────────────────────

    /// Deploy a command (kind='command' prompt) to an agent's commands directory.
    ///
    /// Writes a markdown file named `{slash}.md` containing the command content
    /// with optional YAML frontmatter for description.
    pub fn deploy_command(
        &self,
        command: &PromptRecord,
        agent_id: &str,
        project_path: Option<&Path>,
    ) -> Result<ResourceDeployResult, AppError> {
        let plugin = self
            .plugins
            .get(agent_id)
            .ok_or_else(|| AppError::NotFound(format!("Plugin not found: {agent_id}")))?;

        if !plugin.supports("commands") {
            return Err(AppError::InvalidInput(format!(
                "Agent '{agent_id}' does not support commands"
            )));
        }

        let resolver = PathResolver::new(project_path).with_agent_id(agent_id);
        let commands_dir = resolver.resolve(&plugin.paths.commands);

        // Ensure commands directory exists
        std::fs::create_dir_all(&commands_dir).map_err(|e| {
            AppError::Io(format!(
                "Failed to create commands dir {:?}: {}",
                commands_dir, e
            ))
        })?;

        let file_name = command.slash.as_deref().unwrap_or(&command.name).trim();
        if file_name.is_empty() {
            return Err(AppError::InvalidInput(
                "Command must have a slash name or display name".to_string(),
            ));
        }

        let file_path = commands_dir.join(format!("{file_name}.md"));
        let content = Self::build_command_markdown(command);

        // Remove existing file if present
        if file_path.exists() {
            std::fs::remove_file(&file_path).map_err(AppError::from)?;
        }

        std::fs::write(&file_path, content).map_err(AppError::from)?;

        Ok(ResourceDeployResult {
            success: true,
            target_path: file_path.to_string_lossy().to_string(),
            agent_id: agent_id.to_string(),
            resource_name: command.name.clone(),
            error: None,
        })
    }

    /// List deployed command files in an agent's commands directory.
    pub fn list_deployed_commands(
        &self,
        agent_id: &str,
        project_path: Option<&Path>,
    ) -> Result<Vec<String>, AppError> {
        let plugin = self
            .plugins
            .get(agent_id)
            .ok_or_else(|| AppError::NotFound(format!("Plugin not found: {agent_id}")))?;

        let resolver = PathResolver::new(project_path).with_agent_id(agent_id);
        let commands_dir = resolver.resolve(&plugin.paths.commands);

        if !commands_dir.exists() {
            return Ok(Vec::new());
        }

        let mut names = Vec::new();
        for entry in std::fs::read_dir(&commands_dir).map_err(AppError::from)? {
            let entry = entry.map_err(AppError::from)?;
            let path = entry.path();
            if path.is_dir() {
                // Skill-style command directory (contains a markdown file)
                if let Some(name) = path.file_name() {
                    names.push(name.to_string_lossy().to_string());
                }
            } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
                if let Some(stem) = path.file_stem() {
                    names.push(stem.to_string_lossy().to_string());
                }
            }
        }
        names.sort();
        Ok(names)
    }

    /// Remove a deployed command from an agent's commands directory.
    pub fn remove_command(
        &self,
        command_name: &str,
        agent_id: &str,
        project_path: Option<&Path>,
    ) -> Result<(), AppError> {
        let plugin = self
            .plugins
            .get(agent_id)
            .ok_or_else(|| AppError::NotFound(format!("Plugin not found: {agent_id}")))?;

        let resolver = PathResolver::new(project_path).with_agent_id(agent_id);
        let commands_dir = resolver.resolve(&plugin.paths.commands);

        // Try file form first: {name}.md
        let file_path = commands_dir.join(format!("{command_name}.md"));
        if file_path.exists() {
            std::fs::remove_file(&file_path).map_err(AppError::from)?;
            return Ok(());
        }

        // Try directory form: {name}/
        let dir_path = commands_dir.join(command_name);
        if dir_path.exists() && dir_path.is_dir() {
            std::fs::remove_dir_all(&dir_path).map_err(AppError::from)?;
        }

        Ok(())
    }

    // ── Agent capabilities ──────────────────────────────────────────────────
    /// Get the capabilities of a plugin (what resource types it supports).
    #[must_use]
    pub fn agent_capabilities(&self, agent_id: &str) -> Option<AgentCapabilitiesDto> {
        self.plugins.get(agent_id).map(|p| AgentCapabilitiesDto {
            agent_id: p.id.clone(),
            agent_name: p.name.clone(),
            supports_mcp: p.supports("mcp"),
            supports_commands: p.supports("commands"),
            mcp_transports: p
                .capabilities
                .mcp
                .as_ref()
                .and_then(|m| m.transports.clone())
                .unwrap_or_default(),
            commands_format: p
                .capabilities
                .commands
                .as_ref()
                .and_then(|c| c.format.clone()),
            mcp_path: p.paths.mcp.relative.clone(),
            commands_path: p.paths.commands.relative.clone(),
        })
    }

    /// List all agent IDs that support a given capability.
    #[must_use]
    pub fn agents_supporting(&self, capability: &str) -> Vec<String> {
        self.plugins
            .values()
            .filter(|p| p.supports(capability))
            .map(|p| p.id.clone())
            .collect()
    }

    // ── Internal helpers ────────────────────────────────────────────────────

    /// Merge an MCP server into a JSON config file under the `mcpServers` key.
    fn merge_mcp_json(
        config_path: &Path,
        server: &McpServerRecord,
        _plugin: &AgentPlugin,
    ) -> Result<(), AppError> {
        let mut root: serde_json::Value = if config_path.exists() {
            let content = std::fs::read_to_string(config_path).map_err(AppError::from)?;
            if content.trim().is_empty() {
                serde_json::json!({})
            } else {
                serde_json::from_str(&content).map_err(|e| {
                    AppError::InvalidInput(format!("Failed to parse MCP config JSON: {e}"))
                })?
            }
        } else {
            serde_json::json!({})
        };

        let obj = root.as_object_mut().ok_or_else(|| {
            AppError::InvalidInput("MCP config root is not a JSON object".to_string())
        })?;

        let mcp_servers = obj
            .entry("mcpServers".to_string())
            .or_insert_with(|| serde_json::json!({}))
            .as_object_mut()
            .ok_or_else(|| AppError::InvalidInput("mcpServers is not a JSON object".to_string()))?;

        let args: Vec<serde_json::Value> =
            serde_json::from_str(&server.args_json).unwrap_or_default();
        let env: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&server.env_json).unwrap_or_default();

        let server_def = serde_json::json!({
            "command": server.command,
            "args": args,
            "env": env,
        });

        mcp_servers.insert(server.name.clone(), server_def);

        let output = serde_json::to_string_pretty(&root).map_err(AppError::from)?;
        std::fs::write(config_path, output).map_err(AppError::from)?;
        Ok(())
    }

    /// Read MCP server names from a JSON config file.
    fn read_mcp_json(content: &str) -> Result<Vec<serde_json::Value>, AppError> {
        if content.trim().is_empty() {
            return Ok(Vec::new());
        }
        let root: serde_json::Value = serde_json::from_str(content)
            .map_err(|e| AppError::InvalidInput(format!("Failed to parse MCP config JSON: {e}")))?;
        let mut result = Vec::new();
        if let Some(servers) = root.get("mcpServers").and_then(|v| v.as_object()) {
            for (name, def) in servers {
                result.push(serde_json::json!({
                    "name": name,
                    "command": def.get("command").and_then(|v| v.as_str()).unwrap_or(""),
                    "transport": "stdio",
                }));
            }
        }
        Ok(result)
    }

    /// Remove an MCP server from a JSON config string.
    fn remove_mcp_json(content: &str, server_name: &str) -> Result<String, AppError> {
        if content.trim().is_empty() {
            return Ok(content.to_string());
        }
        let mut root: serde_json::Value = serde_json::from_str(content)
            .map_err(|e| AppError::InvalidInput(format!("Failed to parse MCP config JSON: {e}")))?;
        if let Some(servers) = root.get_mut("mcpServers").and_then(|v| v.as_object_mut()) {
            servers.remove(server_name);
        }
        serde_json::to_string_pretty(&root).map_err(AppError::from)
    }

    /// Merge an MCP server into a TOML config file.
    fn merge_mcp_toml(
        config_path: &Path,
        server: &McpServerRecord,
        _plugin: &AgentPlugin,
    ) -> Result<(), AppError> {
        let mut root: toml::Value = if config_path.exists() {
            let content = std::fs::read_to_string(config_path).map_err(AppError::from)?;
            if content.trim().is_empty() {
                toml::Value::Table(toml::value::Table::new())
            } else {
                content.parse().map_err(|e| {
                    AppError::InvalidInput(format!("Failed to parse MCP config TOML: {e}"))
                })?
            }
        } else {
            toml::Value::Table(toml::value::Table::new())
        };

        let table = root.as_table_mut().ok_or_else(|| {
            AppError::InvalidInput("MCP config root is not a TOML table".to_string())
        })?;

        let mcp = table
            .entry("mcp".to_string())
            .or_insert_with(|| toml::Value::Table(toml::value::Table::new()))
            .as_table_mut()
            .ok_or_else(|| AppError::InvalidInput("[mcp] is not a TOML table".to_string()))?;

        let args: Vec<toml::Value> = serde_json::from_str(&server.args_json)
            .ok()
            .and_then(|v: Vec<serde_json::Value>| {
                v.into_iter()
                    .map(|i| toml::Value::String(i.as_str().unwrap_or("").to_string()))
                    .collect::<Vec<_>>()
                    .into()
            })
            .unwrap_or_default();

        let mut server_table = toml::value::Table::new();
        server_table.insert(
            "command".to_string(),
            toml::Value::String(server.command.clone()),
        );
        if !args.is_empty() {
            server_table.insert("args".to_string(), toml::Value::Array(args));
        }
        if server.transport == "sse" {
            server_table.insert(
                "transport".to_string(),
                toml::Value::String("sse".to_string()),
            );
        }

        mcp.insert(server.name.clone(), toml::Value::Table(server_table));

        let output = toml::to_string_pretty(&root).map_err(|e| {
            AppError::InvalidInput(format!("Failed to serialize MCP config TOML: {e}"))
        })?;
        std::fs::write(config_path, output).map_err(AppError::from)?;
        Ok(())
    }

    /// Read MCP server names from a TOML config string.
    fn read_mcp_toml(content: &str) -> Result<Vec<serde_json::Value>, AppError> {
        if content.trim().is_empty() {
            return Ok(Vec::new());
        }
        let root: toml::Value = content
            .parse()
            .map_err(|e| AppError::InvalidInput(format!("Failed to parse MCP config TOML: {e}")))?;
        let mut result = Vec::new();
        if let Some(mcp) = root.get("mcp").and_then(|v| v.as_table()) {
            for (name, def) in mcp {
                if let Some(table) = def.as_table() {
                    result.push(serde_json::json!({
                        "name": name,
                        "command": table.get("command").and_then(|v| v.as_str()).unwrap_or(""),
                        "transport": table.get("transport").and_then(|v| v.as_str()).unwrap_or("stdio"),
                    }));
                }
            }
        }
        Ok(result)
    }

    /// Remove an MCP server from a TOML config string.
    fn remove_mcp_toml(content: &str, server_name: &str) -> Result<String, AppError> {
        if content.trim().is_empty() {
            return Ok(content.to_string());
        }
        let mut root: toml::Value = content
            .parse()
            .map_err(|e| AppError::InvalidInput(format!("Failed to parse MCP config TOML: {e}")))?;
        if let Some(mcp) = root.get_mut("mcp").and_then(|v| v.as_table_mut()) {
            mcp.remove(server_name);
        }
        toml::to_string_pretty(&root).map_err(|e| {
            AppError::InvalidInput(format!("Failed to serialize MCP config TOML: {e}"))
        })
    }

    /// Build the markdown content for a command file.
    fn build_command_markdown(command: &PromptRecord) -> String {
        let mut out = String::new();

        // YAML frontmatter
        out.push_str("---\n");
        if let Some(desc) = &command.description {
            out.push_str(&format!("description: {}\n", Self::escape_yaml(desc)));
        }
        out.push_str("---\n\n");

        out.push_str(&command.content);
        if !command.content.ends_with('\n') {
            out.push('\n');
        }
        out
    }

    /// Escape a string for YAML scalar (quote if it contains special chars).
    fn escape_yaml(s: &str) -> String {
        if s.contains(':')
            || s.contains('#')
            || s.contains('"')
            || s.contains('\'')
            || s.starts_with(' ')
            || s.ends_with(' ')
        {
            format!("\"{}\"", s.replace('"', "\\\""))
        } else {
            s.to_string()
        }
    }
}

impl Default for ResourceDeployer {
    fn default() -> Self {
        Self::new()
    }
}

/// DTO describing an agent's resource capabilities.
#[derive(Debug, Clone, Serialize)]
pub struct AgentCapabilitiesDto {
    /// Agent identifier.
    pub agent_id: String,
    /// Human-readable agent name.
    pub agent_name: String,
    /// Whether the agent supports MCP servers.
    pub supports_mcp: bool,
    /// Whether the agent supports slash commands.
    pub supports_commands: bool,
    /// MCP transport types supported (e.g., "sse", "stdio").
    pub mcp_transports: Vec<String>,
    /// Command format if commands are supported.
    pub commands_format: Option<String>,
    /// Filesystem path where MCP configuration is written.
    pub mcp_path: String,
    /// Filesystem path where command files are written.
    pub commands_path: String,
}

/// Resolve a path template for a given plugin and resource type.
pub fn resolve_resource_path(
    plugin: &AgentPlugin,
    resource_type: &str,
    project_path: Option<&Path>,
) -> Result<std::path::PathBuf, AppError> {
    let resolver = PathResolver::new(project_path).with_agent_id(&plugin.id);
    let template: &PathTemplate = match resource_type {
        "config" => &plugin.paths.config,
        "skills" => &plugin.paths.skills,
        "commands" => &plugin.paths.commands,
        "mcp" => &plugin.paths.mcp,
        "hooks" => &plugin.paths.hooks,
        "plugins" => &plugin.paths.plugins,
        other => {
            return Err(AppError::InvalidInput(format!(
                "Unknown resource type: {other}"
            )));
        }
    };
    Ok(resolver.resolve(template))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::registry::default_agent_plugins;
    use tempfile::tempdir;

    fn make_test_deployer() -> ResourceDeployer {
        ResourceDeployer::with_plugins(
            default_agent_plugins()
                .into_iter()
                .map(|p| (p.id.clone(), p))
                .collect(),
        )
    }

    #[test]
    fn deploy_mcp_json_creates_config() {
        let tmp = tempdir().unwrap();
        let deployer = make_test_deployer();

        // Create a minimal plugin pointing at a temp config file
        let mut plugin = default_agent_plugins()
            .into_iter()
            .find(|p| p.id == "claude-code")
            .unwrap();
        let config_path = tmp.path().join("claude-settings.json");
        plugin.paths.mcp = PathTemplate {
            relative: config_path.to_string_lossy().to_string(),
            format: "json".into(),
            description: None,
            project_level: false,
        };

        let mut deployer = ResourceDeployer::default();
        deployer.upsert_plugin(plugin);

        let server = McpServerRecord {
            id: "mcp-1".into(),
            name: "test-server".into(),
            description: Some("A test MCP server".into()),
            command: "npx".into(),
            args_json: r#"["-y","@modelcontextprotocol/server-filesystem"]"#.into(),
            env_json: r#"{"HOME":"/home/user"}"#.into(),
            transport: "stdio".into(),
            scope: "global".into(),
            project_id: None,
            tags: vec!["fs".into()],
            enabled: true,
            usage_count: 0,
            last_used_at: None,
            created_at: 0,
            updated_at: 0,
        };

        let result = deployer.deploy_mcp(&server, "claude-code", None).unwrap();
        assert!(result.success);
        assert!(config_path.exists());

        let content = std::fs::read_to_string(&config_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert!(parsed["mcpServers"]["test-server"].is_object());
        assert_eq!(parsed["mcpServers"]["test-server"]["command"], "npx");
    }

    #[test]
    fn list_deployed_mcp_returns_servers() {
        let tmp = tempdir().unwrap();
        let config_path = tmp.path().join("settings.json");
        std::fs::write(
            &config_path,
            r#"{"mcpServers": {"fs": {"command": "npx", "args": ["-y", "fs-mcp"]}}}"#,
        )
        .unwrap();

        let mut plugin = default_agent_plugins()
            .into_iter()
            .find(|p| p.id == "claude-code")
            .unwrap();
        plugin.paths.mcp = PathTemplate {
            relative: config_path.to_string_lossy().to_string(),
            format: "json".into(),
            description: None,
            project_level: false,
        };

        let mut deployer = ResourceDeployer::default();
        deployer.upsert_plugin(plugin);

        let deployed = deployer.list_deployed_mcp("claude-code", None).unwrap();
        assert_eq!(deployed.len(), 1);
        assert_eq!(deployed[0]["name"], "fs");
    }

    #[test]
    fn deploy_command_writes_markdown_file() {
        let tmp = tempdir().unwrap();
        let mut plugin = default_agent_plugins()
            .into_iter()
            .find(|p| p.id == "claude-code")
            .unwrap();
        let cmd_dir = tmp.path().join("commands");
        plugin.paths.commands = PathTemplate {
            relative: cmd_dir.to_string_lossy().to_string(),
            format: "markdown".into(),
            description: None,
            project_level: true,
        };

        let mut deployer = ResourceDeployer::default();
        deployer.upsert_plugin(plugin);

        let command = PromptRecord {
            id: "cmd-1".into(),
            name: "Review".into(),
            description: Some("Review code changes".into()),
            content: "Review the current branch against {{base}}.".into(),
            slash: Some("review".into()),
            tags: vec!["review".into()],
            scope: "global".into(),
            project_id: None,
            variables: vec![],
            kind: "command".into(),
            favorite: false,
            usage_count: 0,
            last_used_at: None,
            created_at: 0,
            updated_at: 0,
        };

        let result = deployer
            .deploy_command(&command, "claude-code", None)
            .unwrap();
        assert!(result.success);

        let cmd_file = cmd_dir.join("review.md");
        assert!(cmd_file.exists());
        let content = std::fs::read_to_string(&cmd_file).unwrap();
        assert!(content.contains("description: Review code changes"));
        assert!(content.contains("Review the current branch against {{base}}."));
    }

    #[test]
    fn agents_supporting_filters_by_capability() {
        let deployer = make_test_deployer();
        let mcp_agents = deployer.agents_supporting("mcp");
        assert!(mcp_agents.contains(&"claude-code".to_string()));
        assert!(mcp_agents.contains(&"cursor".to_string()));
    }
}
