//! Agent registry and installation-check logic.

use crate::common::agent::types::AgentConfig;
use crate::common::executor::factory::ExecTarget;
use std::collections::HashMap;

/// Registry of AI agent configurations.
pub struct AgentManager {
    agents: Vec<AgentConfig>,
}

impl Default for AgentManager {
    /// Create a default `AgentManager` with built-in agents.
    fn default() -> Self {
        Self::new()
    }
}

impl AgentManager {
    /// Create a new `AgentManager` with the default built-in agents.
    pub fn new() -> Self {
        let mut manager = Self { agents: Vec::new() };
        manager.agents = default_agents();
        manager
    }

    /// Return all registered agents.
    pub fn get_agents(&self) -> &[AgentConfig] {
        &self.agents
    }

    /// Get an agent by ID.
    pub fn get_agent(&self, agent_id: &str) -> Option<&AgentConfig> {
        self.agents.iter().find(|a| a.id == agent_id)
    }

    /// Register a new agent.
    pub fn add_agent(&mut self, agent: AgentConfig) {
        self.agents.push(agent);
    }

    /// Unregister an agent by ID.
    pub fn remove_agent(&mut self, agent_id: &str) {
        self.agents.retain(|a| a.id != agent_id);
    }

    /// Resolve agent IDs to their CLI command names.
    pub fn resolve_commands(&self, agent_ids: &[String]) -> Vec<(String, Option<String>)> {
        agent_ids
            .iter()
            .map(|id| {
                let cmd = self.get_agent(id).map(|a| a.command.clone());
                (id.clone(), cmd)
            })
            .collect()
    }

    /// Check whether each agent CLI exists in the given execution target.
    pub async fn check_installed(
        commands: &[(String, Option<String>)],
        target: &ExecTarget,
    ) -> HashMap<String, bool> {
        let mut result = HashMap::new();
        for (id, cmd) in commands {
            let installed = match cmd.as_deref() {
                Some(c) => crate::core::exec::command_exists(target, c).await,
                None => false,
            };
            result.insert(id.clone(), installed);
        }
        result
    }
}

