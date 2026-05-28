use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Agent 配置
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub icon: Option<String>,
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
    /// 内置 agent 的默认 skill 路径。用户自定义 agent 此字段始终为 None。
    #[serde(default)]
    pub default_skill_path: Option<String>,
}

impl AgentConfig {
    /// Resolve prompt prefix args. Returns None if agent doesn't support prompt mode.
    pub fn resolve_prompt_args(&self) -> Option<Vec<String>> {
        self.prompt_args.clone()
    }

    /// Resolve prompt suffix args (appended after prompt).
    pub fn resolve_post_prompt_args(&self) -> Vec<String> {
        self.post_prompt_args.clone().unwrap_or_default()
    }
}
