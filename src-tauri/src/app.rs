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

    // Install OpenCode theme files to ~/.config/opencode/themes/
    if let Err(e) = crate::opencode_theme::install_theme_files() {
        log::warn!("Failed to install OpenCode theme files: {e}");
    }

    // Install Pi theme files to ~/.pi/agent/themes/
    if let Err(e) = crate::pi_theme::install_pi_theme_files() {
        log::warn!("Failed to install Pi theme files: {e}");
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
        .invoke_handler(crate::neeko_invoke_handler!())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
