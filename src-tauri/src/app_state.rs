use crate::{agent, project, remote, skill, storage, terminal, watcher};
use std::sync::{Arc, Mutex};

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
