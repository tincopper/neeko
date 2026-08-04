//! Plugin registry — provides access to built-in AgentPlugin definitions.

use std::collections::HashMap;

use super::plugin::AgentPlugin;

/// Return the list of built-in AgentPlugin definitions.
///
/// These cover the 10+ mainstream Agent providers integrated into Neeko,
/// plus common IDE tools (Cursor, Windsurf) for cross-tool skill sync.
#[must_use]
pub fn default_agent_plugins() -> Vec<AgentPlugin> {
    vec![
        // ── Claude Code ───────────────────────────────────────────────────────
        AgentPlugin {
            id: "claude-code".into(),
            name: "Claude Code".into(),
            icon: Some("claude-code.png".into()),
            description: Some("Anthropic Claude Code CLI agent".into()),
            version: "1.0".into(),
            is_builtin: true,
            enabled: true,
            execution: super::plugin::AgentExecution {
                command: "claude".into(),
                args: vec![],
                env: HashMap::new(),
                prompt_args: Some(vec!["--bare".into(), "-p".into()]),
                post_prompt_args: Some(vec!["--dangerously-skip-permissions".into()]),
                detection: Some(super::plugin::AgentDetection {
                    detection_type: "command".into(),
                    target: "claude".into(),
                }),
            },
            configuration: super::plugin::AgentConfiguration {
                schema: schema_claude_code(),
                defaults: {
                    let mut m = HashMap::new();
                    m.insert("model".to_string(), serde_json::json!("sonnet"));
                    m
                },
                secrets: Some(vec![super::plugin::SecretDefinition {
                    key: "ANTHROPIC_API_KEY".into(),
                    label: "Anthropic API Key".into(),
                    description: Some("Your Anthropic API key".into()),
                    secret_type: "password".into(),
                    required: true,
                }]),
            },
            capabilities: super::plugin::AgentCapabilities {
                mcp: Some(super::plugin::McpCapability {
                    supported: true,
                    transports: Some(vec!["stdio".into(), "sse".into()]),
                }),
                commands: Some(super::plugin::CommandsCapability {
                    supported: true,
                    format: Some("markdown".into()),
                }),
                hooks: Some(super::plugin::HooksCapability {
                    supported: true,
                    events: Some(vec![
                        "pre-send".into(),
                        "post-receive".into(),
                        "session-start".into(),
                        "on-error".into(),
                    ]),
                }),
                skills: Some(super::plugin::SkillsCapability {
                    supported: true,
                    format: Some("skill.md".into()),
                }),
                plugins: Some(super::plugin::PluginsCapability { supported: true }),
            },
            paths: super::plugin::AgentResourcePaths {
                config: path_tpl(
                    "{{home}}/.claude/settings.json",
                    "json",
                    "Global Claude Code settings",
                    false,
                ),
                skills: path_tpl(
                    "{{projectPath}}/.claude/skills",
                    "directory",
                    "Project-level skills",
                    true,
                ),
                commands: path_tpl(
                    "{{projectPath}}/.claude/commands",
                    "markdown",
                    "Project-level slash commands",
                    true,
                ),
                mcp: path_tpl(
                    "{{home}}/.claude/settings.json",
                    "json",
                    "MCP server configuration",
                    false,
                ),
                hooks: path_tpl(
                    "{{projectPath}}/.claude/hooks",
                    "script",
                    "Lifecycle hook scripts",
                    true,
                ),
                plugins: path_tpl(
                    "{{projectPath}}/.claude/plugins",
                    "directory",
                    "Plugin directory",
                    true,
                ),
                secrets: None,
            },
            lifecycle: Some(super::plugin::AgentLifecycle {
                on_session_start: Some("{{home}}/.claude/hooks/session-start".into()),
                on_project_activate: None,
            }),
        },
        // ── Cursor ────────────────────────────────────────────────────────────
        AgentPlugin {
            id: "cursor".into(),
            name: "Cursor".into(),
            icon: Some("cursor.svg".into()),
            description: Some("Cursor IDE with AI-powered coding assistance".into()),
            version: "1.0".into(),
            is_builtin: true,
            enabled: true,
            execution: super::plugin::AgentExecution {
                command: "cursor".into(),
                args: vec![],
                env: HashMap::new(),
                prompt_args: None,
                post_prompt_args: None,
                detection: Some(super::plugin::AgentDetection {
                    detection_type: "directory".into(),
                    target: "{{projectPath}}/.cursor".into(),
                }),
            },
            configuration: super::plugin::AgentConfiguration {
                schema: schema_cursor(),
                defaults: {
                    let mut m = HashMap::new();
                    m.insert(
                        "model".to_string(),
                        serde_json::json!("claude-sonnet-4-20250514"),
                    );
                    m
                },
                secrets: None,
            },
            capabilities: super::plugin::AgentCapabilities {
                mcp: Some(super::plugin::McpCapability {
                    supported: true,
                    transports: Some(vec!["stdio".into()]),
                }),
                commands: Some(super::plugin::CommandsCapability {
                    supported: true,
                    format: Some("markdown".into()),
                }),
                skills: Some(super::plugin::SkillsCapability {
                    supported: true,
                    format: Some("skill.md".into()),
                }),
                ..Default::default()
            },
            paths: super::plugin::AgentResourcePaths {
                config: path_tpl(
                    "{{projectPath}}/.cursor/settings.json",
                    "json",
                    "Project-level Cursor settings",
                    true,
                ),
                skills: path_tpl(
                    "{{projectPath}}/.cursor/skills",
                    "directory",
                    "Project-level skills",
                    true,
                ),
                commands: path_tpl(
                    "{{projectPath}}/.cursor/commands",
                    "markdown",
                    "Project-level commands",
                    true,
                ),
                mcp: path_tpl(
                    "{{projectPath}}/.cursor/settings.json",
                    "json",
                    "MCP configuration",
                    true,
                ),
                hooks: path_tpl(
                    "{{projectPath}}/.cursor/hooks",
                    "script",
                    "Hook scripts",
                    true,
                ),
                plugins: path_tpl(
                    "{{projectPath}}/.cursor/extensions",
                    "directory",
                    "Extension directory",
                    true,
                ),
                secrets: None,
            },
            lifecycle: None,
        },
        // ── Codex ─────────────────────────────────────────────────────────────
        agent_plugin_shell(
            "codex",
            "Codex",
            Some("codex.png"),
            Some("OpenAI Codex CLI agent"),
            "codex",
            Some(vec![]),
            None,
            &[],
        ),
        // ── Gemini ────────────────────────────────────────────────────────────
        agent_plugin_shell(
            "gemini",
            "Gemini",
            Some("gemini.png"),
            Some("Google Gemini CLI agent"),
            "gemini",
            Some(vec!["--prompt".into()]),
            None,
            &[],
        ),
        // ── Qoder ─────────────────────────────────────────────────────────────
        agent_plugin_shell(
            "qoder",
            "Qoder",
            Some("qoder.svg"),
            Some("Qoder CLI agent"),
            "qodercli",
            Some(vec!["--prompt".into()]),
            None,
            &[],
        ),
        // ── CodeBuddy ─────────────────────────────────────────────────────────
        agent_plugin_shell(
            "codebuddy",
            "CodeBuddy",
            Some("codebuddy.svg"),
            Some("CodeBuddy CLI agent"),
            "codebuddy",
            Some(vec!["--prompt".into()]),
            None,
            &[],
        ),
        // ── OpenCode ──────────────────────────────────────────────────────────
        agent_plugin_shell(
            "opencode",
            "OpenCode",
            Some("opencode.png"),
            Some("OpenCode CLI agent"),
            "opencode",
            Some(vec![
                "run".into(),
                "--pure".into(),
                "--dangerously-skip-permissions=true".into(),
                "-f".into(),
            ]),
            None,
            &[],
        ),
        // ── OMP ───────────────────────────────────────────────────────────────
        agent_plugin_shell(
            "omp",
            "OMP",
            Some("omp.svg"),
            Some("OMP CLI agent"),
            "omp",
            Some(vec!["-p".into()]),
            None,
            &[],
        ),
        // ── Pi ───────────────────────────────────────────────────────────────
        agent_plugin_shell(
            "pi",
            "Pi",
            Some("pi.svg"),
            Some("Pi CLI agent"),
            "pi",
            Some(vec!["-p".into()]),
            None,
            &[],
        ),
        // ── Reasonix ──────────────────────────────────────────────────────────
        agent_plugin_shell(
            "reasonix",
            "Reasonix",
            Some("reasonix.svg"),
            Some("Reasonix CLI agent"),
            "reasonix",
            Some(vec!["run".into(), "--yolo".into()]),
            None,
            &[],
        ),
        // ── Grok ─────────────────────────────────────────────────────────────
        agent_plugin_shell(
            "grok",
            "Grok",
            Some("grok.ico"),
            Some("Grok CLI agent (xAI)"),
            "grok",
            Some(vec!["-p".into()]),
            None,
            &[],
        ),
        // ── Windsurf ──────────────────────────────────────────────────────────
        AgentPlugin {
            id: "windsurf".into(),
            name: "Windsurf".into(),
            icon: Some("windsurf.svg".into()),
            description: Some("Windsurf IDE (Codeium)".into()),
            version: "1.0".into(),
            is_builtin: true,
            enabled: true,
            execution: super::plugin::AgentExecution {
                command: "windsurf".into(),
                args: vec![],
                env: HashMap::new(),
                prompt_args: None,
                post_prompt_args: None,
                detection: Some(super::plugin::AgentDetection {
                    detection_type: "directory".into(),
                    target: "{{projectPath}}/.codeium/windsurf".into(),
                }),
            },
            configuration: super::plugin::AgentConfiguration {
                schema: schema_windsurf(),
                defaults: {
                    let mut m = HashMap::new();
                    m.insert(
                        "model".to_string(),
                        serde_json::json!("claude-sonnet-4-20250514"),
                    );
                    m
                },
                secrets: None,
            },
            capabilities: super::plugin::AgentCapabilities {
                mcp: Some(super::plugin::McpCapability {
                    supported: true,
                    transports: Some(vec!["stdio".into()]),
                }),
                skills: Some(super::plugin::SkillsCapability {
                    supported: true,
                    format: Some("skill.md".into()),
                }),
                ..Default::default()
            },
            paths: super::plugin::AgentResourcePaths {
                config: path_tpl(
                    "{{projectPath}}/.codeium/windsurf/settings.json",
                    "json",
                    "Project settings",
                    true,
                ),
                skills: path_tpl(
                    "{{projectPath}}/.codeium/windsurf/skills",
                    "directory",
                    "Project skills",
                    true,
                ),
                commands: path_tpl(
                    "{{projectPath}}/.codeium/windsurf/commands",
                    "markdown",
                    "Project commands",
                    true,
                ),
                mcp: path_tpl(
                    "{{projectPath}}/.codeium/windsurf/settings.json",
                    "json",
                    "MCP configuration",
                    true,
                ),
                hooks: path_tpl(
                    "{{projectPath}}/.codeium/windsurf/hooks",
                    "script",
                    "Hook scripts",
                    true,
                ),
                plugins: path_tpl(
                    "{{projectPath}}/.codeium/windsurf/extensions",
                    "directory",
                    "Extension directory",
                    true,
                ),
                secrets: None,
            },
            lifecycle: None,
        },
    ]
}

