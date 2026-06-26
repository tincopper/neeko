use neeko_lib::project::types::{Project, ViewMode};
use neeko_lib::session::types::{ProjectSession, SessionStore};
use neeko_lib::session::StorageManager;
use neeko_lib::common::terminal::types::{TerminalSession, TerminalStatus};
use std::path::PathBuf;
use tempfile::TempDir;

fn test_storage() -> (TempDir, StorageManager) {
    let tmp = TempDir::new().unwrap();
    let manager = StorageManager::with_dir(tmp.path().to_path_buf()).unwrap();
    (tmp, manager)
}

#[test]
fn save_and_load_session_roundtrip() {
    let (_tmp, manager) = test_storage();
    let session = SessionStore::new();

    manager.save_session(&session).unwrap();
    let loaded = manager.load_session().unwrap();

    assert!(loaded.projects.is_empty());
    assert!(loaded.active_project_id.is_none());
}

#[test]
fn save_and_load_session_with_projects() {
    let (_tmp, manager) = test_storage();
    let session = SessionStore {
        projects: vec![ProjectSession {
            id: "p1".into(),
            name: "test".into(),
            path: PathBuf::from("/tmp/test"),
            selected_agent: Some("claude-code".into()),
            selected_ide: None,
            terminal_history: vec!["hello".into()],
            last_status: TerminalStatus::Idle,
            collapsed: true,
            avatar_color: None,
        }],
        active_project_id: Some("p1".into()),
        last_updated: String::new(),
        wsl_entries: vec![],
        remote_entries: vec![],
        sidebar_width: Some(250),
        worktree_state: Default::default(),
    };

    manager.save_session(&session).unwrap();
    let loaded = manager.load_session().unwrap();

    assert_eq!(loaded.projects.len(), 1);
    assert_eq!(loaded.projects[0].name, "test");
    assert_eq!(loaded.sidebar_width, Some(250));
}

#[test]
fn load_session_nonexistent_returns_empty() {
    let (_tmp, manager) = test_storage();
    let loaded = manager.load_session().unwrap();
    assert!(loaded.projects.is_empty());
}

#[test]
fn save_and_load_config_roundtrip() {
    let (_tmp, manager) = test_storage();
    let config = serde_json::json!({ "fontSize": 16, "diffMode": "split" });

    manager.save_config(&config).unwrap();
    let loaded = manager.load_config().unwrap();

    assert_eq!(loaded["fontSize"], 16);
    assert_eq!(loaded["diffMode"], "split");
}

#[test]
fn load_config_nonexistent_returns_empty_object() {
    let (_tmp, manager) = test_storage();
    let loaded = manager.load_config().unwrap();
    assert_eq!(loaded, serde_json::json!({}));
}

#[test]
fn get_config_dir_returns_path() {
    let (_tmp, manager) = test_storage();
    assert!(manager.get_config_dir().is_dir());
}

#[test]
fn create_session_from_projects() {
    let (_tmp, manager) = test_storage();
    let tmp_project = TempDir::new().unwrap();

    let projects = vec![Project {
        id: "p1".into(),
        name: "test".into(),
        path: tmp_project.path().to_path_buf(),
        git_info: None,
        terminal: TerminalSession {
            id: "t1".into(),
            pid: None,
            status: TerminalStatus::Running,
            history: vec!["output".into()],
            agent: None,
        },
        selected_agent: None,
        selected_ide: None,
        active_view: ViewMode::Terminal,
        collapsed: false,
        avatar_color: Some("#61afef".into()),
    }];

    let store = manager.create_session_from_projects(&projects, None, None, Some(300));
    assert_eq!(store.projects.len(), 1);
    assert_eq!(store.projects[0].id, "p1");
    assert!(!store.projects[0].collapsed);
    assert_eq!(store.sidebar_width, Some(300));
    assert_eq!(store.projects[0].avatar_color, Some("#61afef".into()));
}

#[test]
fn save_session_updates_last_updated() {
    let (_tmp, manager) = test_storage();
    let session = SessionStore::new();

    manager.save_session(&session).unwrap();
    let loaded = manager.load_session().unwrap();

    assert!(!loaded.last_updated.is_empty());
}
