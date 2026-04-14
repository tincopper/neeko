mod agent;
mod config;
mod file;
mod git;
mod ide;
mod project;
mod remote;
mod remote_git;
mod terminal;
mod wsl;
mod wsl_git;

pub use agent::*;
pub use config::*;
pub use file::*;
pub use git::*;
pub use ide::*;
pub use project::*;
pub use remote::*;
pub use remote_git::*;
pub use terminal::*;
pub use wsl::*;
pub use wsl_git::*;

#[tauri::command]
pub async fn get_system_fonts() -> Vec<String> {
    crate::utils::fonts::get_monospace_fonts()
}
