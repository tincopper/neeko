//! AgentProvider —— 运行时行为封装。
//!
//! 数据只有一份：`AgentConfig`（配置/存储/编辑统一）。运行时按需
//! `AgentProvider::from(&config)` 包装为行为对象，提供：
//! - CHAT adapter 创建（按 `config.chat` 分派，零 id 特判）；
//! - 部署路径解析（skills / commands / MCP，按 `config.deploy` 模板）。
//!
//! 旧版"能力契约数据层"（AgentPlugin / AgentExecution / paths 六元组 /
//! schema / lifecycle）已按产品定位收敛：Agent CLI 管理工具不管理模型配置、
//! 配置表单、hooks/plugins 目录，相关字段全部移除。

use std::path::Path;

use crate::agent::chat::adapter::{adapter_for, AgentAdapter};
use crate::agent::path_resolver::PathResolver;
use crate::common::agent::types::AgentConfig;
use crate::common::error::AppError;

/// 运行时行为封装 —— 持有 `&AgentConfig`（不持有独立数据）。
pub struct AgentProvider<'a> {
    config: &'a AgentConfig,
}

impl<'a> AgentProvider<'a> {
    /// 由配置构造运行时对象。
    #[must_use]
    pub const fn from(config: &'a AgentConfig) -> Self {
        Self { config }
    }

    /// 底层配置（只读）。
    #[must_use]
    pub const fn config(&self) -> &'a AgentConfig {
        self.config
    }

    // ── CHAT 能力 ────────────────────────────────────────────────────────

    /// 创建 CHAT adapter（按 `config.chat` 分派）。
    pub fn chat_adapter(&self) -> Result<Box<dyn AgentAdapter>, AppError> {
        adapter_for(self.config)
    }

    // ── 部署路径解析（按 `config.deploy` 模板）────────────────────────────

    /// 解析 skills 目录（项目级模板；`skill_path` 为全局 override 时优先）。
    #[must_use]
    pub fn resolve_skill_dir(&self, project: Option<&Path>) -> std::path::PathBuf {
        let resolver = PathResolver::new(project);
        match &self.config.skill_path {
            Some(ov) => resolver.resolve_override(&self.config.deploy.skills, ov),
            None => resolver.resolve_template(&self.config.deploy.skills),
        }
    }

    /// 解析 slash commands 目录（`None` = 该 agent 不支持 command 部署）。
    #[must_use]
    pub fn resolve_commands_dir(&self, project: Option<&Path>) -> Option<std::path::PathBuf> {
        self.config
            .deploy
            .commands
            .as_deref()
            .map(|t| PathResolver::new(project).resolve_template(t))
    }

    /// 解析 MCP 配置文件路径（`None` = 该 agent 不支持 MCP 部署）。
    #[must_use]
    pub fn resolve_mcp_path(&self, project: Option<&Path>) -> Option<std::path::PathBuf> {
        self.config
            .deploy
            .mcp_config
            .as_deref()
            .map(|t| PathResolver::new(project).resolve_template(t))
    }
}
