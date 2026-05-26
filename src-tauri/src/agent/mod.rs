pub mod commands;
pub mod types;

use crate::agent::types::AgentConfig;
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
        // Unix: 用用户的登录 shell（$SHELL）拿交互式 PATH，
        // 覆盖 zsh + nvm/fnm/asdf/mise 等只在 ~/.zshrc 里改 PATH 的场景。
        // 写死 bash 会漏掉 zsh 用户的 nvm/fnm，导致 claude/node 等明明装了却被判 not installed。
        let shell = env::var("SHELL").unwrap_or_else(|_| "bash".to_string());
        let interactive_path = Command::new(&shell)
            .args(["-i", "-c", "echo $PATH"])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|p| !p.is_empty());

        let cwd = env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/"));
        // 优先用交互式 shell 拿到的 PATH，失败时回退到当前进程 PATH（which）
        match interactive_path {
            Some(path) => which_in(command, Some(path), cwd.as_path()).is_ok(),
            None => which(command).is_ok(),
        }
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
            is_builtin: true,
            default_skill_path: Some("~/.agents/skills".to_string()),
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
            is_builtin: true,
            default_skill_path: Some("~/.claude/skills".to_string()),
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
            is_builtin: true,
            default_skill_path: Some("~/.gemini/skills".to_string()),
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
            is_builtin: true,
            default_skill_path: Some("~/.codex/skills".to_string()),
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
            is_builtin: true,
            default_skill_path: Some("~/.qoder/skills".to_string()),
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
            is_builtin: true,
            default_skill_path: Some("~/.codebuddy/skills".to_string()),
        });

        // pi — `pi -p "<prompt>"`
        self.agents.push(AgentConfig {
            id: "pi".to_string(),
            name: "pi".to_string(),
            command: "pi".to_string(),
            args: vec![],
            env: HashMap::new(),
            icon: Some("pi.svg".to_string()),
            enabled: true,
            prompt_args: Some(vec!["-p".to_string()]),
            post_prompt_args: None,
            is_builtin: true,
            default_skill_path: Some("~/.pi/skills".to_string()),
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
            "pi" => Some(vec!["-p".to_string()]),
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
    fn should_initialize_with_seven_presets() {
        let manager = AgentManager::new();
        assert_eq!(manager.get_agents().len(), 7);
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
            id: "custom".to_string(),
            name: "Custom Agent".to_string(),
            command: "custom".to_string(),
            args: vec![],
            env: HashMap::new(),
            icon: None,
            enabled: true,
            prompt_args: None,
            post_prompt_args: None,
            is_builtin: false,
            default_skill_path: None,
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