// ─── Schema Definitions ───────────────────────────────────────────────────

/// Claude Code: full schema with model, permissions, mcpServers, env.
fn schema_claude_code() -> serde_json::Value {
    serde_json::json!({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
            "model": {
                "type": "string",
                "enum": ["sonnet", "opus", "haiku"],
                "default": "sonnet",
                "description": "Default Claude model"
            },
            "permissions": {
                "type": "object",
                "description": "Tool permission rules",
                "properties": {
                    "allow": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Allowed tools"
                    },
                    "deny": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Denied tools"
                    }
                }
            },
            "mcpServers": {
                "type": "object",
                "description": "MCP server configurations",
                "additionalProperties": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string" },
                        "args": { "type": "array", "items": { "type": "string" } },
                        "env": { "type": "object", "additionalProperties": { "type": "string" } }
                    },
                    "required": ["command"]
                }
            },
            "env": {
                "type": "object",
                "description": "Environment variables",
                "additionalProperties": { "type": "string" }
            },
            "verbose": {
                "type": "boolean",
                "default": false,
                "description": "Enable verbose output"
            }
        }
    })
}

/// Cursor: model, rules, mcpServers.
fn schema_cursor() -> serde_json::Value {
    serde_json::json!({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
            "model": {
                "type": "string",
                "enum": [
                    "claude-sonnet-4-20250514",
                    "claude-opus-4-20250514",
                    "gpt-4o",
                    "gpt-4o-mini",
                    "o1",
                    "o1-mini"
                ],
                "default": "claude-sonnet-4-20250514",
                "description": "Default AI model"
            },
            "rules": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Cursor rules (always-apply instructions)"
            },
            "mcpServers": {
                "type": "object",
                "description": "MCP server configurations",
                "additionalProperties": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string" },
                        "args": { "type": "array", "items": { "type": "string" } }
                    },
                    "required": ["command"]
                }
            },
            "telemetry": {
                "type": "boolean",
                "default": true,
                "description": "Enable telemetry"
            }
        }
    })
}

