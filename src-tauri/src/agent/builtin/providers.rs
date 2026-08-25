//! 内置 Agent 单一事实源 —— 11 个 `AgentConfig`（纯数据）。
//!
//! 数据只有一份（AgentConfig），不再有独立的 provider 数据层；运行时行为
//! 经 `AgentProvider::from(&config)` 获得。id 字面量直接在此定义（无 ids.rs）。

use std::collections::HashMap;

use crate::common::agent::types::{AgentConfig, ChatStart, DeploySpec, Detection};

/// 返回全部内置 AgentConfig（11 个）。
#[must_use]
pub fn builtin_configs() -> Vec<AgentConfig> {
    vec![
        // ── Claude Code ───────────────────────────────────────────────────────
        AgentConfig {
            id: "claude-code".into(),
            name: "Claude Code".into(),
            icon: Some("claude-code.png".into()),
            enabled: true,
            is_builtin: true,
            command: "claude".into(),
            args: vec![],
            env: HashMap::new(),
            chat: None,
            prompt_args: Some(vec!["--bare".into(), "-p".into()]),
            post_prompt_args: Some(vec!["--dangerously-skip-permissions".into()]),
            skill_path: Some("~/.claude/skills".into()),
            detection: Some(Detection::Command {
                target: "claude".into(),
            }),
            deploy: DeploySpec {
                // claude-code 目录是 .claude（id 是 claude-code）
                skills: "{{projectPath}}/.claude/skills".into(),
                commands: Some("{{projectPath}}/.claude/commands".into()),
                mcp_config: Some("{{home}}/.claude/settings.json".into()),
            },
        },
        // ── Shell CLI agents（9 个；opencode 带 serve CHAT 能力）─────────────
        shell_agent(
            "opencode",
            "OpenCode",
            "opencode.png",
            "opencode",
            Some(&["run", "--pure", "--dangerously-skip-permissions=true", "-f"]),
            None,
            Some(ChatStart::Serve),
            "~/.config/opencode/skills",
        ),
        shell_agent(
            "gemini",
            "Gemini",
            "gemini.png",
            "gemini",
            Some(&["--prompt"]),
            None,
            None,
            "~/.gemini/skills",
        ),
        shell_agent(
            "codex",
            "Codex",
            "codex.png",
            "codex",
            Some(&[]),
            None,
            None,
            "~/.codex/skills",
        ),
        shell_agent(
            "qoder",
            "Qoder",
            "qoder.svg",
            "qodercli",
            Some(&["--prompt"]),
            None,
            None,
            "~/.qoder/skills",
        ),
        shell_agent(
            "codebuddy",
            "CodeBuddy",
            "codebuddy.svg",
            "codebuddy",
            Some(&["--prompt"]),
            None,
            None,
            "~/.codebuddy/skills",
        ),
        shell_agent(
            "omp",
            "OMP",
            "omp.svg",
            "omp",
            Some(&["-p"]),
            None,
            None,
            "~/.omp/skills",
        ),
        shell_agent(
            "pi",
            "Pi",
            "pi.svg",
            "pi",
            Some(&["-p"]),
            None,
            None,
            "~/.pi/skills",
        ),
        shell_agent(
            "reasonix",
            "Reasonix",
            "reasonix.svg",
            "reasonix",
            Some(&["run", "--yolo"]),
            None,
            None,
            "~/.reasonix/skills",
        ),
        shell_agent(
            "grok",
            "Grok",
            "grok.ico",
            "grok",
            Some(&["-p"]),
            None,
            None,
            "~/.grok/skills",
        ),
        // ── mockAgent（进程内 CHAT mock，无 CLI 能力）────────────────────────
        AgentConfig {
            id: "mockAgent".into(),
            name: "mockAgent".into(),
            icon: Some("mock.png".into()),
            enabled: true,
            is_builtin: true,
            command: String::new(),
            args: vec![],
            env: HashMap::new(),
            chat: Some(ChatStart::Mock),
            prompt_args: None,
            post_prompt_args: None,
            skill_path: Some("~/.mock-agent/skills".into()),
            detection: None,
            deploy: DeploySpec {
                skills: "{{projectPath}}/.mock-agent/skills".into(),
                commands: None,
                mcp_config: None,
            },
        },
    ]
}

/// 返回内置 AgentConfig（`builtin_configs` 的兼容别名）。
#[must_use]
pub fn default_configs() -> Vec<AgentConfig> {
    builtin_configs()
}

/// Build a lookup map: agent_id → AgentConfig.
#[must_use]
pub fn config_map() -> HashMap<String, AgentConfig> {
    builtin_configs()
        .into_iter()
        .map(|c| (c.id.clone(), c))
        .collect()
}

/// 构造一个标准 CLI agent：skills/commands 位于 `{{projectPath}}/.{id}/` 下、
/// MCP 配置位于 `{{home}}/.{id}/config.json`，detection = command。
#[allow(clippy::too_many_arguments)]
fn shell_agent(
    id: &'static str,
    name: &'static str,
    icon: &'static str,
    command: &'static str,
    prompt_args: Option<&[&'static str]>,
    post_prompt_args: Option<&[&'static str]>,
    chat: Option<ChatStart>,
    skill_path: &'static str,
) -> AgentConfig {
    AgentConfig {
        id: id.into(),
        name: name.into(),
        icon: Some(icon.into()),
        enabled: true,
        is_builtin: true,
        command: command.into(),
        args: vec![],
        env: HashMap::new(),
        chat,
        prompt_args: prompt_args.map(|a| a.iter().map(|s| (*s).into()).collect()),
        post_prompt_args: post_prompt_args.map(|a| a.iter().map(|s| (*s).into()).collect()),
        skill_path: Some(skill_path.into()),
        detection: Some(Detection::Command {
            target: command.into(),
        }),
        deploy: DeploySpec {
            skills: format!("{{{{projectPath}}}}/.{id}/skills"),
            commands: Some(format!("{{{{projectPath}}}}/.{id}/commands")),
            mcp_config: Some(format!("{{{{home}}}}/.{id}/config.json")),
        },
    }
}
