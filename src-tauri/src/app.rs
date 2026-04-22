use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;

use crate::app_state::AppStateWrapper;
use crate::models::AgentConfig;

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

pub fn run() {
    crate::logger::init_logger();
    log::info!("Neeko starting");

    // Ensure skill central repo directories exist
    if let Err(e) = crate::skill::central_repo::ensure_central_repo() {
        log::warn!("Failed to ensure skill central repo: {e}");
    }

    // Unix: resolve full PATH from user's login shell to fix GUI app Agent detection issues
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

    let skill_store: Arc<crate::skill::skill_store::SkillStore> = {
        crate::skill::central_repo::ensure_central_repo()
            .expect("Failed to create skill central repo");
        Arc::new(
            crate::skill::skill_store::SkillStore::new(&crate::skill::central_repo::db_path())
                .expect("Failed to create skill store"),
        )
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(skill_store.clone())
        .manage(AppStateWrapper::new_with_skill_store(skill_store))
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
                .map(|pm| {
                    pm.list_projects()
                        .into_iter()
                        .map(|p| (p.id, p.path))
                        .collect()
                })
                .unwrap_or_default();
            for (id, path) in projects {
                state.watcher_manager.watch(id, path, app.handle().clone());
            }

            if let Ok(config) = state.storage_manager.load_config() {
                if let Some(custom_agents) = config.get("customAgents").and_then(|v| v.as_array()) {
                    if let Ok(mut am) = state.agent_manager.lock() {
                        for agent_json in custom_agents {
                            if let Ok(agent) =
                                serde_json::from_value::<AgentConfig>(agent_json.clone())
                            {
                                am.add_agent(agent);
                            }
                        }
                    }
                }
            }

            // Auto-create Default tag group if none exist
            {
                let store = state.skill_store.clone();
                if let Ok(groups) = store.get_all_tag_groups() {
                    if groups.is_empty() {
                        let now = chrono::Utc::now().timestamp_millis();
                        let default_tg = crate::skill::types::TagGroupRecord {
                            id: uuid::Uuid::new_v4().to_string(),
                            name: "Default".to_string(),
                            description: Some("Default skill group".to_string()),
                            icon: Some("clipboard-list".to_string()),
                            sort_order: 0,
                            created_at: now,
                            updated_at: now,
                        };
                        if let Err(e) = store.insert_tag_group(&default_tg) {
                            log::warn!("Failed to create Default tag group: {e}");
                        } else {
                            log::info!("Created Default tag group");
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
            crate::commands::greet,
            crate::commands::add_project,
            crate::commands::remove_project,
            crate::commands::list_projects,
            crate::commands::get_project,
            crate::commands::refresh_git_info,
            crate::commands::set_active_project,
            crate::commands::get_active_project,
            crate::commands::set_view_terminal,
            crate::commands::set_view_diff,
            crate::commands::set_project_collapsed,
            crate::commands::reorder_projects,
            crate::commands::checkout_branch,
            crate::commands::create_branch,
            crate::commands::rename_branch,
            crate::commands::rename_worktree,
            crate::commands::get_file_diff_command,
            crate::commands::create_worktree,
            crate::commands::remove_worktree,
            crate::commands::is_worktree_dirty,
            crate::commands::delete_branch,
            crate::commands::get_worktree_changed_files,
            crate::commands::get_worktree_file_diff,
            crate::commands::create_terminal_session,
            crate::commands::close_terminal_session,
            crate::commands::resize_terminal,
            crate::commands::get_wsl_distros,
            crate::commands::get_wsl_directories,
            crate::commands::get_wsl_home_dir,
            crate::commands::create_wsl_terminal_session,
            crate::commands::create_remote_terminal_session,
            crate::commands::close_remote_terminal_session,
            crate::commands::resize_remote_terminal,
            crate::commands::test_remote_connection,
            crate::commands::list_remote_directories,
            crate::commands::list_agents,
            crate::commands::get_agent,
            crate::commands::add_agent,
            crate::commands::remove_agent,
            crate::commands::set_project_agent,
            crate::commands::check_agents_installed,
            crate::commands::set_project_ide,
            crate::commands::open_ide,
            crate::commands::refresh_wsl_git_info,
            crate::commands::get_wsl_file_diff_command,
            crate::commands::wsl_checkout_branch,
            crate::commands::wsl_create_branch,
            crate::commands::wsl_rename_branch,
            crate::commands::wsl_create_worktree,
            crate::commands::wsl_remove_worktree,
            crate::commands::wsl_rename_worktree,
            crate::commands::open_wsl_ide,
            crate::commands::refresh_remote_git_info,
            crate::commands::get_remote_file_diff_command,
            crate::commands::remote_checkout_branch,
            crate::commands::remote_create_branch,
            crate::commands::remote_rename_branch,
            crate::commands::remote_create_worktree,
            crate::commands::remote_remove_worktree,
            crate::commands::remote_rename_worktree,
            crate::commands::open_remote_ide,
            crate::commands::save_session,
            crate::commands::load_session,
            crate::commands::get_config_dir,
            crate::commands::save_config,
            crate::commands::load_config,
            crate::commands::get_system_fonts,
            crate::commands::read_dir_tree,
            crate::commands::read_file_content,
            crate::commands::write_file_content,
            // --- SKILL COMMANDS ---
            crate::skill::commands::get_managed_skills,
            crate::skill::commands::get_skill_document,
            crate::skill::commands::delete_managed_skill,
            crate::skill::commands::get_tool_status,
            crate::skill::commands::get_tag_groups,
            crate::skill::commands::create_tag_group,
            crate::skill::commands::delete_tag_group_cmd,
            crate::skill::commands::install_local_skill,
            crate::skill::commands::scan_local_skills,
            crate::skill::commands::import_discovered_skill,
            crate::skill::commands::preview_git_install,
            crate::skill::commands::confirm_git_install,
            crate::skill::commands::cancel_git_preview,
            crate::skill::commands::check_skill_update,
            crate::skill::commands::update_skill,
            crate::skill::commands::update_tag_group_cmd,
            crate::skill::commands::reorder_tag_groups_cmd,
            crate::skill::commands::add_skill_to_tag_group_cmd,
            crate::skill::commands::remove_skill_from_tag_group_cmd,
            crate::skill::commands::get_skills_for_tag_group_cmd,
            crate::skill::commands::get_all_tags_cmd,
            crate::skill::commands::set_skill_tags_cmd,
            crate::skill::commands::set_skill_tool_toggle_cmd,
            crate::skill::commands::sync_tag_group_cmd,
            crate::skill::commands::unsync_tag_group_cmd,
            crate::skill::commands::get_project_tag_groups_cmd,
            crate::skill::commands::set_project_tag_groups_cmd,
            crate::skill::commands::add_project_tag_group_cmd,
            crate::skill::commands::remove_project_tag_group_cmd,
            crate::skill::commands::create_skill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
