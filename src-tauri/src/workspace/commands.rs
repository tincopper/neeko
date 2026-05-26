#[path = "commands_ai_commit.rs"]
mod commands_ai_commit;
#[path = "commands_config.rs"]
mod commands_config;
#[path = "commands_file.rs"]
mod commands_file;
#[path = "commands_opener.rs"]
mod commands_opener;

pub use commands_ai_commit::*;
pub use commands_config::*;
pub use commands_file::*;
pub use commands_opener::*;

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
    for entry in session.wsl_entries.iter_mut() {
        if entry.distro != distro {
            continue;
        }
        for project in entry.projects.iter_mut() {
            if project.id == project_id {
                project.avatar_color = color.clone();
            }
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
    for entry in session.remote_entries.iter_mut() {
        if entry.id != entry_id {
            continue;
        }
        for project in entry.projects.iter_mut() {
            if project.id == project_id {
                project.avatar_color = color.clone();
            }
        }
    }
    state
        .storage_manager
        .save_session(&session)
        .map_err(AppError::from)
}
