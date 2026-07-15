use crate::common::theme_types::{CustomTheme, ThemeListItem};
use crate::AppError;

#[derive(serde::Deserialize)]
pub struct WslProjectThemeTarget {
    pub distro: String,
    pub path: String,
}

#[derive(serde::Deserialize)]
pub struct ProjectThemeTargets {
    #[serde(default)]
    pub local_paths: Vec<String>,
    #[serde(default)]
    pub wsl: Vec<WslProjectThemeTarget>,
}

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

#[tauri::command]
pub fn list_custom_themes() -> Vec<ThemeListItem> {
    crate::theme::custom::scan_custom_themes()
}

#[tauri::command]
pub fn get_custom_theme(theme_name: String) -> Result<Option<CustomTheme>, AppError> {
    Ok(crate::theme::custom::read_custom_theme(&theme_name))
}
