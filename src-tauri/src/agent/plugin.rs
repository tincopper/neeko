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
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub secret_type: String,
    pub required: bool,
}

// ─── Capabilities ───────────────────────────────────────────────────────────

/// Declares what resource types this Agent supports.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentCapabilities {
    #[serde(default)]
    pub mcp: Option<McpCapability>,
    #[serde(default)]
    pub commands: Option<CommandsCapability>,
    #[serde(default)]
    pub hooks: Option<HooksCapability>,
    #[serde(default)]
    pub skills: Option<SkillsCapability>,
    #[serde(default)]
    pub plugins: Option<PluginsCapability>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpCapability {
    pub supported: bool,
    #[serde(default)]
    pub transports: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandsCapability {
    pub supported: bool,
    #[serde(default)]
    pub format: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HooksCapability {
    pub supported: bool,
    #[serde(default)]
    pub events: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillsCapability {
    pub supported: bool,
    #[serde(default)]
    pub format: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginsCapability {
    pub supported: bool,
}

// ─── Resource Paths ─────────────────────────────────────────────────────────

/// Templated paths to various resource locations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentResourcePaths {
    pub config: PathTemplate,
    pub skills: PathTemplate,
    pub commands: PathTemplate,
    pub mcp: PathTemplate,
    pub hooks: PathTemplate,
    pub plugins: PathTemplate,
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
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub project_level: bool,
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

/// Lifecycle hooks for intervening in Agent execution.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentLifecycle {
    #[serde(default)]
    pub on_project_activate: Option<String>,
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

fn default_true() -> bool {
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
            "mcp" => self
                .capabilities
                .mcp
                .as_ref()
                .map_or(false, |c| c.supported),
            "commands" => self
                .capabilities
                .commands
                .as_ref()
                .map_or(false, |c| c.supported),
            "hooks" => self
                .capabilities
                .hooks
                .as_ref()
                .map_or(false, |c| c.supported),
            "skills" => self
                .capabilities
                .skills
                .as_ref()
                .map_or(false, |c| c.supported),
            "plugins" => self
                .capabilities
                .plugins
                .as_ref()
                .map_or(false, |c| c.supported),
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
