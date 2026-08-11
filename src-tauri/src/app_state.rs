//! Central application state container and terminal dispatch routing.

use crate::agent::AgentManager;
use crate::common::executor::factory::ExecTarget;
use crate::common::file::watcher::WatcherManager;
use crate::common::runtime::AppRuntime;
use crate::common::terminal::remote::RemoteTerminalManager;
use crate::conversation::ConversationManager;
use crate::library;
use crate::project::ProjectManager;
use crate::session::StorageManager;
use crate::terminal::TerminalManager;
use crate::AppError;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

/// Routing tag for terminal sessions — tracks which backend owns each session.
#[derive(Clone, PartialEq)]
enum SessionOwner {
    /// Local / WSL PTY-backed session.
    Pty,
    /// SSH remote session.
    Ssh,
}

/// Central application state holding all managers and shared resources.
pub struct AppStateWrapper {
    /// Business async executor (Scheme C: logical own runtime, one Handle).
    pub runtime: Arc<AppRuntime>,
    /// Project CRUD and persistence.
    pub project_manager: Mutex<ProjectManager>,
    /// Local / WSL PTY terminal sessions.
    pub terminal_manager: TerminalManager,
    /// SSH remote terminal sessions.
    pub remote_terminal_manager: RemoteTerminalManager,
    /// AI agent registration and configuration.
    pub agent_manager: Mutex<AgentManager>,
    /// Session and config file persistence.
    pub storage_manager: StorageManager,
    /// Currently active project ID, if any.
    pub active_project_id: Mutex<Option<String>>,
    /// File-system watcher for project changes.
    pub watcher_manager: WatcherManager,
    /// Shared skill store (tag groups, installed skills).
    /// Unified library store (skills, MCP, prompts, actions, tag groups).
    pub library_store: Arc<library::LibraryStore>,
    /// Language Server Protocol session manager.
    pub lsp_manager: Arc<crate::lsp::LspManager>,
    /// Debug Adapter Protocol session manager.
    pub dap_manager: crate::dap::DapManager,
    /// Conversation scanning and management.
    pub conversation_manager: ConversationManager,
    /// Tracks which backend (PTY / SSH) owns each terminal session.
    session_owner: Mutex<HashMap<String, SessionOwner>>,
    /// Last time the frontend reported itself alive (heartbeat).
    /// Used to detect a crashed / frozen WebView renderer so the window can be
    /// reloaded automatically instead of leaving the user on a black screen.
    last_heartbeat: Mutex<Option<Instant>>,
}

impl AppStateWrapper {
    /// Shut down all background services (terminal, watcher, LSP) and exit.
    pub fn shutdown_background_and_exit(&self) {
        let terminal_manager = self.terminal_manager.clone();
        let remote_terminal_manager = self.remote_terminal_manager.clone();
        let watcher_manager = self.watcher_manager.clone();
        let lsp_manager = self.lsp_manager.clone();

        thread::spawn(move || {
            log::info!("shutdown_all_background start");
            let start = Instant::now();

            let t1 = thread::spawn(move || {
                terminal_manager.close_all_sessions();
            });
            let t2 = thread::spawn(move || {
                remote_terminal_manager.close_all_sessions();
            });
            let t3 = thread::spawn(move || {
                watcher_manager.stop_all();
            });
            let t4 = thread::spawn(move || {
                lsp_manager.close_all_sessions();
            });

            if let Err(e) = t1.join() {
                log::error!("Terminal cleanup failed: {:?}", e);
            } else {
                log::info!("Terminal cleanup finished in {:?}", start.elapsed());
            }

            if let Err(e) = t2.join() {
                log::error!("Remote cleanup failed: {:?}", e);
            } else {
                log::info!("Remote cleanup finished in {:?}", start.elapsed());
            }

            if let Err(e) = t3.join() {
                log::error!("Watcher cleanup failed: {:?}", e);
            } else {
                log::info!("Watcher cleanup finished in {:?}", start.elapsed());
            }

            if let Err(e) = t4.join() {
                log::error!("LSP cleanup failed: {:?}", e);
            } else {
                log::info!("LSP cleanup finished in {:?}", start.elapsed());
            }

            log::info!(
                "shutdown_all_background finished in {:?}, exiting",
                start.elapsed()
            );
            std::process::exit(0);
        });
    }

