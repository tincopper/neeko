//! Adapter registry — the single place that decides which native session
//! formats History can read.
//!
//! Kept out of `adapters/mod.rs` on purpose (红线 9：`mod.rs` 只做声明与 re-export)：
//! 「有哪些适配器」是一条业务事实，值得单独一个文件承载，也让新增 agent 的落点明确。

use crate::conversation::adapter::AgentSessionAdapter;

use super::{
    ClaudeCodeAdapter, CodeBuddyAdapter, CodexAdapter, GeminiAdapter, GrokAdapter, OmpAdapter,
    OpenCodeAdapter, PiAdapter, QoderAdapter, ReasonixAdapter,
};

/// 返回所有已注册的 AgentSessionAdapter 实例
#[must_use]
pub fn all_adapters() -> Vec<Box<dyn AgentSessionAdapter>> {
    vec![
        Box::new(CodexAdapter),
        Box::new(ClaudeCodeAdapter),
        Box::new(PiAdapter),
        Box::new(GeminiAdapter),
        Box::new(QoderAdapter),
        Box::new(CodeBuddyAdapter),
        Box::new(OpenCodeAdapter),
        Box::new(OmpAdapter::new()),
        Box::new(GrokAdapter),
        Box::new(ReasonixAdapter),
    ]
}

#[cfg(test)]
mod tests {
    use super::all_adapters;
    use crate::agent::AgentManager;

    /// L2: every history adapter agent_id must exist in default AgentConfig ids.
    #[test]
    fn should_align_history_adapter_ids_with_default_agents() {
        let manager = AgentManager::new();
        let agents = manager.get_agents();
        let agent_ids: std::collections::HashSet<&str> =
            agents.iter().map(|a| a.id.as_str()).collect();

        for adapter in all_adapters() {
            let id = adapter.agent_id();
            assert!(
                agent_ids.contains(id),
                "history adapter `{id}` has no matching AgentConfig in default_agents"
            );
        }
    }

    #[test]
    fn should_register_omp_grok_reasonix_adapters() {
        let adapters = all_adapters();
        let ids: Vec<&str> = adapters.iter().map(|a| a.agent_id()).collect();
        for expected in [
            "omp",
            "grok",
            "reasonix",
            "codex",
            "pi",
            "claude-code",
            "opencode",
        ] {
            assert!(
                ids.contains(&expected),
                "missing adapter {expected} in all_adapters: {ids:?}"
            );
        }
    }
}
