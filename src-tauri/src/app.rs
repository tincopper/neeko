//! Tauri application setup, menu, and window event handling.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

use crate::app_state::AppStateWrapper;
use crate::common::agent::types::AgentConfig;

/// Run the Tauri application.
pub fn run() {
    crate::common::logger::init_logger();
    log::info!("Neeko starting");

    // Ensure skill central repo directories exist
    if let Err(e) = crate::skill::central_repo::ensure_central_repo() {
        log::warn!("Failed to ensure skill central repo: {e}");
    }

    if let Err(e) = crate::theme::service::install_all_global_themes() {
        log::warn!("Failed to install theme files: {e}");
    }

    // Resolve host user PATH once (login+interactive shell) so Local executor /
    // LSP / agent detection match the interactive terminal environment.
    crate::core::exec_env::init_host_user_path();

    let skill_store: Arc<crate::skill::skill_store::SkillStore> = {
        crate::skill::central_repo::ensure_central_repo()
            .expect("Failed to create skill central repo");
        Arc::new(
            crate::skill::skill_store::SkillStore::new(&crate::skill::central_repo::db_path())
                .expect("Failed to create skill store"),
        )
    };

    let cmd_w_flag = Arc::new(AtomicBool::new(false));
    let cmd_w_flag_win = cmd_w_flag.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol("neeko", crate::browser::uri_scheme::create_handler())
        .manage(skill_store.clone())
        .manage(AppStateWrapper::new_with_skill_store(skill_store))
        .setup(|app| {
            let state = app.handle().state::<AppStateWrapper>();
            let mut active_id_from_session: Option<String> = None;
            if let Ok(session) = state.storage_manager.load_session() {
                active_id_from_session = session.active_project_id;
                if let Ok(mut pm) = state.project_manager.lock() {
                    for p in &session.projects {
                        let _ = pm.add_project_from_session(p);
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

            // 校验 session.active_project_id 仍指向已加载的项目之一；否则视为 None
            let active_id =
                active_id_from_session.filter(|id| projects.iter().any(|(pid, _)| pid == id));

            // 设置到 AppState，供后续命令读取
            if let Some(id) = active_id.as_ref() {
                if let Ok(mut active) = state.active_project_id.lock() {
                    *active = Some(id.clone());
                }
            }

            // 只为激活项目挂 watcher；非激活项目由 set_active_project 触发时再挂
            if let Some(id) = active_id {
                if let Some((_, path)) = projects.iter().find(|(pid, _)| pid == &id) {
                    state
                        .watcher_manager
                        .watch(id, path.clone(), app.handle().clone());
                }
            }

            if let Ok(config) = state.storage_manager.load_config() {
                if let Some(custom_agents) = config.get("customAgents").and_then(|v| v.as_array()) {
                    if let Ok(mut am) = state.agent_manager.lock() {
                        for agent_json in custom_agents {
                            if let Ok(agent) =
                                serde_json::from_value::<AgentConfig>(agent_json.clone())
                            {
                                // Replace built-in agent with same ID, or add as new custom agent
                                if am.get_agent(&agent.id).is_some() {
                                    am.remove_agent(&agent.id);
                                }
                                am.add_agent(agent);
                            }
                        }
                    }
                }
            }

            // Initialize LSP manager with AppHandle + load custom LSP settings
            state.lsp_manager.set_app_handle(app.handle().clone());
            if let Ok(config) = state.storage_manager.load_config() {
                state.lsp_manager.apply_settings_from_json(&config);
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
        .menu(|handle| {
            let close_tab = MenuItemBuilder::with_id("close_tab", "Close Tab")
                .accelerator("CmdOrCtrl+W")
                .build(handle)?;
            let file = SubmenuBuilder::new(handle, "File")
                .item(&close_tab)
                .build()?;
            MenuBuilder::new(handle).item(&file).build()
        })
        .on_menu_event(move |app, event| {
            if event.id().0 == "close_tab" {
                cmd_w_flag.store(true, Ordering::SeqCst);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("close-tab", ());
                }
            }
        })
        .on_window_event(move |window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                // macOS: both Cmd+W and the red close button fire
                // CloseRequested.  The menu handler for close_tab
                // (Cmd+W) sets cmd_w_flag beforehand — when the
                // flag is set we prevent close (the tab was already
                // closed) and reset the flag.  When the flag is
                // clear the user clicked the red button → let the
                // window close naturally.
                #[cfg(target_os = "macos")]
                if cmd_w_flag_win.swap(false, Ordering::SeqCst) {
                    api.prevent_close();
                }
                // On Windows/Linux, CloseRequested fires only for
                // Alt+F4 / native close button → let it proceed.
            }
            tauri::WindowEvent::Destroyed => {
                let state = window.state::<AppStateWrapper>();
                state.shutdown_background_and_exit();
            }
            _ => {}
        })
        .invoke_handler(crate::neeko_invoke_handler!())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