    /// Resolve project path and a matching ExecTarget by project ID.
    pub fn resolve_project(&self, project_id: &str) -> Result<(ExecTarget, String), AppError> {
        let manager = self.project_manager.lock().map_err(AppError::from)?;
        let project = manager
            .get_project(project_id)
            .ok_or_else(|| AppError::NotFound(format!("Project not found: {project_id}")))?;

        let path = project.path.to_string_lossy().to_string();
        let target = project.environment.to_exec_target();
        Ok((target, path))
    }

    /// Resolve a project's execution environment.
    pub fn project_environment(
        &self,
        project_id: &str,
    ) -> Result<crate::core::project::ProjectEnvironment, AppError> {
        let manager = self.project_manager.lock().map_err(AppError::from)?;
        let project = manager
            .get_project(project_id)
            .ok_or_else(|| AppError::NotFound(format!("Project not found: {project_id}")))?;
        Ok(project.environment.clone())
    }

    /// Resolve the execution environment for the active project.
    pub fn active_project_environment(
        &self,
    ) -> Result<crate::core::project::ProjectEnvironment, AppError> {
        let id = self
            .active_project_id
            .lock()
            .map_err(AppError::from)?
            .clone()
            .ok_or_else(|| {
                AppError::NotFound(
                    "No active project — cannot resolve execution environment".into(),
                )
            })?;
        self.project_environment(&id)
    }

    /// Resolve execution environment by project filesystem path.
    pub fn environment_for_project_path(
        &self,
        project_path: &str,
    ) -> Result<crate::core::project::ProjectEnvironment, AppError> {
        let manager = self.project_manager.lock().map_err(AppError::from)?;
        manager
            .list_projects()
            .into_iter()
            .find(|p| paths_equal_for_env(&p.path.to_string_lossy(), project_path))
            .map(|p| p.environment.clone())
            .ok_or_else(|| {
                AppError::NotFound(format!(
                    "No registered project for path '{project_path}' — cannot resolve execution environment"
                ))
            })
    }

    // ── Terminal dispatch ──────────────────────────────────────────────────

    /// Create a terminal session, routing to the correct backend.
    #[allow(clippy::too_many_arguments)]
    pub async fn create_terminal_session(
        &self,
        project_id: &str,
        cols: u16,
        rows: u16,
        shell: Option<String>,
        working_dir: Option<String>,
        command: Option<String>,
        app_handle: tauri::AppHandle,
    ) -> Result<crate::common::terminal::types::TerminalSession, AppError> {
        let (env, path_string) = {
            let manager = self.project_manager.lock().map_err(AppError::from)?;
            let project = manager
                .get_project(project_id)
                .ok_or_else(|| AppError::NotFound(format!("Project not found: {project_id}")))?;
            (
                project.environment.clone(),
                project.path.to_string_lossy().to_string(),
            )
        };

        match env {
            crate::core::project::ProjectEnvironment::Local => {
                // Theme sync — skip for task terminals
                if command.is_none() {
                    let _ = crate::theme::service::write_project_theme_config(
                        &crate::theme::service::ThemeContext::Local,
                        &path_string,
                    )
                    .await;
                }

                let session = self
                    .terminal_manager
                    .create_session(
                        &path_string,
                        cols,
                        rows,
                        shell,
                        working_dir,
                        command,
                        app_handle,
                    )
                    .map_err(AppError::from)?;

                let _ = self
                    .session_owner
                    .lock()
                    .map(|mut m| m.insert(session.id.clone(), SessionOwner::Pty));
                Ok(session)
            }
            #[cfg(target_os = "windows")]
            crate::core::project::ProjectEnvironment::Wsl { ref distro } => {
                // WSL theme sync (non-fatal)
                {
                    use crate::theme::{
                        common::read_neeko_theme,
                        opencode::{
                            install_wsl_theme_files, read_enable_opencode_theme_sync,
                            read_enable_pi_theme_sync, write_wsl_tui_config,
                        },
                        pi,
                    };

                    if let Err(e) = install_wsl_theme_files(distro).await {
                        log::warn!("[WSL] Failed to install OpenCode theme files: {}", e);
                    }
                    if let Err(e) = pi::install_wsl_pi_theme_files(distro).await {
                        log::warn!("[WSL] Failed to install Pi theme files: {}", e);
                    }
                    let current_theme = read_neeko_theme().unwrap_or_else(|| "dark".to_string());
                    if read_enable_opencode_theme_sync() {
                        if let Err(e) =
                            write_wsl_tui_config(distro, &path_string, &current_theme).await
                        {
                            log::warn!("[WSL] Failed to write OpenCode tui.json: {}", e);
                        }
                    }
                    if read_enable_pi_theme_sync() {
                        if let Err(e) =
                            pi::write_wsl_pi_settings(distro, &path_string, &current_theme).await
                        {
                            log::warn!("[WSL] Failed to write Pi settings.json: {}", e);
                        }
                    }
                }

                let session = self
                    .terminal_manager
                    .create_wsl_session(distro, &path_string, cols, rows, app_handle)
                    .map_err(AppError::from)?;

                let _ = self
                    .session_owner
                    .lock()
                    .map(|mut m| m.insert(session.id.clone(), SessionOwner::Pty));
                Ok(session)
            }
            crate::core::project::ProjectEnvironment::Remote {
                host,
                port,
                username,
                auth,
            } => {
                let session = self
                    .remote_terminal_manager
                    .create_session(
                        &host,
                        port,
                        &username,
                        &auth,
                        &path_string,
                        cols,
                        rows,
                        app_handle,
                    )
                    .await
                    .map_err(AppError::from)?;

                let _ = self
                    .session_owner
                    .lock()
                    .map(|mut m| m.insert(session.id.clone(), SessionOwner::Ssh));
                Ok(session)
            }
        }
    }

