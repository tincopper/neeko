//! Central application state container and terminal dispatch routing.

use crate::agent::AgentManager;
use crate::common::file::watcher::WatcherManager;
use crate::common::git::transport::{GitTransport, GitTransportKind};
use crate::common::runtime::AppRuntime;
use crate::common::terminal::remote::RemoteTerminalManager;
use crate::conversation::ConversationManager;
use crate::project::ProjectManager;
use crate::session::StorageManager;
use crate::skill;
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
    pub skill_store: Arc<skill::skill_store::SkillStore>,
    /// Language Server Protocol session manager.
    pub lsp_manager: Arc<crate::lsp::LspManager>,
    /// Debug Adapter Protocol session manager.
    pub dap_manager: crate::dap::DapManager,
    /// Conversation scanning and management.
    pub conversation_manager: ConversationManager,
    /// Tracks which backend (PTY / SSH) owns each terminal session.
    session_owner: Mutex<HashMap<String, SessionOwner>>,
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

    /// Resolve project path and a matching GitTransport by project ID.
    pub fn resolve_project(
        &self,
        project_id: &str,
    ) -> Result<(Arc<dyn GitTransport>, String), AppError> {
        let manager = self.project_manager.lock().map_err(AppError::from)?;
        let project = manager
            .get_project(project_id)
            .ok_or_else(|| AppError::NotFound(format!("Project not found: {project_id}")))?;

        let path = project.path.to_string_lossy().to_string();
        let kind: GitTransportKind = project.environment.to_git_transport(&path).0;
        Ok((Arc::new(kind), path))
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

    /// Create `AppStateWrapper` with an external shared `SkillStore`.
    pub fn new_with_skill_store(skill_store: Arc<skill::skill_store::SkillStore>) -> Self {
        let storage_manager = StorageManager::new().expect("Failed to create storage manager");

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
            skill_store,
            lsp_manager,
            dap_manager: crate::dap::DapManager::new(),
            conversation_manager: ConversationManager::new(
                crate::conversation::adapters::all_adapters(),
            ),
            session_owner: Mutex::new(HashMap::new()),
        }
    }

    /// Create `AppStateWrapper` with an auto-initialized `SkillStore`.
    pub fn new() -> Self {
        skill::central_repo::ensure_central_repo().expect("Failed to create skill central repo");
        let store = Arc::new(
            skill::skill_store::SkillStore::new(&skill::central_repo::db_path())
                .expect("Failed to create skill store"),
        );
        Self::new_with_skill_store(store)
    }
}

/// Loose path equality for project environment lookup.
fn paths_equal_for_env(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_string();
    norm(a) == norm(b)
}
