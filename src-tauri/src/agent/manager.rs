//! Agent registry and installation-check logic.

use crate::common::agent::types::AgentConfig;
use crate::common::executor::factory::ExecTarget;
use std::collections::HashMap;

/// Registry of AI agent configurations.
///
/// 数据源为 [`crate::agent::builtin::default_configs`]（内置 11 个）+ 用户自定义。
/// 内置 agent 支持**覆盖**：`add_agent` 对内置 id 原位替换（不产生重复条目），
/// `remove_agent` 对内置 id 恢复出厂值（清除覆盖）；用户自定义走追加/去重。
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
    #[must_use]
    pub fn new() -> Self {
        Self {
            agents: crate::agent::builtin::default_configs(),
        }
    }

    /// 启动时恢复内置 agent 的用户覆盖（config.json `agentOverrides`）。
    ///
    /// 覆盖值原位替换对应 builtin 元素；未知 id 忽略（防御）。覆盖不改变
    /// agent 的内置身份（`is_builtin` 恒保持 true，防止前端列表过滤丢失）。
    pub fn restore_overrides(&mut self, overrides: &HashMap<String, AgentConfig>) {
        for (id, cfg) in overrides {
            if let Some(slot) = self.agents.iter_mut().find(|a| a.id == *id && a.is_builtin) {
                let mut applied = cfg.clone();
                applied.is_builtin = true;
                *slot = applied;
            }
        }
    }

    /// 是否为内置 agent id。
    #[must_use]
    pub fn is_builtin_id(&self, agent_id: &str) -> bool {
        self.agents.iter().any(|a| a.id == agent_id && a.is_builtin)
    }

    /// Return all registered agents.
    #[allow(clippy::must_use_candidate)]
    pub fn get_agents(&self) -> &[AgentConfig] {
        &self.agents
    }

    /// Get an agent by ID.
    #[must_use]
    pub fn get_agent(&self, agent_id: &str) -> Option<&AgentConfig> {
        self.agents.iter().find(|a| a.id == agent_id)
    }

    /// Register an agent.
    ///
    /// 内置 id → 原位替换（覆盖，不产生重复条目，`is_builtin` 身份保留）；
    /// 自定义 id → 去重后追加。
    pub fn add_agent(&mut self, agent: AgentConfig) {
        if let Some(slot) = self
            .agents
            .iter_mut()
            .find(|a| a.id == agent.id && a.is_builtin)
        {
            let mut applied = agent;
            applied.is_builtin = true;
            *slot = applied;
            return;
        }
        self.agents.retain(|a| a.id != agent.id);
        self.agents.push(agent);
    }

    /// Unregister an agent by ID.
    ///
    /// 内置 id → 恢复出厂值（清除覆盖）；自定义 id → 移除。
    pub fn remove_agent(&mut self, agent_id: &str) {
        if self.is_builtin_id(agent_id) {
            let default = crate::agent::builtin::default_configs()
                .into_iter()
                .find(|a| a.id == agent_id);
            if let Some(d) = default {
                if let Some(slot) = self
                    .agents
                    .iter_mut()
                    .find(|a| a.id == agent_id && a.is_builtin)
                {
                    *slot = d;
                }
                return;
            }
        }
        self.agents.retain(|a| a.id != agent_id);
    }

    /// Resolve agent IDs to their CLI command names.
    #[must_use]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_initialize_with_eleven_presets() {
        let manager = AgentManager::new();
        assert_eq!(manager.get_agents().len(), 11);
    }

    #[test]
    fn should_include_grok_default_agent() {
        let manager = AgentManager::new();
        let agent = manager
            .get_agent("grok")
            .expect("grok should be a default agent");
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
        // name 为 display name（provider 提供），非 id。
        assert_eq!(agent.unwrap().name, "OpenCode");
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
    fn should_remove_custom_agent() {
        let mut manager = AgentManager::new();
        let before = manager.get_agents().len();
        manager.add_agent(AgentConfig {
            id: "temp".into(),
            name: "Temp".into(),
            command: "temp".into(),
            ..Default::default()
        });
        assert!(manager.get_agent("temp").is_some());
        manager.remove_agent("temp");
        assert_eq!(manager.get_agents().len(), before);
        assert!(manager.get_agent("temp").is_none());
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
    fn should_override_builtin_agent_in_place() {
        let mut manager = AgentManager::new();
        let before = manager.get_agents().len();
        let overridden = AgentConfig {
            id: "opencode".into(),
            name: "OpenCode (custom)".into(),
            command: "my-opencode".into(),
            ..Default::default()
        };
        manager.add_agent(overridden);
        // 原位替换：长度不变、取回的是覆盖值、内置身份保留
        assert_eq!(manager.get_agents().len(), before);
        let agent = manager.get_agent("opencode").unwrap();
        assert_eq!(agent.command, "my-opencode");
        assert_eq!(agent.name, "OpenCode (custom)");
        assert!(agent.is_builtin, "override must keep is_builtin identity");
    }

    #[test]
    fn should_reset_builtin_agent_to_factory_default() {
        let mut manager = AgentManager::new();
        let overridden = AgentConfig {
            id: "opencode".into(),
            name: "OpenCode (custom)".into(),
            command: "my-opencode".into(),
            ..Default::default()
        };
        manager.add_agent(overridden);
        assert_eq!(
            manager.get_agent("opencode").unwrap().command,
            "my-opencode"
        );

        manager.remove_agent("opencode");
        // 恢复出厂：仍在列表（未删除），值为内置原值
        assert!(manager.get_agent("opencode").is_some());
        let agent = manager.get_agent("opencode").unwrap();
        assert_eq!(agent.command, "opencode");
        assert_eq!(agent.name, "OpenCode");
    }

    #[test]
    fn should_restore_overrides_from_config() {
        let mut manager = AgentManager::new();
        let overrides = HashMap::from([(
            "gemini".to_string(),
            AgentConfig {
                id: "gemini".into(),
                name: "Gemini Custom".into(),
                command: "gemini-custom".into(),
                ..Default::default()
            },
        )]);
        manager.restore_overrides(&overrides);
        let agent = manager.get_agent("gemini").unwrap();
        assert_eq!(agent.command, "gemini-custom");
        assert!(agent.is_builtin);
        // 未知 id 忽略
        let bad = HashMap::from([(
            "nonexistent".to_string(),
            AgentConfig {
                id: "nonexistent".into(),
                ..Default::default()
            },
        )]);
        manager.restore_overrides(&bad);
        assert!(manager.get_agent("nonexistent").is_none());
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