    /// Resize a terminal session, dispatching to the correct backend.
    pub fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), AppError> {
        let owner = self
            .session_owner
            .lock()
            .ok()
            .and_then(|m| m.get(session_id).cloned());
        match owner {
            Some(SessionOwner::Pty) => self
                .terminal_manager
                .resize_session(session_id, cols, rows)
                .map_err(AppError::from),
            Some(SessionOwner::Ssh) => self
                .remote_terminal_manager
                .resize_session(session_id, cols, rows)
                .map_err(AppError::from),
            None => Err(AppError::NotFound(format!(
                "Terminal session not found: {session_id}"
            ))),
        }
    }

    /// Close a terminal session, dispatching to the correct backend.
    pub fn close_session(&self, session_id: &str) {
        let owner = self
            .session_owner
            .lock()
            .ok()
            .and_then(|mut m| m.remove(session_id));
        match owner {
            Some(SessionOwner::Pty) => self
                .terminal_manager
                .close_session_in_background(session_id),
            Some(SessionOwner::Ssh) => self.remote_terminal_manager.close_session(session_id),
            None => log::warn!("[Terminal] Attempted to close unknown session: {session_id}"),
        }
    }

    // ── WebView heartbeat ─────────────────────────────────────────────────

    /// Record that the frontend renderer is alive (called by the `heartbeat`
    /// command on a fixed interval).
    pub fn record_heartbeat(&self) {
        if let Ok(mut last) = self.last_heartbeat.lock() {
            *last = Some(Instant::now());
        }
    }

    /// Whether the frontend has been silent for longer than `timeout`.
    ///
    /// A `None` value (never heartbeated) is treated as stale only if the
    /// window has had a chance to start reporting — the constructor seeds the
    /// timestamp, so a fresh app is never immediately considered crashed.
    pub fn heartbeat_stale(&self, timeout: std::time::Duration) -> bool {
        let last = self.last_heartbeat.lock().ok().and_then(|l| *l);
        match last {
            Some(ts) => ts.elapsed() > timeout,
            None => false,
        }
    }

    /// Create `AppStateWrapper` with an external shared `LibraryStore`.
    #[allow(clippy::expect_used)]
    #[must_use]
    pub fn new_with_library_store(library_store: Arc<library::LibraryStore>) -> Self {
        let storage_manager = StorageManager::new().expect("Failed to create storage manager");
        Self::new_with_storage_and_library(storage_manager, library_store)
    }

    /// Create `AppStateWrapper` with an explicit storage manager (config dir) and
    /// an external shared `LibraryStore`.  Tests MUST pass an isolated storage
    /// (e.g. `StorageManager::with_dir(tempdir)`) so that project mutations never
    /// touch the real `~/.neeko/sessions.json`.
    ///
    /// # Why `#[allow(clippy::expect_used)]` is safe
    ///
    /// This constructor only composes already-constructed values into `Self`;
    /// it performs no fallible operations itself. The `expect` allowance exists
    /// solely so that the *caller* (`new_with_library_store`) can propagate a
    /// `StorageManager::new()` failure as a hard panic — which is intentional
    /// for the production path (a missing config dir is unrecoverable). Test
    /// code bypasses this by calling `new_with_storage_and_library` directly
    /// with an isolated `StorageManager`.
    #[allow(clippy::expect_used)]
    #[must_use]
    pub fn new_with_storage_and_library(
        storage_manager: StorageManager,
        library_store: Arc<library::LibraryStore>,
    ) -> Self {
        // Persist callback: auto-saves projects after every mutation
        let persist = {
            let sm_clone = storage_manager.clone();
            move |projects: &[crate::project::types::Project]| {
                let session = sm_clone.create_session_from_projects(projects, None);
                if let Err(e) = sm_clone.save_session(&session) {
                    log::error!("Auto-save session failed: {}", e);
                }
            }
        };

        // Bind business runtime to Tauri's global Tokio handle (safe before/after setup).
        let runtime = AppRuntime::shared_default();
        let lsp_manager = Arc::new(crate::lsp::LspManager::new(Arc::clone(&runtime)));

        Self {
            runtime,
            project_manager: Mutex::new(ProjectManager::new(persist)),
            terminal_manager: TerminalManager::new(),
            remote_terminal_manager: RemoteTerminalManager::new(),
            agent_manager: Mutex::new(AgentManager::new()),
            storage_manager,
            active_project_id: Mutex::new(None),
            watcher_manager: WatcherManager::new(),
            library_store,
            lsp_manager,
            dap_manager: crate::dap::DapManager::new(),
            conversation_manager: ConversationManager::new(
                crate::conversation::adapters::all_adapters(),
            ),
            session_owner: Mutex::new(HashMap::new()),
            last_heartbeat: Mutex::new(Some(Instant::now())),
        }
    }

    /// Create `AppStateWrapper` with an auto-initialized `LibraryStore`.
    #[allow(clippy::expect_used)]
    #[must_use]
    pub fn new() -> Self {
        library::db::ensure_db_ready().expect("Failed to prepare library database");
        let store = Arc::new(
            library::LibraryStore::open(&library::db::db_path())
                .expect("Failed to create library store"),
        );
        Self::new_with_library_store(store)
    }
}

