use neeko_lib::project::ProjectManager;
use neeko_lib::state::{TerminalStatus, ViewMode};
use std::path::PathBuf;
use tempfile::TempDir;

#[test]
fn new_manager_is_empty() {
    let pm = ProjectManager::new();
    assert!(pm.list_projects().is_empty());
}

#[test]
fn add_project_from_valid_path() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new();

    let project = pm.add_project(tmp.path().to_path_buf(), None, None).unwrap();

    assert_eq!(pm.list_projects().len(), 1);
    assert_eq!(project.path, tmp.path());
    assert!(!project.id.is_empty());
}

#[test]
fn add_project_nonexistent_path_fails() {
    let mut pm = ProjectManager::new();
    let result = pm.add_project("/nonexistent/path/xyz".into(), None, None);
    assert!(result.is_err());
}

#[test]
fn add_project_with_agent_and_ide() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new();

    let project = pm.add_project(
        tmp.path().to_path_buf(),
        Some("claude-code".into()),
        Some("code".into()),
    ).unwrap();

    assert_eq!(project.selected_agent, Some("claude-code".into()));
    assert_eq!(project.selected_ide, Some("code".into()));
}

#[test]
fn add_project_default_state() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new();

    let project = pm.add_project(tmp.path().to_path_buf(), None, None).unwrap();

    assert!(project.collapsed);
    assert!(project.git_info.is_none());
    assert_eq!(project.terminal.status as u8, TerminalStatus::Idle as u8);
    assert!(project.terminal.history.is_empty());
}

#[test]
fn add_project_from_git_repo() {
    let tmp = TempDir::new().unwrap();
    let repo = git2::Repository::init(tmp.path()).unwrap();
    let sig = git2::Signature::now("Test", "test@test.com").unwrap();
    std::fs::write(tmp.path().join("README.md"), "# Test\n").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(std::path::Path::new("README.md")).unwrap();
    index.write().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "Init", &tree, &[]).unwrap();

    let mut pm = ProjectManager::new();
    let project = pm.add_project(tmp.path().to_path_buf(), None, None).unwrap();
    assert!(project.git_info.is_some());
}

#[test]
fn get_project_by_id() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new();
    let project = pm.add_project(tmp.path().to_path_buf(), None, None).unwrap();

    assert!(pm.get_project(&project.id).is_some());
    assert!(pm.get_project("nonexistent").is_none());
}

#[test]
fn remove_project() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new();
    let project = pm.add_project(tmp.path().to_path_buf(), None, None).unwrap();

    pm.remove_project(&project.id);
    assert!(pm.list_projects().is_empty());
}

#[test]
fn remove_nonexistent_project_is_noop() {
    let mut pm = ProjectManager::new();
    pm.remove_project("nonexistent");
    assert!(pm.list_projects().is_empty());
}

#[test]
fn set_selected_agent() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new();
    let project = pm.add_project(tmp.path().to_path_buf(), None, None).unwrap();

    pm.set_selected_agent(&project.id, Some("qwen".into()));
    assert_eq!(pm.get_project(&project.id).unwrap().selected_agent, Some("qwen".into()));

    pm.set_selected_agent(&project.id, None);
    assert!(pm.get_project(&project.id).unwrap().selected_agent.is_none());
}

#[test]
fn set_selected_ide() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new();
    let project = pm.add_project(tmp.path().to_path_buf(), None, None).unwrap();

    pm.set_selected_ide(&project.id, Some("code".into()));
    assert_eq!(pm.get_project(&project.id).unwrap().selected_ide, Some("code".into()));
}

#[test]
fn set_collapsed() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new();
    let project = pm.add_project(tmp.path().to_path_buf(), None, None).unwrap();

    assert!(project.collapsed);
    pm.set_collapsed(&project.id, false);
    assert!(!pm.get_project(&project.id).unwrap().collapsed);
}

#[test]
fn set_view_diff() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new();
    let project = pm.add_project(tmp.path().to_path_buf(), None, None).unwrap();

    pm.set_view_diff(&project.id, PathBuf::from("src/main.rs"));
    match &pm.get_project(&project.id).unwrap().active_view {
        ViewMode::Diff { file_path } => assert_eq!(*file_path, PathBuf::from("src/main.rs")),
        _ => panic!("Expected Diff view"),
    }
}

#[test]
fn set_view_terminal() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new();
    let project = pm.add_project(tmp.path().to_path_buf(), None, None).unwrap();

    pm.set_view_diff(&project.id, PathBuf::from("file.rs"));
    pm.set_view_terminal(&project.id);
    match &pm.get_project(&project.id).unwrap().active_view {
        ViewMode::Terminal => {}
        _ => panic!("Expected Terminal view"),
    }
}

#[test]
fn add_project_from_session() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new();

    let project = pm.add_project_from_session(
        "custom-id".into(),
        tmp.path().to_path_buf(),
        Some("gemini".into()),
        Some("vim".into()),
        false,
    ).unwrap();

    assert_eq!(project.id, "custom-id");
    assert_eq!(project.selected_agent, Some("gemini".into()));
    assert!(!project.collapsed);
}

#[test]
fn add_project_from_session_nonexistent_path_fails() {
    let mut pm = ProjectManager::new();
    let result = pm.add_project_from_session(
        "id".into(),
        "/nonexistent".into(),
        None,
        None,
        true,
    );
    assert!(result.is_err());
}
