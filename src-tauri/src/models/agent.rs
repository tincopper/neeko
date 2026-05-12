use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Agent 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
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
}
