//! Tauri application setup and window event handling.

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
#[cfg(target_os = "macos")]
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{Emitter, Manager};

use crate::app_state::AppStateWrapper;
use crate::common::agent::types::AgentConfig;
use crate::common::error::AppError;
use crate::library;

/// 应用关闭请求事件名（后端阻止关闭后通知前端弹「确认退出」框），
/// 与前端 `src/shared/events.ts` `APP_CLOSE_REQUESTED_EVENT` 同步。
const APP_CLOSE_REQUESTED_EVENT: &str = "app-close-requested";

/// Run the Tauri application.
#[allow(clippy::expect_used)]
pub fn run() {
    crate::common::logger::init_logger();
    log::info!("Neeko starting");

    // Ensure skill central repo directories exist
    if let Err(e) = crate::library::skill::central_repo::ensure_central_repo() {
        log::warn!("Failed to ensure skill central repo: {e}");
    }

    if let Err(e) = crate::theme::service::install_all_global_themes() {
        log::warn!("Failed to install theme files: {e}");
    }

    // Resolve host user PATH once (login+interactive shell) so Local executor /
    // LSP / agent detection match the interactive terminal environment.
    crate::core::exec_env::init_host_user_path();

    let library_store: Arc<library::LibraryStore> = {
        library::db::ensure_db_ready().expect("Failed to prepare library database");
        Arc::new(
            library::LibraryStore::open(&library::db::db_path())
                .expect("Failed to create library store"),
        )
    };

    let cmd_w_flag = Arc::new(AtomicBool::new(false));
    #[cfg(target_os = "macos")]
    let cmd_w_flag_win = cmd_w_flag.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .register_uri_scheme_protocol("neeko", crate::browser::uri_scheme::create_handler())
        .manage(library_store.clone())
        .manage(AppStateWrapper::new_with_library_store(library_store))
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

            // Load custom agents + migrate legacy agentSkillPathOverrides → skill_path
            if let Ok(mut config) = state.storage_manager.load_config() {
                let legacy_overrides = legacy_skill_path_overrides(&config);
                let mut migrated = false;

                if let Some(custom_agents) = config
                    .get_mut("customAgents")
                    .and_then(|v| v.as_array_mut())
                {
                    for agent_json in custom_agents.iter_mut() {
                        // Inject skill_path from legacy overrides when missing
                        let id = agent_json
                            .get("id")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        let has_path = agent_json
                            .get("skill_path")
                            .and_then(|v| v.as_str())
                            .map(|s| !s.trim().is_empty())
                            .unwrap_or(false);
                        if !has_path {
                            if let Some(id) = id.as_ref() {
                                if let Some(path) = legacy_overrides.get(id) {
                                    if let Some(obj) = agent_json.as_object_mut() {
                                        obj.insert(
                                            "skill_path".into(),
                                            serde_json::Value::String(path.clone()),
                                        );
                                        migrated = true;
                                    }
                                }
                            }
                        }

                        if let Ok(mut agent) =
                            serde_json::from_value::<AgentConfig>(agent_json.clone())
                        {
                            // Normalize fullwidth tilde etc. on skill_path
                            if let Some(ref sp) = agent.skill_path {
                                let normalized = normalize_skill_path_str(sp);
                                if normalized != *sp {
                                    agent.skill_path = Some(normalized.clone());
                                    if let Some(obj) = agent_json.as_object_mut() {
                                        obj.insert(
                                            "skill_path".into(),
                                            serde_json::Value::String(normalized),
                                        );
                                        migrated = true;
                                    }
                                }
                            }
                            if let Ok(mut am) = state.agent_manager.lock() {
                                if am.get_agent(&agent.id).is_some() {
                                    am.remove_agent(&agent.id);
                                }
                                am.add_agent(agent);
                            }
                        }
                    }
                }

                // Apply leftover overrides for agents not present in customAgents
                // (e.g. built-in skill path overrides from older builds)
                if !legacy_overrides.is_empty() {
                    if let Ok(mut am) = state.agent_manager.lock() {
                        for (id, path) in &legacy_overrides {
                            if let Some(existing) = am.get_agent(id).cloned() {
                                if existing
                                    .skill_path
                                    .as_ref()
                                    .map(|s| s.trim().is_empty())
                                    .unwrap_or(true)
                                {
                                    let mut updated = existing;
                                    updated.skill_path = Some(path.clone());
                                    am.remove_agent(id);
                                    am.add_agent(updated);
                                    migrated = true;
                                }
                            }
                        }
                    }
                }

                if migrated {
                    if let Some(obj) = config.as_object_mut() {
                        obj.remove("agentSkillPathOverrides");
                    }
                    let _ = state.storage_manager.save_config(&config);
                    log::info!(
                        "Migrated legacy agentSkillPathOverrides into agent skill_path fields"
                    );
                }
            }

            // Initialize LSP manager with AppHandle + load custom LSP settings
            state.lsp_manager.set_app_handle(app.handle().clone());
            if let Ok(config) = state.storage_manager.load_config() {
                state.lsp_manager.apply_settings_from_json(&config);
            }

            // Auto-create Default tag group if none exist
            {
                let store = state.library_store.clone();
                if let Ok(groups) = store.get_all_tag_groups() {
                    if groups.is_empty() {
                        let now = chrono::Utc::now().timestamp_millis();
                        let default_tg = crate::library::skill::types::TagGroupRecord {
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
        .menu(crate::app_menu::build_menu)
        .on_menu_event(move |app, event| {
            let id = event.id().0.as_str();
            crate::app_menu::handle_menu_event(app, id, &cmd_w_flag);
        })
        .on_window_event(move |window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                // 任何关闭请求（macOS 红点 / Cmd+W、Windows·Linux
                // Alt+F4 / 原生关闭按钮 / 自绘标题栏 X）都先阻止，
                // 再按决策处理：
                // - macOS Cmd+W（关闭标签页）：菜单处理器已置位
                //   cmd_w_flag → 静默阻止（标签页已由前端关闭）。
                // - 其余原生关闭 → 通知前端弹出「确认退出」对话框；
                //   用户确认后由 `confirm_app_exit` 销毁窗口
                //   （destroy 跳过 CloseRequested，直接触发
                //   Destroyed → shutdown_background_and_exit）。
                api.prevent_close();
                // 仅 macOS 上 Cmd+W 会同时触发菜单事件与 CloseRequested；
                // Windows/Linux 上 CloseRequested 只来自 Alt+F4 / 原生关闭。
                #[cfg(target_os = "macos")]
                let cmd_w_flag = cmd_w_flag_win.swap(false, Ordering::SeqCst);
                #[cfg(not(target_os = "macos"))]
                let cmd_w_flag = false;
                if decide_close_action(cmd_w_flag) == CloseRequestAction::PreventAndAsk {
                    let _ = window.emit(APP_CLOSE_REQUESTED_EVENT, ());
                }
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

/// 用户确认退出：销毁主窗口。
///
/// 使用 `destroy` 而非 `close`：destroy 跳过 CloseRequested（避免与
/// 确认弹框循环），直接触发 `Destroyed` → `shutdown_background_and_exit`。
#[tauri::command]
pub fn confirm_app_exit(window: tauri::Window) -> Result<(), AppError> {
    window
        .destroy()
        .map_err(|e| AppError::Unknown(format!("Failed to destroy window: {e}")))
}

/// Read legacy `agentSkillPathOverrides` map from config (pre skill_path-on-agent).
fn legacy_skill_path_overrides(
    config: &serde_json::Value,
) -> std::collections::HashMap<String, String> {
    config
        .get("agentSkillPathOverrides")
        .and_then(|v| v.as_object())
        .map(|obj| {
            obj.iter()
                .filter_map(|(k, v)| {
                    v.as_str()
                        .map(|s| s.trim())
                        .filter(|s| !s.is_empty())
                        .map(|s| (k.clone(), normalize_skill_path_str(s)))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Normalize home-relative skill paths (ASCII `~` vs fullwidth `～`/`〜`).
fn normalize_skill_path_str(path: &str) -> String {
    let trimmed = path.trim();
    // U+FF5E FULLWIDTH TILDE, U+301C WAVE DASH — common IME mistakes
    if let Some(rest) = trimmed.strip_prefix('\u{FF5E}') {
        return format!("~{rest}");
    }
    if let Some(rest) = trimmed.strip_prefix('\u{301C}') {
        return format!("~{rest}");
    }
    trimmed.to_string()
}

/// 窗口关闭请求的处理决策：区分 macOS Cmd+W「关闭标签页」与真正的窗口关闭。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseRequestAction {
    /// Cmd+W 关闭标签页：静默阻止窗口关闭（标签页已由前端关闭）。
    PreventSilently,
    /// 原生关闭（macOS 红点 / Windows·Linux Alt+F4 / 自绘标题栏 X）：阻止并询问确认退出。
    PreventAndAsk,
}

/// 根据 macOS Cmd+W 标志位决定关闭请求的处理方式。
pub const fn decide_close_action(cmd_w_flag_set: bool) -> CloseRequestAction {
    if cmd_w_flag_set {
        CloseRequestAction::PreventSilently
    } else {
        CloseRequestAction::PreventAndAsk
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_normalize_fullwidth_tilde_skill_path() {
        assert_eq!(
            normalize_skill_path_str("～/.gork/skills"),
            "~/.gork/skills"
        );
        assert_eq!(
            normalize_skill_path_str("〜/.grok/skills"),
            "~/.grok/skills"
        );
        assert_eq!(normalize_skill_path_str("~/ok"), "~/ok");
    }

    #[test]
    fn should_read_legacy_skill_path_overrides() {
        let config = serde_json::json!({
            "agentSkillPathOverrides": {
                "custom:grok": "～/.gork/skills",
                "custom:mimo": "~/.mimo/skills",
                "empty": "  "
            }
        });
        let map = legacy_skill_path_overrides(&config);
        assert_eq!(
            map.get("custom:grok").map(String::as_str),
            Some("~/.gork/skills")
        );
        assert_eq!(
            map.get("custom:mimo").map(String::as_str),
            Some("~/.mimo/skills")
        );
        assert!(!map.contains_key("empty"));
    }

    #[test]
    fn cmd_w_flag_set_prevents_window_close_silently() {
        assert_eq!(
            decide_close_action(true),
            CloseRequestAction::PreventSilently
        );
    }

    #[test]
    fn native_close_prevents_and_asks_user() {
        assert_eq!(
            decide_close_action(false),
            CloseRequestAction::PreventAndAsk
        );
    }
}
