pub mod agent;
mod commands;
pub mod git;
mod logger;
pub mod project;
mod remote;
pub mod state;
pub mod storage;
mod terminal;
mod utils;
mod watcher;

use state::*;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

pub struct AppStateWrapper {
    pub project_manager: Mutex<project::ProjectManager>,
    pub terminal_manager: terminal::TerminalManager,
    pub remote_terminal_manager: remote::RemoteTerminalManager,
    pub agent_manager: Mutex<agent::AgentManager>,
    pub storage_manager: storage::StorageManager,
    pub active_project_id: Mutex<Option<String>>,
    pub watcher_manager: watcher::WatcherManager,
}

impl AppStateWrapper {
    pub fn new() -> Self {
        Self {
            project_manager: Mutex::new(project::ProjectManager::new()),
            terminal_manager: terminal::TerminalManager::new(),
            remote_terminal_manager: remote::RemoteTerminalManager::new(),
            agent_manager: Mutex::new(agent::AgentManager::new()),
            storage_manager: storage::StorageManager::new().expect("Failed to create storage manager"),
            active_project_id: Mutex::new(None),
            watcher_manager: watcher::WatcherManager::new(),
        }
    }
}

pub fn run() {
    logger::init_logger();
    log::info!("Neeko starting");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppStateWrapper::new())
        .setup(|app| {
            let state = app.handle().state::<AppStateWrapper>();
            if let Ok(session) = state.storage_manager.load_session() {
                if let Ok(mut pm) = state.project_manager.lock() {
                    for p in &session.projects {
                        let _ = pm.add_project_from_session(
                            p.id.clone(),
                            p.path.clone(),
                            p.selected_agent.clone(),
                            p.selected_ide.clone(),
                            p.collapsed,
                        );
                    }
                }
            }
            let projects: Vec<(String, PathBuf)> = state
                .project_manager
                .lock()
                .map(|pm| pm.list_projects().into_iter().map(|p| (p.id, p.path)).collect())
                .unwrap_or_default();
            for (id, path) in projects {
                state.watcher_manager.watch(id, path, app.handle().clone());
            }

            if let Ok(config) = state.storage_manager.load_config() {
                if let Some(custom_agents) = config.get("customAgents").and_then(|v| v.as_array()) {
                    if let Ok(mut am) = state.agent_manager.lock() {
                        for agent_json in custom_agents {
                            if let Ok(agent) = serde_json::from_value::<AgentConfig>(agent_json.clone()) {
                                am.add_agent(agent);
                            }
                        }
                    }
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<AppStateWrapper>();
                state.terminal_manager.close_all_sessions();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::greet,
            commands::add_project,
            commands::remove_project,
            commands::list_projects,
            commands::get_project,
            commands::refresh_git_info,
            commands::set_active_project,
            commands::get_active_project,
            commands::set_view_terminal,
            commands::set_view_diff,
            commands::set_project_collapsed,
            commands::reorder_projects,
            commands::checkout_branch,
            commands::create_branch,
            commands::rename_branch,
            commands::rename_worktree,
            commands::get_file_diff_command,
            commands::create_worktree,
            commands::remove_worktree,
            commands::create_terminal_session,
            commands::close_terminal_session,
            commands::resize_terminal,
            commands::get_wsl_distros,
            commands::get_wsl_directories,
            commands::get_wsl_home_dir,
            commands::create_wsl_terminal_session,
            commands::create_remote_terminal_session,
            commands::close_remote_terminal_session,
            commands::resize_remote_terminal,
            commands::test_remote_connection,
            commands::list_remote_directories,
            commands::list_agents,
            commands::get_agent,
            commands::add_agent,
            commands::remove_agent,
            commands::set_project_agent,
            commands::set_project_ide,
            commands::open_ide,
            commands::refresh_wsl_git_info,
            commands::get_wsl_file_diff_command,
            commands::wsl_checkout_branch,
            commands::wsl_create_branch,
            commands::wsl_rename_branch,
            commands::wsl_create_worktree,
            commands::wsl_remove_worktree,
            commands::wsl_rename_worktree,
            commands::open_wsl_ide,
            commands::refresh_remote_git_info,
            commands::get_remote_file_diff_command,
            commands::remote_checkout_branch,
            commands::remote_create_branch,
            commands::remote_rename_branch,
            commands::remote_create_worktree,
            commands::remote_remove_worktree,
            commands::remote_rename_worktree,
            commands::open_remote_ide,
            commands::save_session,
            commands::load_session,
            commands::get_config_dir,
            commands::save_config,
            commands::load_config,
            commands::get_system_fonts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
