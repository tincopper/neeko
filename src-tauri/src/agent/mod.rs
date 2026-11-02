//! Agent lifecycle management, commands, configuration, and chat.
//!
//! Chat 是 agent 的一种能力（`AgentConfig.chat`），与终端 TUI 正交；`chat`
//! 子模块持有 adapters、事件协议与会话注册表，服务 Agent Chat 页面。

pub mod boot;
pub mod builtin;
pub mod chat;
pub mod cli_status;

pub mod commands;
pub mod commands_commit;
/// 外部 Agent CLI hook 摄入（源 B：endpoint/归属/投影/ingest/writers）。
pub mod hooks;
pub mod manager;
pub mod model_discovery;
pub mod path_resolver;
pub mod plugin;
pub mod resource_deployer;

pub use manager::AgentManager;