/// Windsurf: model, rules.
fn schema_windsurf() -> serde_json::Value {
    serde_json::json!({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
            "model": {
                "type": "string",
                "enum": [
                    "claude-sonnet-4-20250514",
                    "claude-opus-4-20250514",
                    "gpt-4o",
                    "gemini-2.5-pro"
                ],
                "default": "claude-sonnet-4-20250514",
                "description": "Default AI model"
            },
            "rules": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Windsurf rules"
            },
            "enableMemory": {
                "type": "boolean",
                "default": false,
                "description": "Enable conversation memory"
            }
        }
    })
}

/// Generic schema for shell-based CLI agents (codex, gemini, qoder, etc.).
fn schema_for_shell_agent(id: &str) -> serde_json::Value {
    let model_enum = match id {
        "gemini" => serde_json::json!(["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"]),
        "codex" => serde_json::json!(["o1", "o1-mini", "o3-mini", "gpt-4o", "gpt-4o-mini"]),
        "qoder" => serde_json::json!(["qoder-1.0", "qoder-2.0", "claude-sonnet-4-20250514"]),
        "codebuddy" => {
            serde_json::json!(["codebuddy-default", "claude-sonnet-4-20250514", "gpt-4o"])
        }
        "opencode" => serde_json::json!(["claude-sonnet-4-20250514", "gpt-4o", "gemini-2.5-pro"]),
        "omp" => serde_json::json!(["omp-default", "claude-sonnet-4-20250514"]),
        "pi" => serde_json::json!(["pi-default", "pi-pro"]),
        "reasonix" => serde_json::json!(["reasonix-default", "claude-opus-4-20250514"]),
        "grok" => serde_json::json!(["grok-3", "grok-3-mini", "grok-2"]),
        _ => serde_json::json!(["default"]),
    };

    let default_model = match id {
        "gemini" => "gemini-2.5-pro",
        "codex" => "o1",
        "qoder" => "qoder-2.0",
        "codebuddy" => "codebuddy-default",
        "opencode" => "claude-sonnet-4-20250514",
        "omp" => "omp-default",
        "pi" => "pi-default",
        "reasonix" => "reasonix-default",
        "grok" => "grok-3",
        _ => "default",
    };

    serde_json::json!({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
            "model": {
                "type": "string",
                "enum": model_enum,
                "default": default_model,
                "description": "Default AI model"
            },
            "systemInstruction": {
                "type": "string",
                "description": "System-level instruction prepended to every session"
            },
            "tools": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Enabled tool names"
            },
            "verbose": {
                "type": "boolean",
                "default": false,
                "description": "Enable verbose output"
            }
        }
    })
}

