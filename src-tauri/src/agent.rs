use crate::models::agent::AgentConfig;
use std::collections::HashMap;
use std::env;
use std::process::Command;
use which::{which, which_in};

/// Check if a command exists on the system PATH.
pub fn check_command_exists(command: &str) -> bool {
    if cfg!(target_os = "windows") {
        // Windows: 直接使用系统 PATH，无需 bash
        which(command).is_ok()
    } else {
        // Unix: 获取交互式 shell 的 PATH（覆盖 nvm/fish 等修改 PATH 的场景）
        let output = Command::new("bash")
            .args(["-i", "-c", "echo $PATH"])
            .output()
            .expect("failed to execute echo $PATH process");

        let interactive_path = String::from_utf8_lossy(&output.stdout).trim().to_string();

        // 使用 which 库的 which_in 接口，手动指定在哪个 PATH 字符串里找
        which_in(
            command,
            Some(interactive_path),
            env::current_dir().unwrap().as_path(),
        )
        .is_ok()
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
        // opencode — `opencode run --pure --dangerously-skip-permissions=true -f <prompt_file>`
        self.agents.push(AgentConfig {
            id: "opencode".to_string(),
            name: "opencode".to_string(),
            command: "opencode".to_string(),
            args: vec![],
            env: HashMap::new(),
            icon: Some("opencode.png".to_string()),
            enabled: true,
            prompt_args: Some(vec![
                "run".to_string(),
                "--pure".to_string(),
                "--dangerously-skip-permissions=true".to_string(),
                "-f".to_string(),
            ]),
            post_prompt_args: None,
        });

        // claude code — `claude --bare -p "<prompt>" --dangerously-skip-permissions`
        self.agents.push(AgentConfig {
            id: "claude-code".to_string(),
            name: "claude-code".to_string(),
            command: "claude".to_string(),
            args: vec![],
            env: HashMap::new(),
            icon: Some("claude-code.png".to_string()),
            enabled: true,
            prompt_args: Some(vec!["--bare".to_string(), "-p".to_string()]),
            post_prompt_args: Some(vec!["--dangerously-skip-permissions".to_string()]),
        });

        // gemini — `gemini --prompt "<prompt>"`
        self.agents.push(AgentConfig {
            id: "gemini".to_string(),
            name: "gemini".to_string(),
            command: "gemini".to_string(),
            args: vec![],
            env: HashMap::new(),
            icon: Some("gemini.png".to_string()),
            enabled: true,
            prompt_args: Some(vec!["--prompt".to_string()]),
            post_prompt_args: None,
        });

        // codex — `codex "<prompt>"` (prompt 作为直接位置参数，无前置 flag)
        self.agents.push(AgentConfig {
            id: "codex".to_string(),
            name: "codex".to_string(),
            command: "codex".to_string(),
            args: vec![],
            env: HashMap::new(),
            icon: Some("codex.png".to_string()),
            enabled: true,
            prompt_args: Some(vec![]),
            post_prompt_args: None,
        });

        // qoder — `qodercli --prompt "<prompt>"`
        self.agents.push(AgentConfig {
            id: "qoder".to_string(),
            name: "qoder".to_string(),
            command: "qodercli".to_string(),
            args: vec![],
            env: HashMap::new(),
            icon: Some("qoder.svg".to_string()),
            enabled: true,
            prompt_args: Some(vec!["--prompt".to_string()]),
            post_prompt_args: None,
        });

        // codebuddy — `codebuddy --prompt "<prompt>"`
        self.agents.push(AgentConfig {
            id: "codebuddy".to_string(),
            name: "codebuddy".to_string(),
            command: "codebuddy".to_string(),
            args: vec![],
            env: HashMap::new(),
            icon: Some("codebuddy.svg".to_string()),
            enabled: true,
            prompt_args: Some(vec!["--prompt".to_string()]),
            post_prompt_args: None,
        });
    }

    pub fn get_agents(&self) -> Vec<AgentConfig> {
        self.agents.clone()
    }

    pub fn get_agent(&self, agent_id: &str) -> Option<&AgentConfig> {
        self.agents.iter().find(|a| a.id == agent_id)
    }

    /// 解析 agent 的 prompt 前置参数。
    /// 优先使用 AgentConfig 中用户配置的 prompt_args；
    /// 若为 None，回退到内置硬编码映射（确保老数据/自定义 agent 也能工作）。
    pub fn resolve_prompt_args(agent: &AgentConfig) -> Option<Vec<String>> {
        if agent.prompt_args.is_some() {
            return agent.prompt_args.clone();
        }
        // 硬编码回退：按 agent id 映射已知支持的参数（兼容旧数据 / prompt_args 字段缺失的情况）
        match agent.id.as_str() {
            "opencode" => Some(vec![
                "run".to_string(),
                "--pure".to_string(),
                "--dangerously-skip-permissions=true".to_string(),
                "-f".to_string(),
            ]),
            "claude-code" => Some(vec!["--bare".to_string(), "-p".to_string()]),
            "gemini" | "qoder" | "codebuddy" => Some(vec!["--prompt".to_string()]),
            "codex" => Some(vec![]),
            _ => None,
        }
    }

    /// 解析 agent 的 prompt 后置参数（追加在 prompt 之后）。
    pub fn resolve_post_prompt_args(agent: &AgentConfig) -> Vec<String> {
        if let Some(ref args) = agent.post_prompt_args {
            return args.clone();
        }
        // 硬编码回退
        match agent.id.as_str() {
            "claude-code" => vec!["--dangerously-skip-permissions".to_string()],
            _ => vec![],
        }
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

    /// Async parallel check if agents are installed.
    /// Spawns concurrent tasks for each agent check.
    pub async fn check_installed_async(&self, agent_ids: &[String]) -> HashMap<String, bool> {
        use futures::future::join_all;

        let tasks: Vec<_> = agent_ids
            .iter()
            .map(|id| {
                let command = self
                    .agents
                    .iter()
                    .find(|a| a.id == *id)
                    .map(|a| a.command.clone());
                let id = id.clone();
                tokio::spawn(async move {
                    let installed = command
                        .map(|cmd| check_command_exists(&cmd))
                        .unwrap_or(false);
                    (id, installed)
                })
            })
            .collect();

        let results = join_all(tasks).await;
        results.into_iter().filter_map(|r| r.ok()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_initialize_with_six_presets() {
        let manager = AgentManager::new();
        assert_eq!(manager.get_agents().len(), 6);
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
            prompt_args: None,
            post_prompt_args: None,
        };
        manager.add_agent(custom);
        assert_eq!(manager.get_agents().len(), 7);
        assert!(manager.get_agent("custom").is_some());
    }

    #[test]
    fn should_remove_agent() {
        let mut manager = AgentManager::new();
        manager.remove_agent("opencode");
        assert_eq!(manager.get_agents().len(), 5);
        assert!(manager.get_agent("opencode").is_none());
    }

    #[test]
    fn should_not_panic_when_removing_nonexistent() {
        let mut manager = AgentManager::new();
        manager.remove_agent("nonexistent");
        assert_eq!(manager.get_agents().len(), 6);
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
    }

    #[test]
    fn should_have_all_agents_enabled_by_default() {
        let manager = AgentManager::new();
        assert!(manager.get_agents().iter().all(|a| a.enabled));
    }

    #[test]
    fn should_return_true_for_existing_command() {
        // Windows 使用 cmd.exe，Unix 使用 bash
        #[cfg(target_os = "windows")]
        let cmd = "cmd";
        #[cfg(not(target_os = "windows"))]
        let cmd = "bash";
        assert!(check_command_exists(cmd));
    }

    #[test]
    fn should_return_true_for_windows_specific_command() {
        #[cfg(target_os = "windows")]
        assert!(check_command_exists("powershell"));
        #[cfg(not(target_os = "windows"))]
        assert!(check_command_exists("sh"));
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
