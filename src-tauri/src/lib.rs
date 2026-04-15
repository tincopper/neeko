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
pub mod skill;

use state::*;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;

// ─── Unix PATH 修复 ─────────────────────────────────────────────────

/// macOS/Linux 从 Dock/Finder/桌面启动的 GUI 应用只继承 launchd 提供的最小 PATH，
/// 通过用户的 login shell 获取完整 PATH 并注入当前进程环境变量。
#[cfg(unix)]
fn resolve_user_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    std::process::Command::new(&shell)
        .args(["-lc", "echo $PATH"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().lines().last().unwrap_or("").trim().to_string())
        .filter(|s| !s.is_empty())
}

// ─── 应用状态 ───────────────────────────────────────────────────────

pub struct AppStateWrapper {
    pub project_manager: Mutex<project::ProjectManager>,
    pub terminal_manager: terminal::TerminalManager,
    pub remote_terminal_manager: remote::RemoteTerminalManager,
    pub agent_manager: Mutex<agent::AgentManager>,
    pub storage_manager: storage::StorageManager,
    pub active_project_id: Mutex<Option<String>>,
    pub watcher_manager: watcher::WatcherManager,
    pub skill_store: Arc<skill::skill_store::SkillStore>,
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
            skill_store: {
                skill::central_repo::ensure_central_repo().expect("Failed to create skill central repo");
                Arc::new(skill::skill_store::SkillStore::new(&skill::central_repo::db_path()).expect("Failed to create skill store"))
            },
        }
    }
}

pub fn run() {
    logger::init_logger();
    log::info!("Neeko starting");

    // Ensure skill central repo directories exist
    if let Err(e) = skill::central_repo::ensure_central_repo() {
        log::warn!("Failed to ensure skill central repo: {e}");
    }

    // Unix: 从用户 login shell 获取完整 PATH，修复 GUI 应用 Agent 检测问题
    #[cfg(unix)]
    {
        match resolve_user_path() {
            Some(full_path) => {
                log::info!("Resolved user PATH from login shell, injecting into process env");
                std::env::set_var("PATH", &full_path);
            }
            None => {
                log::warn!("Failed to resolve user PATH from login shell, using default PATH");
            }
        }
    }

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
            commands::is_worktree_dirty,
            commands::delete_branch,
            commands::get_worktree_changed_files,
            commands::get_worktree_file_diff,
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
            commands::check_agents_installed,
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
            // ─── 文件操作命令 ────────────────────────────────────────────
            commands::read_dir_tree,
            commands::read_file_content,
            commands::write_file_content,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
