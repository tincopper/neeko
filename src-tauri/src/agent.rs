use crate::state::AgentConfig;
use std::collections::HashMap;

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
            command: "qoder".to_string(),
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
}
