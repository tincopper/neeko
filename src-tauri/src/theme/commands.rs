//! Tauri commands for theme synchronization and custom theme management.

use crate::common::theme_types::{CustomTheme, ThemeListItem};
use crate::AppError;

/// Target for syncing theme to a WSL project.
#[derive(serde::Deserialize)]
pub struct WslProjectThemeTarget {
    /// WSL distribution name.
    pub distro: String,
    /// Project path inside the WSL distribution.
    pub path: String,
}

/// Collection of theme sync targets for local and WSL projects.
#[derive(serde::Deserialize)]
pub struct ProjectThemeTargets {
    #[serde(default)]
    /// Local project paths to sync.
    pub local_paths: Vec<String>,
    #[serde(default)]
    /// WSL project targets to sync.
    pub wsl: Vec<WslProjectThemeTarget>,
}

/// Syncs the given theme to all enabled agents for the specified targets.
#[tauri::command]
pub async fn sync_agent_theme(theme: String, targets: ProjectThemeTargets) -> Result<(), AppError> {
    for s in crate::theme::service::ThemeStrategy::all() {
        if !s.is_enabled() {
            continue;
        }
        for path in &targets.local_paths {
            if let Err(e) = s.sync_local(path, &theme) {
                log::warn!(
                    "[{}] Failed to sync for local project {}: {}",
                    s.name(),
                    path,
                    e
                );
            }
        }
        for target in &targets.wsl {
            if let Err(e) = s.sync_wsl(&target.distro, &target.path, &theme).await {
                log::warn!(
                    "[{}] Failed to sync for WSL project {} ({}): {}",
                    s.name(),
                    target.path,
                    target.distro,
                    e
                );
            }
        }
    }
    Ok(())
}

/// Lists all available custom themes.
#[tauri::command]
pub fn list_custom_themes() -> Vec<ThemeListItem> {
    crate::theme::custom::scan_custom_themes()
}

/// Returns the full custom theme definition for the given name.
#[tauri::command]
pub fn get_custom_theme(theme_name: String) -> Result<Option<CustomTheme>, AppError> {
    Ok(crate::theme::custom::read_custom_theme(&theme_name))
}