/// Helper: construct a `PathTemplate`.
fn path_tpl(
    relative: &str,
    format: &str,
    description: &str,
    project_level: bool,
) -> super::plugin::PathTemplate {
    super::plugin::PathTemplate {
        relative: relative.into(),
        format: format.into(),
        description: Some(description.into()),
        project_level,
    }
}

/// Helper: construct a simple CLI-agent plugin with skills support only.
#[allow(clippy::too_many_arguments)]
fn agent_plugin_shell(
    id: &str,
    name: &str,
    icon: Option<&str>,
    description: Option<&str>,
    command: &str,
    prompt_args: Option<Vec<String>>,
    post_prompt_args: Option<Vec<String>>,
    _capabilities_extra: &[&str],
) -> AgentPlugin {
    let schema = schema_for_shell_agent(id);
    let defaults: HashMap<String, serde_json::Value> = schema
        .pointer("/properties/model/default")
        .and_then(|v| v.as_str())
        .map(|m| {
            let mut map = HashMap::new();
            map.insert("model".to_string(), serde_json::json!(m));
            map
        })
        .unwrap_or_default();
    AgentPlugin {
        id: id.into(),
        name: name.into(),
        icon: icon.map(String::from),
        description: description.map(String::from),
        version: "1.0".into(),
        is_builtin: true,
        enabled: true,
        execution: super::plugin::AgentExecution {
            command: command.into(),
            args: vec![],
            env: HashMap::new(),
            prompt_args,
            post_prompt_args,
            detection: Some(super::plugin::AgentDetection {
                detection_type: "command".into(),
                target: command.into(),
            }),
        },
        configuration: super::plugin::AgentConfiguration {
            schema,
            defaults,
            secrets: None,
        },
        capabilities: super::plugin::AgentCapabilities {
            skills: Some(super::plugin::SkillsCapability {
                supported: true,
                format: Some("skill.md".into()),
            }),
            mcp: Some(super::plugin::McpCapability {
                supported: true,
                transports: Some(vec!["stdio".into(), "sse".into(), "http".into()]),
            }),
            ..Default::default()
        },
        paths: super::plugin::AgentResourcePaths {
            config: path_tpl(
                &format!("{{{{home}}}}/.{id}/config.json"),
                "json",
                "Agent configuration",
                false,
            ),
            skills: path_tpl(
                &format!("{{{{projectPath}}}}/.{id}/skills"),
                "directory",
                "Project-level skills",
                true,
            ),
            commands: path_tpl(
                &format!("{{{{projectPath}}}}/.{id}/commands"),
                "markdown",
                "Project-level commands",
                true,
            ),
            mcp: path_tpl(
                &format!("{{{{home}}}}/.{id}/config.json"),
                "json",
                "MCP configuration",
                false,
            ),
            hooks: path_tpl(
                &format!("{{{{projectPath}}}}/.{id}/hooks"),
                "script",
                "Hook scripts",
                true,
            ),
            plugins: path_tpl(
                &format!("{{{{projectPath}}}}/.{id}/plugins"),
                "directory",
                "Plugin directory",
                true,
            ),
            secrets: None,
        },
        lifecycle: None,
    }
}

