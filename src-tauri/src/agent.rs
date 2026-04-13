use crate::state::agent::AgentConfig;
use std::collections::HashMap;
use std::process::{Command, Stdio};

/// Check if a command exists on the system PATH.
pub fn check_command_exists(command: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        Command::new("cmd")
            .args(["/c", &format!("where {}", command)])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("sh")
            .args(["-c", &format!("which {}", command)])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

pub struct AgentManager {
    agents: Vec<AgentConfig>,
}

impl AgentManager {
    pub fn new() -> Self {
        let mut manager = Self { agents: Vec::new() };

        // 添加预设的 Agent
        manager.add_default_agents();
        manager
    }

    fn add_default_agents(&mut self) {
        // opencode
        self.agents.push(AgentConfig {
            id: "opencode".to_string(),
            name: "opencode".to_string(),
            command: "opencode".to_string(),
            args: vec![],
            env: HashMap::new(),
            icon: Some("opencode.png".to_string()),
            enabled: true,
        });

        // claude code
        self.agents.push(AgentConfig {
            id: "claude-code".to_string(),
            name: "claude-code".to_string(),
            command: "claude".to_string(),
            args: vec![],
            env: HashMap::new(),
            icon: Some("claude-code.png".to_string()),
            enabled: true,
        });

        // qwen
        self.agents.push(AgentConfig {
            id: "qwen".to_string(),
            name: "qwen".to_string(),
            command: "qwen".to_string(),
            args: vec![],
            env: HashMap::new(),
            icon: Some("qwen.png".to_string()),
            enabled: true,
        });

        // gemini
        self.agents.push(AgentConfig {
            id: "gemini".to_string(),
            name: "gemini".to_string(),
            command: "gemini".to_string(),
            args: vec![],
            env: HashMap::new(),
            icon: Some("gemini.png".to_string()),
            enabled: true,
        });

        // codex
        self.agents.push(AgentConfig {
            id: "codex".to_string(),
            name: "codex".to_string(),
            command: "codex".to_string(),
            args: vec![],
            env: HashMap::new(),
            icon: Some("codex.png".to_string()),
            enabled: true,
        });

        // qoder
        self.agents.push(AgentConfig {
            id: "qoder".to_string(),
            name: "qoder".to_string(),
            command: "qodercli".to_string(),
            args: vec![],
            env: HashMap::new(),
            icon: Some("qoder.svg".to_string()),
            enabled: true,
        });

        // codebuddy
        self.agents.push(AgentConfig {
            id: "codebuddy".to_string(),
            name: "codebuddy".to_string(),
            command: "codebuddy".to_string(),
            args: vec![],
            env: HashMap::new(),
            icon: Some("codebuddy.svg".to_string()),
            enabled: true,
        });
    }

    pub fn get_agents(&self) -> Vec<AgentConfig> {
        self.agents.clone()
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
    /// Unknown agent IDs map to false.
    pub fn check_installed(&self, agent_ids: &[String]) -> HashMap<String, bool> {
        let mut result = HashMap::new();
        for id in agent_ids {
            let installed = self
                .agents
                .iter()
                .find(|a| a.id == *id)
                .map(|a| check_command_exists(&a.command))
                .unwrap_or(false);
            result.insert(id.clone(), installed);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_initialize_with_seven_presets() {
        let manager = AgentManager::new();
        assert_eq!(manager.get_agents().len(), 7);
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
            id: "custom".to_string(),
            name: "Custom Agent".to_string(),
            command: "custom".to_string(),
            args: vec![],
            env: HashMap::new(),
            icon: None,
            enabled: true,
        };
        manager.add_agent(custom);
        assert_eq!(manager.get_agents().len(), 8);
        assert!(manager.get_agent("custom").is_some());
    }

    #[test]
    fn should_remove_agent() {
        let mut manager = AgentManager::new();
        manager.remove_agent("opencode");
        assert_eq!(manager.get_agents().len(), 6);
        assert!(manager.get_agent("opencode").is_none());
    }

    #[test]
    fn should_not_panic_when_removing_nonexistent() {
        let mut manager = AgentManager::new();
        manager.remove_agent("nonexistent");
        assert_eq!(manager.get_agents().len(), 7);
    }

    #[test]
    fn should_contain_all_expected_presets() {
        let manager = AgentManager::new();
        let agents = manager.get_agents();
        let ids: Vec<&str> = agents.iter().map(|a| a.id.as_str()).collect();
        assert!(ids.contains(&"opencode"));
        assert!(ids.contains(&"claude-code"));
        assert!(ids.contains(&"qwen"));
        assert!(ids.contains(&"gemini"));
        assert!(ids.contains(&"codex"));
        assert!(ids.contains(&"qoder"));
        assert!(ids.contains(&"codebuddy"));
    }

    #[test]
    fn should_have_all_agents_enabled_by_default() {
        let manager = AgentManager::new();
        assert!(manager.get_agents().iter().all(|a| a.enabled));
    }

    #[test]
    fn should_return_true_for_existing_command() {
        #[cfg(target_os = "windows")]
        let cmd = "cmd";
        #[cfg(not(target_os = "windows"))]
        let cmd = "sh";
        assert!(check_command_exists(cmd));
    }

    #[test]
    fn should_return_false_for_nonexistent_command() {
        assert!(!check_command_exists("nonexistent_command_xyz_12345"));
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
}
