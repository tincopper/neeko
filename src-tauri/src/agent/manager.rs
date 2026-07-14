use crate::common::agent::types::AgentConfig;
use std::collections::HashMap;

pub struct AgentManager {
    agents: Vec<AgentConfig>,
}

impl Default for AgentManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentManager {
    pub fn new() -> Self {
        let mut manager = Self { agents: Vec::new() };
        manager.agents = default_agents();
        manager
    }

    pub fn get_agents(&self) -> &[AgentConfig] {
        &self.agents
    }

    pub fn get_agent(&self, agent_id: &str) -> Option<&AgentConfig> {
        self.agents.iter().find(|a| a.id == agent_id)
    }

    pub fn add_agent(&mut self, agent: AgentConfig) {
        self.agents.push(agent);
    }

    pub fn remove_agent(&mut self, agent_id: &str) {
        self.agents.retain(|a| a.id != agent_id);
    }

    /// Check if agents are installed on the system.
    /// Returns a map of agent_id -> whether the agent's command exists.
    pub fn check_installed(&self, agent_ids: &[String]) -> HashMap<String, bool> {
        agent_ids
            .iter()
            .map(|id| {
                let installed = self
                    .agents
                    .iter()
                    .find(|a| a.id == *id)
                    .map(|a| crate::common::utils::command::local::check_command_exists(&a.command))
                    .unwrap_or(false);
                (id.clone(), installed)
            })
            .collect()
    }
}

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
            default_skill_path: Some("~/.agents/skills".into()),
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
            default_skill_path: Some("~/.claude/skills".into()),
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
            default_skill_path: Some("~/.gemini/skills".into()),
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
            default_skill_path: Some("~/.codex/skills".into()),
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
            default_skill_path: Some("~/.qoder/skills".into()),
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
            default_skill_path: Some("~/.codebuddy/skills".into()),
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
            default_skill_path: Some("~/.pi/skills".into()),
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
            default_skill_path: Some("~/.omp/skills".into()),
            ..Default::default()
        },
        AgentConfig {
            id: "reasonix".into(),
            name: "reasonix".into(),
            command: "reasonix".into(),
            icon: Some("reasonix.svg".into()),
            enabled: true,
            prompt_args: Some(vec![
              "run".into(),
              "--yolo".into()
            ]),
            is_builtin: true,
            default_skill_path: Some("~/.reasonix/skills".into()),
            ..Default::default()
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_initialize_with_nine_presets() {
        let manager = AgentManager::new();
        assert_eq!(manager.get_agents().len(), 9);
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
                agent.default_skill_path.is_some(),
                "default agent {} should have default_skill_path",
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
        let custom = AgentConfig {
            id: "custom".into(),
            name: "Custom Agent".into(),
            command: "custom".into(),
            ..Default::default()
        };
        manager.add_agent(custom);
        assert_eq!(manager.get_agents().len(), 10);
        assert!(manager.get_agent("custom").is_some());
    }

    #[test]
    fn should_remove_agent() {
        let mut manager = AgentManager::new();
        manager.remove_agent("opencode");
        assert_eq!(manager.get_agents().len(), 8);
        assert!(manager.get_agent("opencode").is_none());
    }

    #[test]
    fn should_not_panic_when_removing_nonexistent() {
        let mut manager = AgentManager::new();
        manager.remove_agent("nonexistent");
        assert_eq!(manager.get_agents().len(), 9);
    }

    #[test]
    fn should_contain_all_expected_presets() {
        let manager = AgentManager::new();
        let agents = manager.get_agents();
        let ids: Vec<&str> = agents.iter().map(|a| a.id.as_str()).collect();
        assert!(ids.contains(&"opencode"));
        assert!(ids.contains(&"claude-code"));
        assert!(ids.contains(&"gemini"));
        assert!(ids.contains(&"codex"));
        assert!(ids.contains(&"qoder"));
        assert!(ids.contains(&"codebuddy"));
        assert!(ids.contains(&"pi"));
    }

    #[test]
    fn should_have_all_agents_enabled_by_default() {
        let manager = AgentManager::new();
        assert!(manager.get_agents().iter().all(|a| a.enabled));
    }

    #[test]
    fn should_check_installed_returns_map() {
        let manager = AgentManager::new();
        let ids = vec!["opencode".to_string()];
        let result = manager.check_installed(&ids);
        assert!(result.contains_key("opencode"));
    }

    #[test]
    fn should_check_installed_returns_false_for_unknown() {
        let manager = AgentManager::new();
        let ids = vec!["nonexistent".to_string()];
        let result = manager.check_installed(&ids);
        assert_eq!(result.get("nonexistent"), Some(&false));
    }

    #[test]
    fn should_check_installed_empty_input() {
        let manager = AgentManager::new();
        let result = manager.check_installed(&[]);
        assert!(result.is_empty());
    }

    #[test]
    fn should_allow_duplicate_ids_on_add() {
        let mut manager = AgentManager::new();
        let dup = AgentConfig {
            id: "opencode".into(),
            name: "dup".into(),
            command: "dup".into(),
            ..Default::default()
        };
        manager.add_agent(dup);
        // Current behavior: allows duplicates, get_agent returns first match
        assert_eq!(manager.get_agent("opencode").unwrap().name, "opencode");
        assert_eq!(manager.get_agents().len(), 10);
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
