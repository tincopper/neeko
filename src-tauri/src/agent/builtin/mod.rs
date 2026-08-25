//! 内置 Agent 单一事实源（Single Source of Truth）。
//!
//! 11 个内置 `AgentConfig`（纯数据：能力声明 + 部署契约）。运行时行为经
//! `AgentProvider::from(&config)` 包装获得（chat adapter / 部署路径解析 / 安装检测）。
//!
//! 模块拆分：`providers.rs`（内置 config 构造）、`tests.rs`（契约测试）。

mod providers;
#[cfg(test)]
mod tests;

pub use providers::{builtin_configs, config_map, default_configs};
