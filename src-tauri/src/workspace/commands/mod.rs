mod ai_commit;
mod config;
mod file;
mod opener;

pub use ai_commit::*;
pub use config::*;
pub use file::*;
pub use opener::*;

use crate::AppError;
use crate::AppStateWrapper;
use tauri::State;

#[tauri::command]
pub async fn get_system_fonts() -> Vec<String> {
    crate::utils::fonts::get_monospace_fonts()
}

#[tauri::command]
pub fn wsl_set_project_color(
    distro: String,
    project_id: String,
    color: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let mut session = state
        .storage_manager
        .load_session()
        .map_err(AppError::from)?;
    if let Some(entry) = session.wsl_entries.iter_mut().find(|e| e.distro == distro) {
        if let Some(project) = entry.projects.iter_mut().find(|p| p.id == project_id) {
            project.avatar_color = color;
        }
    }
    state
        .storage_manager
        .save_session(&session)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn remote_set_project_color(
    entry_id: String,
    project_id: String,
    color: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let mut session = state
        .storage_manager
        .load_session()
        .map_err(AppError::from)?;
    if let Some(entry) = session
        .remote_entries
        .iter_mut()
        .find(|e| e.id == entry_id)
    {
        if let Some(project) = entry.projects.iter_mut().find(|p| p.id == project_id) {
            project.avatar_color = color;
        }
    }
    state
        .storage_manager
        .save_session(&session)
        .map_err(AppError::from)
}
