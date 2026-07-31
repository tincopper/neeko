//! AgentPlugin type definitions — the complete contract for an Agent provider.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Execution ──────────────────────────────────────────────────────────────

/// How an Agent CLI is launched and detected.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentExecution {
    /// Executable command path.
    pub command: String,
    /// Arguments to pass to the command.
    pub args: Vec<String>,
    /// Environment variables for the agent process.
    pub env: HashMap<String, String>,
    /// prompt 前置参数。
    #[serde(default)]
    pub prompt_args: Option<Vec<String>>,
    /// prompt 后置参数。
    #[serde(default)]
    pub post_prompt_args: Option<Vec<String>>,
    /// Installation detection strategy.
    #[serde(default)]
    pub detection: Option<AgentDetection>,
}

/// Installation detection strategy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentDetection {
    /// Detection strategy type (e.g., "command", "path").
    #[serde(rename = "type")]
    pub detection_type: String,
    /// Target to check (command name or path template).
    pub target: String,
}

// ─── Configuration ──────────────────────────────────────────────────────────

/// Configuration contract for an Agent provider.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentConfiguration {
    /// JSON Schema for validation (stored as raw JSON value).
    #[serde(default)]
    pub schema: serde_json::Value,
    /// Default configuration values.
    #[serde(default)]
    pub defaults: HashMap<String, serde_json::Value>,
    /// Secrets the user must provide.
    #[serde(default)]
    pub secrets: Option<Vec<SecretDefinition>>,
}

/// A secret the user must provide to use this Agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretDefinition {
    /// Unique key identifying this secret.
    pub key: String,
    /// Human-readable label for the secret.
    pub label: String,
    /// Optional description explaining the secret's purpose.
    #[serde(default)]
    pub description: Option<String>,
    /// Secret type (e.g., "password", "token").
    #[serde(rename = "type")]
    pub secret_type: String,
    /// Whether this secret is required for the agent to function.
    pub required: bool,
}

// ─── Capabilities ───────────────────────────────────────────────────────────

/// Declares what resource types this Agent supports.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentCapabilities {
    /// MCP capability declaration.
    #[serde(default)]
    pub mcp: Option<McpCapability>,
    /// Commands capability declaration.
    #[serde(default)]
    pub commands: Option<CommandsCapability>,
    /// Hooks capability declaration.
    #[serde(default)]
    pub hooks: Option<HooksCapability>,
    /// Skills capability declaration.
    #[serde(default)]
    pub skills: Option<SkillsCapability>,
    /// Plugins capability declaration.
    #[serde(default)]
    pub plugins: Option<PluginsCapability>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
/// MCP capability declaration.
pub struct McpCapability {
    /// Whether MCP is supported.
    pub supported: bool,
    /// Supported transport types.
    #[serde(default)]
    pub transports: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
/// Commands capability declaration.
pub struct CommandsCapability {
    /// Whether commands are supported.
    pub supported: bool,
    /// Command format.
    #[serde(default)]
    pub format: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
/// Hooks capability declaration.
pub struct HooksCapability {
    /// Whether hooks are supported.
    pub supported: bool,
    /// Supported hook events.
    #[serde(default)]
    pub events: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
/// Skills capability declaration.
pub struct SkillsCapability {
    /// Whether skills are supported.
    pub supported: bool,
    /// Skill format.
    #[serde(default)]
    pub format: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
/// Plugins capability declaration.
pub struct PluginsCapability {
    /// Whether plugins are supported.
    pub supported: bool,
}

// ─── Resource Paths ─────────────────────────────────────────────────────────

/// Templated paths to various resource locations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResourcePaths {
    /// Configuration directory path template.
    pub config: PathTemplate,
    /// Skills directory path template.
    pub skills: PathTemplate,
    /// Commands directory path template.
    pub commands: PathTemplate,
    /// MCP directory path template.
    pub mcp: PathTemplate,
    /// Hooks directory path template.
    pub hooks: PathTemplate,
    /// Plugins directory path template.
    pub plugins: PathTemplate,
    /// Secrets path template (optional).
    #[serde(default)]
    pub secrets: Option<PathTemplate>,
}

/// A path template supporting variable interpolation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathTemplate {
    /// Relative path (supports {{home}}, {{projectPath}}, etc.).
    pub relative: String,
    /// File format / content type.
    pub format: String,
    /// Human-readable description.
    #[serde(default)]
    pub description: Option<String>,
    /// Whether this path is project-level (true) or user-level (false).
    #[serde(default)]
    pub project_level: bool,
}
/// Lifecycle hooks for intervening in Agent execution.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentLifecycle {
    /// Command to run when a project is activated.
    #[serde(default)]
    pub on_project_activate: Option<String>,
    /// Command to run when a session starts.
    #[serde(default)]
    pub on_session_start: Option<String>,
}

// ─── AgentPlugin (root) ─────────────────────────────────────────────────────

/// A complete contract describing an Agent provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPlugin {
    /// Unique plugin identifier.
    pub id: String,
    /// Human-readable display name.
    pub name: String,
    /// Optional icon identifier.
    pub icon: Option<String>,
    /// Optional description.
    #[serde(default)]
    pub description: Option<String>,
    /// Plugin version.
    #[serde(default = "default_version")]
    pub version: String,
    /// Whether this is a built-in plugin.
    #[serde(default)]
    pub is_builtin: bool,
    /// Whether this plugin is enabled.
    #[serde(default = "default_true")]
    pub enabled: bool,

    /// Execution contract.
    pub execution: AgentExecution,
    /// Configuration contract.
    #[serde(default)]
    pub configuration: AgentConfiguration,
    /// Capability declarations.
    #[serde(default)]
    pub capabilities: AgentCapabilities,
    /// Resource path templates.
    pub paths: AgentResourcePaths,
    /// Lifecycle hooks (optional).
    #[serde(default)]
    pub lifecycle: Option<AgentLifecycle>,
}

