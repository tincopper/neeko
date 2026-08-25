//! Unified resource deployer for MCP servers and Commands.
//!
//! Resolves target paths through `AgentConfig.deploy`（DeploySpec 模板）and writes
//! resources in the format each agent expects (JSON, TOML, or markdown).
//!
//! Core principle: **no hardcoded paths** — everything goes through DeploySpec.

use std::path::Path;

use serde::Serialize;

use super::plugin::AgentProvider;
use crate::agent::builtin::builtin_configs;
use crate::common::agent::types::AgentConfig;
use crate::library::skill::types::{McpServerRecord, PromptRecord};
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
/// 目标路径来自 `AgentConfig.deploy`（DeploySpec 模板），经 `AgentProvider`
/// 解析；格式（JSON/TOML）由目标文件扩展名推断。
pub struct ResourceDeployer {
    /// 部署目标 config 列表（默认内置，可注入供测试）。
    agents: Vec<AgentConfig>,
}

impl ResourceDeployer {
    /// 按 id 解析部署目标 config。
    fn agent_config(&self, agent_id: &str) -> Result<AgentConfig, AppError> {
        self.agents
            .iter()
            .find(|c| c.id == agent_id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("Agent not found: {agent_id}")))
    }
}

/// 解析 MCP 配置文件路径（None = 不支持 MCP 部署）。
fn mcp_path(
    config: &AgentConfig,
    project_path: Option<&Path>,
) -> Result<std::path::PathBuf, AppError> {
    AgentProvider::from(config)
        .resolve_mcp_path(project_path)
        .ok_or_else(|| {
            AppError::InvalidInput(format!("Agent '{}' does not support MCP", config.id))
        })
}

/// 由文件扩展名推断 MCP 配置格式（.toml → toml，其余 json）。
fn mcp_format(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("toml") => "toml",
        _ => "json",
    }
}

/// 解析 slash commands 目录（None = 不支持 command 部署）。
fn command_dir(
    config: &AgentConfig,
    project_path: Option<&Path>,
) -> Result<std::path::PathBuf, AppError> {
    AgentProvider::from(config)
        .resolve_commands_dir(project_path)
        .ok_or_else(|| {
            AppError::InvalidInput(format!("Agent '{}' does not support commands", config.id))
        })
}

impl ResourceDeployer {
    /// Create a new ResourceDeployer（内置 agent 作为部署目标）。
    #[must_use]
    pub fn new() -> Self {
        Self {
            agents: builtin_configs(),
        }
    }