/// Build a lookup map: plugin_id → AgentPlugin.
#[must_use]
pub fn plugin_map() -> HashMap<String, AgentPlugin> {
    default_agent_plugins()
        .into_iter()
        .map(|p| (p.id.clone(), p))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_provide_eleven_builtin_plugins() {
        let plugins = default_agent_plugins();
        assert!(
            plugins.len() >= 11,
            "expected at least 11 built-in plugins, got {}",
            plugins.len()
        );
    }

    #[test]
    fn should_include_all_expected_ids() {
        let plugins = default_agent_plugins();
        let ids: Vec<&str> = plugins.iter().map(|p| p.id.as_str()).collect();
        for expected in [
            "claude-code",
            "cursor",
            "codex",
            "gemini",
            "qoder",
            "codebuddy",
            "opencode",
            "omp",
            "pi",
            "reasonix",
            "grok",
            "windsurf",
        ] {
            assert!(
                ids.contains(&expected),
                "missing plugin {expected}: {ids:?}"
            );
        }
    }

    #[test]
    fn should_mark_all_as_builtin_and_enabled() {
        for plugin in default_agent_plugins() {
            assert!(plugin.is_builtin, "{} should be builtin", plugin.id);
            assert!(plugin.enabled, "{} should be enabled", plugin.id);
        }
    }

    #[test]
    fn should_have_valid_skills_path() {
        for plugin in default_agent_plugins() {
            assert!(
                !plugin.paths.skills.relative.is_empty(),
                "{} skills path empty",
                plugin.id
            );
        }
    }

    #[test]
    fn plugin_map_returns_lookup() {
        let map = plugin_map();
        assert!(map.contains_key("claude-code"));
        assert!(map.contains_key("cursor"));
        assert!(!map.contains_key("nonexistent"));
    }
}