fn default_version() -> String {
    "1.0".to_string()
}

const fn default_true() -> bool {
    true
}

impl AgentPlugin {
    /// Get the skills path template, applying optional user override.
    #[must_use]
    pub fn skills_path_template(&self, override_path: Option<&str>) -> PathTemplate {
        if let Some(ov) = override_path {
            let mut p = self.paths.skills.clone();
            p.relative = ov.to_string();
            p
        } else {
            self.paths.skills.clone()
        }
    }

    /// Get the project-relative skills directory (e.g., `.claude/skills`).
    ///
    /// Strips the `{{projectPath}}/` prefix from the skills path template.
    /// Returns `None` if the template does not start with `{{projectPath}}/`.
    #[must_use]
    pub fn relative_skills_dir(&self) -> Option<String> {
        self.paths
            .skills
            .relative
            .strip_prefix("{{projectPath}}/")
            .or_else(|| self.paths.skills.relative.strip_prefix("{{projectPath}}\\"))
            .map(str::to_string)
    }

    /// Get the relative path for a given resource type (strips `{{projectPath}}/`).
    #[must_use]
    pub fn relative_resource_path(&self, resource_type: &str) -> Option<String> {
        let template = match resource_type {
            "config" => &self.paths.config.relative,
            "skills" => &self.paths.skills.relative,
            "commands" => &self.paths.commands.relative,
            "mcp" => &self.paths.mcp.relative,
            "hooks" => &self.paths.hooks.relative,
            "plugins" => &self.paths.plugins.relative,
            _ => return None,
        };
        template
            .strip_prefix("{{projectPath}}/")
            .or_else(|| template.strip_prefix("{{projectPath}}\\"))
            .map(str::to_string)
    }

    /// Check whether this plugin supports a given capability category.
    #[must_use]
    pub fn supports(&self, capability: &str) -> bool {
        match capability {
            "mcp" => self.capabilities.mcp.as_ref().is_some_and(|c| c.supported),
            "commands" => self
                .capabilities
                .commands
                .as_ref()
                .is_some_and(|c| c.supported),
            "hooks" => self
                .capabilities
                .hooks
                .as_ref()
                .is_some_and(|c| c.supported),
            "skills" => self
                .capabilities
                .skills
                .as_ref()
                .is_some_and(|c| c.supported),
            "plugins" => self
                .capabilities
                .plugins
                .as_ref()
                .is_some_and(|c| c.supported),
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_deserialize_minimal_plugin() {
        let json = serde_json::json!({
            "id": "test",
            "name": "Test",
            "execution": { "command": "test", "args": [], "env": {} },
            "paths": {
                "config": { "relative": "~/.test/config", "format": "json" },
                "skills": { "relative": "~/.test/skills", "format": "directory" },
                "commands": { "relative": "~/.test/commands", "format": "markdown" },
                "mcp": { "relative": "~/.test/mcp", "format": "json" },
                "hooks": { "relative": "~/.test/hooks", "format": "script" },
                "plugins": { "relative": "~/.test/plugins", "format": "directory" }
            }
        });
        let plugin: AgentPlugin = serde_json::from_value(json).unwrap();
        assert_eq!(plugin.id, "test");
        assert_eq!(plugin.execution.command, "test");
        // is_builtin defaults to false for custom/user-defined plugins
        assert!(!plugin.is_builtin);
        // enabled defaults to true
        assert!(plugin.enabled);
        // version defaults to "1.0"
        assert_eq!(plugin.version, "1.0");
    }

    #[test]
    fn supports_returns_correct_capabilities() {
        let plugin = AgentPlugin {
            id: "test".into(),
            name: "Test".into(),
            icon: None,
            description: None,
            version: "1.0".into(),
            is_builtin: true,
            enabled: true,
            execution: AgentExecution {
                command: "test".into(),
                args: vec![],
                env: HashMap::new(),
                prompt_args: None,
                post_prompt_args: None,
                detection: None,
            },
            configuration: AgentConfiguration::default(),
            capabilities: AgentCapabilities {
                mcp: Some(McpCapability {
                    supported: true,
                    transports: Some(vec!["stdio".into()]),
                }),
                skills: Some(SkillsCapability {
                    supported: true,
                    format: Some("skill.md".into()),
                }),
                ..Default::default()
            },
            paths: AgentResourcePaths {
                config: PathTemplate {
                    relative: "~/.test/config".into(),
                    format: "json".into(),
                    description: None,
                    project_level: false,
                },
                skills: PathTemplate {
                    relative: "~/.test/skills".into(),
                    format: "directory".into(),
                    description: None,
                    project_level: true,
                },
                commands: PathTemplate {
                    relative: "~/.test/commands".into(),
                    format: "markdown".into(),
                    description: None,
                    project_level: false,
                },
                mcp: PathTemplate {
                    relative: "~/.test/mcp".into(),
                    format: "json".into(),
                    description: None,
                    project_level: false,
                },
                hooks: PathTemplate {
                    relative: "~/.test/hooks".into(),
                    format: "script".into(),
                    description: None,
                    project_level: false,
                },
                plugins: PathTemplate {
                    relative: "~/.test/plugins".into(),
                    format: "directory".into(),
                    description: None,
                    project_level: false,
                },
                secrets: None,
            },
            lifecycle: None,
        };

        assert!(plugin.supports("mcp"));
        assert!(plugin.supports("skills"));
        assert!(!plugin.supports("hooks"));
        assert!(!plugin.supports("commands"));
    }
}
