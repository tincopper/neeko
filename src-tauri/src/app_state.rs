use crate::agent::AgentManager;
use crate::common::file::watcher::WatcherManager;
use crate::common::git::transport::GitTransport;
use crate::common::terminal::remote::RemoteTerminalManager;
use crate::conversation::ConversationManager;
use crate::project::ProjectManager;
use crate::session::StorageManager;
use crate::skill;
use crate::terminal::TerminalManager;
use crate::AppError;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

pub struct AppStateWrapper {
    pub project_manager: Mutex<ProjectManager>,
    pub terminal_manager: TerminalManager,
    pub remote_terminal_manager: RemoteTerminalManager,
    pub agent_manager: Mutex<AgentManager>,
    pub storage_manager: StorageManager,
    pub active_project_id: Mutex<Option<String>>,
    pub watcher_manager: WatcherManager,
    pub skill_store: Arc<skill::skill_store::SkillStore>,
    pub lsp_manager: Arc<crate::lsp::LspManager>,
    pub conversation_manager: ConversationManager,
}

impl AppStateWrapper {
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

    /// 通过 project_id 一站式解析项目路径与 GitTransport。
    /// 供 git 等命令使用，无需调用方关心项目类型。
    pub fn resolve_project(&self, project_id: &str) -> Result<(GitTransport, String), AppError> {
        let manager = self.project_manager.lock().map_err(AppError::from)?;
        let project = manager
            .get_project(project_id)
            .ok_or_else(|| AppError::NotFound(format!("Project not found: {project_id}")))?;

        let path = project.path.to_string_lossy().to_string();
        let transport = project.environment.to_git_transport(&path).0;
        Ok((transport, path))
    }

    /// Create with an external shared Arc<SkillStore> (used for Tauri state injection)
    pub fn new_with_skill_store(skill_store: Arc<skill::skill_store::SkillStore>) -> Self {
        let storage_manager = StorageManager::new().expect("Failed to create storage manager");

        // Persist callback: auto-saves projects after every mutation
        let persist = {
            let sm_clone = storage_manager.clone();
            move |projects: &[crate::project::types::Project]| {
                let session = sm_clone.create_session_from_projects(projects, None, None, None);
                if let Err(e) = sm_clone.save_session(&session) {
                    log::error!("Auto-save session failed: {}", e);
                }
            }
        };

        Self {
            project_manager: Mutex::new(ProjectManager::new(persist)),
            terminal_manager: TerminalManager::new(),
            remote_terminal_manager: RemoteTerminalManager::new(),
            agent_manager: Mutex::new(AgentManager::new()),
            storage_manager,
            active_project_id: Mutex::new(None),
            watcher_manager: WatcherManager::new(),
            skill_store,
            lsp_manager: Arc::new(crate::lsp::LspManager::new()),
            conversation_manager: ConversationManager::new(
                crate::conversation::adapters::all_adapters(),
            ),
        }
    }

    /// Standalone creation with auto-initialized SkillStore
    pub fn new() -> Self {
        skill::central_repo::ensure_central_repo().expect("Failed to create skill central repo");
        let store = Arc::new(
            skill::skill_store::SkillStore::new(&skill::central_repo::db_path())
                .expect("Failed to create skill store"),
        );
        Self::new_with_skill_store(store)
    }
}
