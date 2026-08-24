//! Agent configuration definitions.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Information about a model supported by an agent.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModelInfo {
    /// Model identifier (slug), e.g. "anthropic/claude-sonnet-4-20250514".
    pub id: String,
    /// Human-readable model name.
    pub name: String,
    /// Upstream provider ID (e.g. "anthropic", "openai").
    #[serde(default)]
    pub provider_id: Option<String>,
    /// Upstream provider name.
    #[serde(default)]
    pub provider_name: Option<String>,
    /// Supported reasoning efforts (e.g. "low", "medium", "high").
    #[serde(default)]
    pub supported_reasoning_efforts: Vec<String>,
    /// Default reasoning effort, if any.
    #[serde(default)]
    pub default_reasoning_effort: Option<String>,
    /// Context window in tokens, if known.
    #[serde(default)]
    pub context_window: Option<u32>,
    /// Whether this model is free.
    #[serde(default)]
    pub is_free: bool,
}

/// Agent configuration.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentConfig {
    /// Unique identifier for this agent.
    pub id: String,
    /// Human-readable display name.
    pub name: String,
    /// Executable command path.
    pub command: String,
    /// Arguments to pass to the command.
    pub args: Vec<String>,
    /// Environment variables for the agent process.
    pub env: HashMap<String, String>,
    /// Optional icon identifier.
    pub icon: Option<String>,
    /// Whether this agent is enabled.
    pub enabled: bool,
    /// prompt 前置参数，如 ["--bare", "-p"] 表示 `command --bare -p "<prompt>" [post_prompt_args]`。
    /// None 表示该 agent 不支持 prompt 直接模式。
    #[serde(default)]
    pub prompt_args: Option<Vec<String>>,
    /// prompt 后置参数，追加在 prompt 之后，如 ["--dangerously-skip-permissions"]。
    #[serde(default)]
    pub post_prompt_args: Option<Vec<String>>,
    /// 是否为内置 agent。仅由后端 `add_default_agents` 设置为 true，前端无法伪造。
    #[serde(default)]
    pub is_builtin: bool,
    /// Agent's skill directory path on disk.
    #[serde(default)]
    pub skill_path: Option<String>,
    /// Agent chat IO transport: `acp` (Agent Client Protocol over JSON-RPC
    /// stdio) | `jsonl` (custom JSON-Lines stdio) | `None` (unset → default).
    /// 非 CLI 形态的 agent（HTTP SSE / ACP 等流式能力）在此声明，工厂据此
    /// 选择对应 adapter —— 契约不绑定 stdout/JSON-Lines。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chat_transport: Option<String>,
    /// Model IDs this agent supports in Agent Chat (empty = not configured).
    /// 前端据此渲染模型选择器；模型切换后端经此字段校验。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub models: Vec<String>,
}

impl AgentConfig {
    /// Resolve prompt prefix args. Returns None if agent doesn't support prompt mode.
    #[must_use]
    pub fn resolve_prompt_args(&self) -> Option<Vec<String>> {
        self.prompt_args.clone()
    }

    /// Resolve prompt suffix args (appended after prompt).
    #[must_use]
    pub fn resolve_post_prompt_args(&self) -> Vec<String> {
        self.post_prompt_args.clone().unwrap_or_default()
    }
}
