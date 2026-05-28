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
pub fn sync_agent_theme(theme: String, targets: ProjectThemeTargets) -> Result<(), AppError> {
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
            if let Err(e) = s.sync_wsl(&target.distro, &target.path, &theme) {
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