    /// Create a ResourceDeployer with custom agent configs（供测试注入）。
    #[must_use]
    pub const fn with_agents(agents: Vec<AgentConfig>) -> Self {
        Self { agents }
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
        let config = self.agent_config(agent_id)?;

        if !config.deploy.supports_mcp() {
            return Err(AppError::InvalidInput(format!(
                "Agent '{agent_id}' does not support MCP"
            )));
        }

        let config_path = mcp_path(&config, project_path)?;
        let format = mcp_format(&config_path);

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
            "toml" => Self::merge_mcp_toml(&config_path, server),
            _ => Self::merge_mcp_json(&config_path, server),
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
        let config = self.agent_config(agent_id)?;
        let config_path = mcp_path(&config, project_path)?;

        if !config_path.exists() {
            return Ok(Vec::new());
        }

        let content = std::fs::read_to_string(&config_path).map_err(AppError::from)?;
        let format = mcp_format(&config_path);

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
        let config = self.agent_config(agent_id)?;
        let config_path = mcp_path(&config, project_path)?;

        if !config_path.exists() {
            return Ok(());
        }

        let content = std::fs::read_to_string(&config_path).map_err(AppError::from)?;
        let format = mcp_format(&config_path);

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
        let config = self.agent_config(agent_id)?;

        if !config.deploy.supports_commands() {
            return Err(AppError::InvalidInput(format!(
                "Agent '{agent_id}' does not support commands"
            )));
        }

        let commands_dir = command_dir(&config, project_path)?;

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
        let config = self.agent_config(agent_id)?;
        let commands_dir = command_dir(&config, project_path)?;

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
        let config = self.agent_config(agent_id)?;
        let commands_dir = command_dir(&config, project_path)?;

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
    /// Get the capabilities of an agent（部署能力，来自 `config.deploy`）。
    #[must_use]
    pub fn agent_capabilities(&self, agent_id: &str) -> Option<AgentCapabilitiesDto> {
        let config = self.agent_config(agent_id).ok()?;
        Some(AgentCapabilitiesDto {
            agent_id: config.id.clone(),
            agent_name: config.name.clone(),
            supports_mcp: config.deploy.supports_mcp(),
            supports_commands: config.deploy.supports_commands(),
            mcp_transports: vec!["stdio".into(), "sse".into(), "http".into()],
            commands_format: Some("markdown".into()),
            mcp_path: config.deploy.mcp_config.clone().unwrap_or_default(),
            commands_path: config.deploy.commands.clone().unwrap_or_default(),
        })
    }

    /// List all agent IDs that support a given capability.
    #[must_use]
    pub fn agents_supporting(&self, capability: &str) -> Vec<String> {
        builtin_configs()
            .into_iter()
            .filter(|c| match capability {
                "mcp" => c.deploy.supports_mcp(),
                "commands" => c.deploy.supports_commands(),
                _ => false,
            })
            .map(|c| c.id)
            .collect()
    }

    // ── Internal helpers ────────────────────────────────────────────────────

    /// Resolve the `(type, url)` pair for a remote (http/sse) MCP server,
    /// returning an error when the URL is missing or empty.
    fn remote_url(server: &McpServerRecord) -> Result<(String, String), AppError> {
        let url = server
            .url
            .as_deref()
            .map(str::trim)
            .filter(|u| !u.is_empty())
            .ok_or_else(|| {
                AppError::InvalidInput(format!(
                    "URL is required for {} transport server '{}'",
                    server.transport, server.name
                ))
            })?;
        Ok((server.transport.clone(), url.to_string()))
    }

    /// Merge an MCP server into a JSON config file under the `mcpServers` key.
    fn merge_mcp_json(config_path: &Path, server: &McpServerRecord) -> Result<(), AppError> {
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

        let server_def = if server.transport == "stdio" {
            serde_json::json!({
                "command": server.command,
                "args": args,
                "env": env,
            })
        } else {
            let (transport_type, url) = Self::remote_url(server)?;
            serde_json::json!({
                "type": transport_type,
                "url": url,
                "env": env,
            })
        };

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
                    "transport": def.get("type").and_then(|v| v.as_str()).unwrap_or("stdio"),
                    "url": def.get("url").and_then(|v| v.as_str()).unwrap_or(""),
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
    fn merge_mcp_toml(config_path: &Path, server: &McpServerRecord) -> Result<(), AppError> {
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
        if server.transport == "stdio" {
            server_table.insert(
                "command".to_string(),
                toml::Value::String(server.command.clone()),
            );
            if !args.is_empty() {
                server_table.insert("args".to_string(), toml::Value::Array(args));
            }
        } else {
            let (transport_type, url) = Self::remote_url(server)?;
            server_table.insert(
                "type".to_string(),
                toml::Value::String(transport_type.to_string()),
            );
            server_table.insert("url".to_string(), toml::Value::String(url.to_string()));
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
                        "transport": table.get("type").and_then(|v| v.as_str()).unwrap_or("stdio"),
                        "url": table.get("url").and_then(|v| v.as_str()).unwrap_or(""),
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

/// Resolve a resource path for an agent config（按 `config.deploy`）。
pub fn resolve_resource_path(
    config: &AgentConfig,
    resource_type: &str,
    project_path: Option<&Path>,
) -> Result<std::path::PathBuf, AppError> {
    let provider = AgentProvider::from(config);
    match resource_type {
        "skills" => Ok(provider.resolve_skill_dir(project_path)),
        "commands" => provider.resolve_commands_dir(project_path).ok_or_else(|| {
            AppError::InvalidInput(format!("Agent '{}' does not support commands", config.id))
        }),
        "mcp" => provider.resolve_mcp_path(project_path).ok_or_else(|| {
            AppError::InvalidInput(format!("Agent '{}' does not support MCP", config.id))
        }),
        other => Err(AppError::InvalidInput(format!(
            "Unknown resource type: {other} (expected skills|commands|mcp)"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::agent::types::{AgentConfig, DeploySpec};
    use tempfile::tempdir;

    /// 构造一个指向临时目录的测试 agent（注入 deploy 目标）。
    fn test_agent(id: &str, mcp: Option<&str>, commands: Option<&str>) -> AgentConfig {
        AgentConfig {
            id: id.into(),
            name: id.into(),
            icon: None,
            enabled: true,
            is_builtin: false,
            command: "test".into(),
            args: vec![],
            env: std::collections::HashMap::new(),
            chat: None,
            prompt_args: None,
            post_prompt_args: None,
            skill_path: None,
            detection: None,
            deploy: DeploySpec {
                skills: "{{projectPath}}/.test/skills".into(),
                commands: commands.map(String::from),
                mcp_config: mcp.map(String::from),
            },
        }
    }

    #[test]
    fn deploy_mcp_json_creates_config() {
        let tmp = tempdir().unwrap();
        let config_path = tmp.path().join("claude-settings.json");
        let deployer = ResourceDeployer::with_agents(vec![test_agent(
            "claude-code",
            Some(config_path.to_str().unwrap()),
            None,
        )]);

        let server = McpServerRecord {
            id: "mcp-1".into(),
            name: "test-server".into(),
            description: Some("A test MCP server".into()),
            command: "npx".into(),
            url: None,
            args_json: r#"["-y","@modelcontextprotocol/server-filesystem"]"#.into(),
            env_json: r#"{"HOME":"/home/user"}"#.into(),
            transport: "stdio".into(),
            scope: "global".into(),
            project_id: None,
            source_registry: None,
            source_ref: None,
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
    fn deploy_mcp_http_writes_url_config() {
        let tmp = tempdir().unwrap();
        let config_path = tmp.path().join("settings.json");
        let deployer = ResourceDeployer::with_agents(vec![test_agent(
            "claude-code",
            Some(config_path.to_str().unwrap()),
            None,
        )]);

        let server = McpServerRecord {
            id: "mcp-http".into(),
            name: "remote-server".into(),
            description: None,
            command: String::new(),
            url: Some("https://mcp.example.com/mcp".into()),
            args_json: "[]".into(),
            env_json: "{}".into(),
            transport: "http".into(),
            scope: "global".into(),
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

        let result = deployer.deploy_mcp(&server, "claude-code", None).unwrap();
        assert!(result.success);

        let content = std::fs::read_to_string(&config_path).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        let def = &parsed["mcpServers"]["remote-server"];
        assert_eq!(def["type"], "http");
        assert_eq!(def["url"], "https://mcp.example.com/mcp");
        assert!(def.get("command").is_none());

        let deployed = deployer.list_deployed_mcp("claude-code", None).unwrap();
        assert_eq!(deployed.len(), 1);
        assert_eq!(deployed[0]["name"], "remote-server");
        assert_eq!(deployed[0]["transport"], "http");
    }

    #[test]
    fn deploy_mcp_http_without_url_errors() {
        let tmp = tempdir().unwrap();
        let config_path = tmp.path().join("settings.json");
        let deployer = ResourceDeployer::with_agents(vec![test_agent(
            "claude-code",
            Some(config_path.to_str().unwrap()),
            None,
        )]);

        let server = McpServerRecord {
            id: "mcp-http".into(),
            name: "remote-server".into(),
            description: None,
            command: String::new(),
            url: None,
            args_json: "[]".into(),
            env_json: "{}".into(),
            transport: "http".into(),
            scope: "global".into(),
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

        let err = deployer
            .deploy_mcp(&server, "claude-code", None)
            .unwrap_err();
        assert!(err.to_string().contains("URL is required"));
        assert!(!config_path.exists());
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

        let deployer = ResourceDeployer::with_agents(vec![test_agent(
            "claude-code",
            Some(config_path.to_str().unwrap()),
            None,
        )]);

        let deployed = deployer.list_deployed_mcp("claude-code", None).unwrap();
        assert_eq!(deployed.len(), 1);
        assert_eq!(deployed[0]["name"], "fs");
    }

    #[test]
    fn deploy_command_writes_markdown_file() {
        let tmp = tempdir().unwrap();
        let cmd_dir = tmp.path().join("commands");
        let deployer = ResourceDeployer::with_agents(vec![test_agent(
            "claude-code",
            None,
            Some(cmd_dir.to_str().unwrap()),
        )]);

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
        let deployer = ResourceDeployer::new();
        let mcp_agents = deployer.agents_supporting("mcp");
        assert!(mcp_agents.contains(&"claude-code".to_string()));
        assert!(mcp_agents.contains(&"opencode".to_string()));
    }

    #[test]
    fn mcp_unsupported_agent_errors() {
        let deployer = ResourceDeployer::new();
        let err = deployer
            .deploy_mcp(
                &McpServerRecord {
                    id: "m".into(),
                    name: "s".into(),
                    description: None,
                    command: "npx".into(),
                    url: None,
                    args_json: "[]".into(),
                    env_json: "{}".into(),
                    transport: "stdio".into(),
                    scope: "global".into(),
                    project_id: None,
                    source_registry: None,
                    source_ref: None,
                    tags: vec![],
                    enabled: true,
                    usage_count: 0,
                    last_used_at: None,
                    created_at: 0,
                    updated_at: 0,
                },
                "mockAgent",
                None,
            )
            .unwrap_err();
        assert!(err.to_string().contains("does not support MCP"));
    }
}