/// Return the list of built-in default agents.
fn default_agents() -> Vec<AgentConfig> {
    vec![
        AgentConfig {
            id: "opencode".into(),
            name: "opencode".into(),
            command: "opencode".into(),
            icon: Some("opencode.png".into()),
            enabled: true,
            prompt_args: Some(vec![
                "run".into(),
                "--pure".into(),
                "--dangerously-skip-permissions=true".into(),
                "-f".into(),
            ]),
            is_builtin: true,
            skill_path: Some("~/.config/opencode/skills".into()),
            ..Default::default()
        },
        AgentConfig {
            id: "claude-code".into(),
            name: "claude-code".into(),
            command: "claude".into(),
            icon: Some("claude-code.png".into()),
            enabled: true,
            prompt_args: Some(vec!["--bare".into(), "-p".into()]),
            post_prompt_args: Some(vec!["--dangerously-skip-permissions".into()]),
            is_builtin: true,
            skill_path: Some("~/.claude/skills".into()),
            ..Default::default()
        },
        AgentConfig {
            id: "gemini".into(),
            name: "gemini".into(),
            command: "gemini".into(),
            icon: Some("gemini.png".into()),
            enabled: true,
            prompt_args: Some(vec!["--prompt".into()]),
            is_builtin: true,
            skill_path: Some("~/.gemini/skills".into()),
            ..Default::default()
        },
        AgentConfig {
            id: "codex".into(),
            name: "codex".into(),
            command: "codex".into(),
            icon: Some("codex.png".into()),
            enabled: true,
            prompt_args: Some(vec![]),
            is_builtin: true,
            skill_path: Some("~/.codex/skills".into()),
            ..Default::default()
        },
        AgentConfig {
            id: "qoder".into(),
            name: "qoder".into(),
            command: "qodercli".into(),
            icon: Some("qoder.svg".into()),
            enabled: true,
            prompt_args: Some(vec!["--prompt".into()]),
            is_builtin: true,
            skill_path: Some("~/.qoder/skills".into()),
            ..Default::default()
        },
        AgentConfig {
            id: "codebuddy".into(),
            name: "codebuddy".into(),
            command: "codebuddy".into(),
            icon: Some("codebuddy.svg".into()),
            enabled: true,
            prompt_args: Some(vec!["--prompt".into()]),
            is_builtin: true,
            skill_path: Some("~/.codebuddy/skills".into()),
            ..Default::default()
        },
        AgentConfig {
            id: "pi".into(),
            name: "pi".into(),
            command: "pi".into(),
            icon: Some("pi.svg".into()),
            enabled: true,
            prompt_args: Some(vec!["-p".into()]),
            is_builtin: true,
            skill_path: Some("~/.pi/skills".into()),
            ..Default::default()
        },
        AgentConfig {
            id: "omp".into(),
            name: "omp".into(),
            command: "omp".into(),
            icon: Some("omp.svg".into()),
            enabled: true,
            prompt_args: Some(vec!["-p".into()]),
            is_builtin: true,
            skill_path: Some("~/.omp/skills".into()),
            ..Default::default()
        },
        AgentConfig {
            id: "reasonix".into(),
            name: "reasonix".into(),
            command: "reasonix".into(),
            icon: Some("reasonix.svg".into()),
            enabled: true,
            prompt_args: Some(vec!["run".into(), "--yolo".into()]),
            is_builtin: true,
            skill_path: Some("~/.reasonix/skills".into()),
            ..Default::default()
        },
        AgentConfig {
            id: "grok".into(),
            name: "grok".into(),
            command: "grok".into(),
            icon: Some("grok.ico".into()),
            enabled: true,
            // headless single-turn: `grok -p "<prompt>"`
            prompt_args: Some(vec!["-p".into()]),
            is_builtin: true,
            skill_path: Some("~/.grok/skills".into()),
            ..Default::default()
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_initialize_with_ten_presets() {
        let manager = AgentManager::new();
        assert_eq!(manager.get_agents().len(), 10);
    }

    #[test]
    fn should_include_grok_default_agent() {
        let manager = AgentManager::new();
        let agent = manager.get_agent("grok").expect("grok should be a default agent");
        assert_eq!(agent.command, "grok");
        assert_eq!(agent.icon.as_deref(), Some("grok.ico"));
        assert!(agent.is_builtin);
    }

    #[test]
    fn should_mark_all_default_agents_as_builtin_with_skill_path() {
        let manager = AgentManager::new();
        for agent in manager.get_agents() {
            assert!(
                agent.is_builtin,
                "default agent {} should be marked is_builtin",
                agent.id
            );
            assert!(
                agent.skill_path.is_some(),
                "default agent {} should have skill_path",
                agent.id
            );
        }
    }

    #[test]
    fn should_find_agent_by_id() {
        let manager = AgentManager::new();
        let agent = manager.get_agent("opencode");
        assert!(agent.is_some());
        assert_eq!(agent.unwrap().name, "opencode");
    }

    #[test]
    fn should_return_none_for_unknown_id() {
        let manager = AgentManager::new();
        assert!(manager.get_agent("nonexistent").is_none());
    }

    #[test]
    fn should_add_custom_agent() {
        let mut manager = AgentManager::new();
        let before = manager.get_agents().len();
        let custom = AgentConfig {
            id: "custom".into(),
            name: "Custom Agent".into(),
            command: "custom".into(),
            ..Default::default()
        };
        manager.add_agent(custom);
        assert_eq!(manager.get_agents().len(), before + 1);
        assert!(manager.get_agent("custom").is_some());
    }

    #[test]
    fn should_remove_agent() {
        let mut manager = AgentManager::new();
        let before = manager.get_agents().len();
        manager.remove_agent("opencode");
        assert_eq!(manager.get_agents().len(), before - 1);
        assert!(manager.get_agent("opencode").is_none());
    }

    #[test]
    fn should_not_panic_when_removing_nonexistent() {
        let mut manager = AgentManager::new();
        let before = manager.get_agents().len();
        manager.remove_agent("nonexistent");
        assert_eq!(manager.get_agents().len(), before);
    }

    #[test]
    fn should_contain_all_expected_presets() {
        let manager = AgentManager::new();
        let agents = manager.get_agents();
        let ids: Vec<&str> = agents.iter().map(|a| a.id.as_str()).collect();
        for expected in [
            "opencode",
            "claude-code",
            "gemini",
            "codex",
            "qoder",
            "codebuddy",
            "pi",
            "omp",
            "reasonix",
            "grok",
        ] {
            assert!(
                ids.contains(&expected),
                "missing default agent {expected}: {ids:?}"
            );
        }
    }

    #[test]
    fn should_have_all_agents_enabled_by_default() {
        let manager = AgentManager::new();
        assert!(manager.get_agents().iter().all(|a| a.enabled));
    }

    #[tokio::test]
    async fn should_check_installed_returns_map_on_local_target() {
        let manager = AgentManager::new();
        let ids = vec!["opencode".to_string()];
        let commands = manager.resolve_commands(&ids);
        let result = AgentManager::check_installed(&commands, &ExecTarget::Local).await;
        assert!(result.contains_key("opencode"));
    }

    #[tokio::test]
    async fn should_check_installed_returns_false_for_unknown() {
        let manager = AgentManager::new();
        let ids = vec!["nonexistent".to_string()];
        let commands = manager.resolve_commands(&ids);
        assert_eq!(commands[0].1, None);
        let result = AgentManager::check_installed(&commands, &ExecTarget::Local).await;
        assert_eq!(result.get("nonexistent"), Some(&false));
    }

    #[tokio::test]
    async fn should_check_installed_empty_input() {
        let result = AgentManager::check_installed(&[], &ExecTarget::Local).await;
        assert!(result.is_empty());
    }

    #[test]
    fn should_resolve_commands_for_known_and_unknown() {
        let manager = AgentManager::new();
        let ids = vec!["opencode".into(), "nope".into()];
        let commands = manager.resolve_commands(&ids);
        assert_eq!(commands.len(), 2);
        assert_eq!(commands[0].1.as_deref(), Some("opencode"));
        assert_eq!(commands[1].1, None);
    }

    #[test]
    fn should_allow_duplicate_ids_on_add() {
        let mut manager = AgentManager::new();
        let before = manager.get_agents().len();
        let dup = AgentConfig {
            id: "opencode".into(),
            name: "dup".into(),
            command: "dup".into(),
            ..Default::default()
        };
        manager.add_agent(dup);
        // Current behavior: allows duplicates, get_agent returns first match
        assert_eq!(manager.get_agent("opencode").unwrap().name, "opencode");
        assert_eq!(manager.get_agents().len(), before + 1);
    }

    #[test]
    fn should_resolve_prompt_args_for_opencode() {
        let manager = AgentManager::new();
        let agent = manager.get_agent("opencode").unwrap();
        let args = agent.resolve_prompt_args();
        assert!(args.is_some());
        assert!(args.unwrap().contains(&"run".to_string()));
    }

    #[test]
    fn should_resolve_post_prompt_args_for_claude() {
        let manager = AgentManager::new();
        let agent = manager.get_agent("claude-code").unwrap();
        let args = agent.resolve_post_prompt_args();
        assert!(args.contains(&"--dangerously-skip-permissions".to_string()));
    }

    #[test]
    fn should_return_empty_vec_for_agent_without_post_prompt_args() {
        let manager = AgentManager::new();
        let agent = manager.get_agent("opencode").unwrap();
        let args = agent.resolve_post_prompt_args();
        assert!(args.is_empty());
    }
}
