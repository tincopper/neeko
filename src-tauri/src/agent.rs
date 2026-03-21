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
            icon: Some("🤖".to_string()),
            enabled: true,
        });

        // claude code
        self.agents.push(AgentConfig {
            id: "claude-code".to_string(),
            name: "claude-code".to_string(),
            command: "claude".to_string(),
            args: vec![],
            env: HashMap::new(),
            icon: Some("🧠".to_string()),
            enabled: true,
        });

        // cursor-agent
        self.agents.push(AgentConfig {
            id: "cursor-agent".to_string(),
            name: "cursor-agent".to_string(),
            command: "cursor-agent".to_string(),
            args: vec![],
            env: HashMap::new(),
            icon: Some("🖱️".to_string()),
            enabled: true,
        });

        // aider
        self.agents.push(AgentConfig {
            id: "aider".to_string(),
            name: "aider".to_string(),
            command: "aider".to_string(),
            args: vec![],
            env: HashMap::new(),
            icon: Some("💡".to_string()),
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

    pub fn update_agent(&mut self, agent: AgentConfig) {
        if let Some(existing) = self.agents.iter_mut().find(|a| a.id == agent.id) {
            *existing = agent;
        }
    }

    pub fn toggle_agent(&mut self, agent_id: &str) {
        if let Some(agent) = self.agents.iter_mut().find(|a| a.id == agent_id) {
            agent.enabled = !agent.enabled;
        }
    }
}
