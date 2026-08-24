//! Built-in agent ID constants.
//!
//! 双端契约的单一事实源：前端（`src/shared/constants/agentIds.ts`）与后端
//! 所有 agent id 字面量分派（`AgentKind::from_agent_id`、`adapter_for`、
//! `list_agent_models` 等）必须引用此处常量，禁止在业务代码中散落字符串。

/// OpenCode CLI agent（serve/ACP 双传输）。
pub const AGENT_OPENCODE: &str = "opencode";
/// DeepSeek Harness —— 参考适配器（v3，stdio JSON-Lines / ACP）。
pub const AGENT_DEEPSEEK_HARNESS: &str = "deepseek-harness";
/// 进程内 mock agent（AcpAdapter::mock，开发/演示用）。
pub const AGENT_MOCK: &str = "mockAgent";