impl Default for AppStateWrapper {
    fn default() -> Self {
        Self::new()
    }
}

/// Frontend liveness probe. The renderer calls this on a fixed interval; the
/// crash-detection task in `app.rs` reloads the window if it goes silent.
#[tauri::command]
pub fn heartbeat(state: tauri::State<'_, AppStateWrapper>) {
    state.record_heartbeat();
}

/// Loose path equality for project environment lookup.
fn paths_equal_for_env(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_string();
    norm(a) == norm(b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::StorageManager;
    use std::sync::Arc;
    use std::time::Duration;

    /// 构造隔离的 AppStateWrapper（StorageManager 指向临时目录，避免污染 ~/.neeko）。
    fn isolated_state(tmp: &tempfile::TempDir) -> AppStateWrapper {
        let storage = StorageManager::with_dir(tmp.path().join(".neeko")).unwrap();
        let store = Arc::new(crate::library::LibraryStore::open_in_memory().unwrap());
        AppStateWrapper::new_with_storage_and_library(storage, store)
    }

    #[test]
    fn fresh_state_is_not_stale() {
        let tmp = tempfile::tempdir().unwrap();
        let state = isolated_state(&tmp);
        // 构造时已播种心跳时间，刚创建不应被判为崩溃。
        assert!(!state.heartbeat_stale(Duration::from_secs(30)));
    }

    #[test]
    fn heartbeat_keeps_state_alive() {
        let tmp = tempfile::tempdir().unwrap();
        let state = isolated_state(&tmp);
        // 反复心跳，每次心跳后短暂等待（远小于阈值）都不应 stale。
        for _ in 0..5 {
            state.record_heartbeat();
            std::thread::sleep(Duration::from_millis(2));
            assert!(!state.heartbeat_stale(Duration::from_millis(100)));
        }
    }

    #[test]
    fn silent_state_becomes_stale() {
        let tmp = tempfile::tempdir().unwrap();
        let state = isolated_state(&tmp);
        // 不心跳，等待超过阈值后应被判为 stale。
        std::thread::sleep(Duration::from_millis(30));
        assert!(state.heartbeat_stale(Duration::from_millis(10)));
    }
}
