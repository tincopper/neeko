use crate::{agent, project, remote, skill, storage, terminal, watcher};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

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

impl Clone for AppStateWrapper {
    fn clone(&self) -> Self {
        AppStateWrapper {
            project_manager: Mutex::new(project::ProjectManager::new()),
            terminal_manager: self.terminal_manager.clone(),
            remote_terminal_manager: self.remote_terminal_manager.clone(),
            agent_manager: Mutex::new(agent::AgentManager::new()),
            storage_manager: storage::StorageManager::new().unwrap(),
            active_project_id: Mutex::new(None),
            watcher_manager: self.watcher_manager.clone(),
            skill_store: self.skill_store.clone(),
        }
    }
}

impl AppStateWrapper {
    pub fn shutdown_background_and_exit(&self) {
        let terminal_manager = self.terminal_manager.clone();
        let remote_terminal_manager = self.remote_terminal_manager.clone();
        let watcher_manager = self.watcher_manager.clone();

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

            log::info!(
                "shutdown_all_background finished in {:?}, exiting",
                start.elapsed()
            );
            std::process::exit(0);
        });
    }

    /// Create with an external shared Arc<SkillStore> (used for Tauri state injection)
    pub fn new_with_skill_store(skill_store: Arc<skill::skill_store::SkillStore>) -> Self {
        Self {
            project_manager: Mutex::new(project::ProjectManager::new()),
            terminal_manager: terminal::TerminalManager::new(),
            remote_terminal_manager: remote::RemoteTerminalManager::new(),
            agent_manager: Mutex::new(agent::AgentManager::new()),
            storage_manager: storage::StorageManager::new()
                .expect("Failed to create storage manager"),
            active_project_id: Mutex::new(None),
            watcher_manager: watcher::WatcherManager::new(),
            skill_store,
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
