//! Theme synchronization service for local, WSL, and remote agents.

use anyhow::Result;

use super::{common, opencode, pi};

/// 区分不同项目类型，用于路由主题安装/配置操作
#[derive(Clone)]
pub enum ThemeContext {
    /// Local machine context.
    Local,
    /// WSL distribution context with distro name.
    Wsl(String),
}

/// Theme 同步策略枚举 — 新增 Agent 只需加一个 variant + match arm
pub enum ThemeStrategy {
    /// OpenCode agent theme sync.
    OpenCode,
    /// Pi agent theme sync.
    Pi,
}

impl ThemeStrategy {
    /// Returns all registered theme strategies.
    #[must_use]
    pub fn all() -> Vec<Self> {
        vec![Self::OpenCode, Self::Pi]
    }

    /// Returns the display name of this strategy.
    #[allow(clippy::must_use_candidate)]
    pub const fn name(&self) -> &'static str {
        match self {
            Self::OpenCode => "OpenCode",
            Self::Pi => "Pi",
        }
    }

    /// Whether this theme strategy is enabled in user config.
    #[must_use]
    pub fn is_enabled(&self) -> bool {
        match self {
            Self::OpenCode => opencode::read_enable_opencode_theme_sync(),
            Self::Pi => opencode::read_enable_pi_theme_sync(),
        }
    }

    /// Writes the theme config to a local project directory.
    pub fn sync_local(&self, project_path: &str, theme: &str) -> Result<()> {
        match self {
            Self::OpenCode => opencode::write_project_tui_config(project_path, theme),
            Self::Pi => pi::write_project_pi_settings(project_path, theme),
        }
    }

    /// Writes the theme config to a WSL project directory.
    pub async fn sync_wsl(&self, distro: &str, project_path: &str, theme: &str) -> Result<()> {
        match self {
            Self::OpenCode => opencode::write_wsl_tui_config(distro, project_path, theme).await,
            Self::Pi => pi::write_wsl_pi_settings(distro, project_path, theme).await,
        }
    }

    /// Installs theme files on a remote server via SSH channel.
    pub async fn install_remote_files(
        &self,
        channel: &mut russh::Channel<russh::client::Msg>,
    ) -> Result<()> {
        match self {
            Self::OpenCode => opencode::install_remote_theme_files(channel).await,
            Self::Pi => pi::install_remote_pi_theme_files(channel).await,
        }
    }

    /// Writes the theme config to a remote project directory via SSH channel.
    pub async fn write_remote_config(
        &self,
        channel: &mut russh::Channel<russh::client::Msg>,
        project_path: &str,
        theme: &str,
    ) -> Result<()> {
        match self {
            Self::OpenCode => opencode::write_remote_tui_config(channel, project_path, theme).await,
            Self::Pi => pi::write_remote_pi_settings(channel, project_path, theme).await,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 高层服务函数
// ═══════════════════════════════════════════════════════════════════════════════

/// 应用启动时调用：同时安装 OpenCode 和 Pi 主题文件到全局目录
pub fn install_all_global_themes() -> Result<()> {
    opencode::install_theme_files()?;
    pi::install_pi_theme_files()?;
    Ok(())
}

/// WSL 终端创建时调用：同时安装 OpenCode 和 Pi 主题文件到 WSL 内部
pub async fn install_wsl_themes(distro: &str) -> Result<()> {
    opencode::install_wsl_theme_files(distro).await?;
    pi::install_wsl_pi_theme_files(distro).await?;
    Ok(())
}

/// 项目级主题准备入口（**创建终端前调用**）：安装该环境所需的主题文件并写项目配置。
///
/// 为什么收在这里（原散在 `app_state.rs` 的终端创建流程里）：主题产物由本域产生，
/// 而原实现把 `opencode::*` / `pi::*` 的内部函数与开关判定抄了一遍 —— 同一份"主题同步"
/// 知识分裂成两处（组合根 import 了 terminal + theme + opencode + pi，反向依赖下层）。
/// 现在组合根/终端只需调本函数。
///
/// 行为与重构前**逐条对齐**：
/// - `Local`：只在**非任务终端**时写项目配置（历史行为，任务终端不需要主题产物）；
/// - `Wsl`：先安装 WSL 内主题文件（非致命，仅告警），再写项目配置；
/// - `Remote`：不做主题同步（远端会话的主题由 SSH 通道侧处理，不在此路径）。
///
/// 注意 `Local` 与 `Wsl` 的 `is_task_terminal` 处理差异是**刻意保留的历史行为**（WSL 分支
/// 原本就未按任务终端跳过），本次重构不混入行为变更；若要统一需单独确认。
pub async fn prepare_project_theme(
    env: &crate::core::project::ProjectEnvironment,
    project_path: &str,
    is_task_terminal: bool,
) {
    match env {
        crate::core::project::ProjectEnvironment::Local => {
            if is_task_terminal {
                return;
            }
            if let Err(e) = write_project_theme_config(&ThemeContext::Local, project_path).await {
                log::warn!("[theme] failed to write local project theme config: {e}");
            }
        }
        #[cfg(target_os = "windows")]
        crate::core::project::ProjectEnvironment::Wsl { distro } => {
            if let Err(e) = install_wsl_themes(distro).await {
                log::warn!("[theme] failed to install WSL theme files: {e}");
            }
            if let Err(e) =
                write_project_theme_config(&ThemeContext::Wsl(distro.clone()), project_path).await
            {
                log::warn!("[theme] failed to write WSL project theme config: {e}");
            }
        }
        crate::core::project::ProjectEnvironment::Remote { .. } => {}
    }
}

/// 统一写入项目级主题配置（本地 / WSL）
pub async fn write_project_theme_config(ctx: &ThemeContext, project_path: &str) -> Result<()> {
    let theme = common::read_neeko_theme().unwrap_or_else(|| "dark".to_string());
    for s in ThemeStrategy::all() {
        if !s.is_enabled() {
            continue;
        }
        match ctx {
            ThemeContext::Local => s.sync_local(project_path, &theme)?,
            ThemeContext::Wsl(distro) => s.sync_wsl(distro, project_path, &theme).await?,
        }
    }
    Ok(())
}
