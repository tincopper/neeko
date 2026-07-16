use neeko_lib::common::terminal::types::TerminalStatus;
use neeko_lib::project::types::{ProjectEnvironment, ViewMode};
use neeko_lib::project::ProjectManager;
use neeko_lib::session::types::ProjectSession;
use std::path::PathBuf;
use tempfile::TempDir;

#[test]
fn new_manager_is_empty() {
    let pm = ProjectManager::new(|_| {});
    assert!(pm.list_projects().is_empty());
}

#[test]
fn add_project_from_valid_path() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new(|_| {});

    let project = pm
        .add_project(tmp.path().to_path_buf(), None, None, None)
        .unwrap();

    assert_eq!(pm.list_projects().len(), 1);
    assert_eq!(project.path, tmp.path());
    assert!(!project.id.is_empty());
}

#[test]
fn add_project_nonexistent_path_fails() {
    let mut pm = ProjectManager::new(|_| {});
    let result = pm.add_project("/nonexistent/path/xyz".into(), None, None, None);
    assert!(result.is_err());
}

#[test]
fn add_project_with_agent_and_ide() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new(|_| {});

    let project = pm
        .add_project(
            tmp.path().to_path_buf(),
            Some("claude-code".into()),
            Some("code".into()),
            None,
        )
        .unwrap();

    assert_eq!(project.selected_agent, Some("claude-code".into()));
    assert_eq!(project.selected_ide, Some("code".into()));
}

#[test]
fn add_project_default_state() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new(|_| {});

    let project = pm
        .add_project(tmp.path().to_path_buf(), None, None, None)
        .unwrap();

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
    repo.commit(Some("HEAD"), &sig, &sig, "Init", &tree, &[])
        .unwrap();

    let mut pm = ProjectManager::new(|_| {});
    let project = pm
        .add_project(tmp.path().to_path_buf(), None, None, None)
        .unwrap();
    assert!(project.git_info.is_some());
}

#[test]
fn get_project_by_id() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new(|_| {});
    let project = pm
        .add_project(tmp.path().to_path_buf(), None, None, None)
        .unwrap();

    assert!(pm.get_project(&project.id).is_some());
    assert!(pm.get_project("nonexistent").is_none());
}

#[test]
fn remove_project() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new(|_| {});
    let project = pm
        .add_project(tmp.path().to_path_buf(), None, None, None)
        .unwrap();

    pm.remove_project(&project.id);
    assert!(pm.list_projects().is_empty());
}

#[test]
fn remove_nonexistent_project_is_noop() {
    let mut pm = ProjectManager::new(|_| {});
    pm.remove_project("nonexistent");
    assert!(pm.list_projects().is_empty());
}

#[test]
fn set_selected_agent() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new(|_| {});
    let project = pm
        .add_project(tmp.path().to_path_buf(), None, None, None)
        .unwrap();

    pm.set_selected_agent(&project.id, Some("opencode".into()));
    assert_eq!(
        pm.get_project(&project.id).unwrap().selected_agent,
        Some("opencode".into())
    );

    pm.set_selected_agent(&project.id, None);
    assert!(pm
        .get_project(&project.id)
        .unwrap()
        .selected_agent
        .is_none());
}

#[test]
fn set_selected_ide() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new(|_| {});
    let project = pm
        .add_project(tmp.path().to_path_buf(), None, None, None)
        .unwrap();

    pm.set_selected_ide(&project.id, Some("code".into()));
    assert_eq!(
        pm.get_project(&project.id).unwrap().selected_ide,
        Some("code".into())
    );
}

#[test]
fn set_collapsed() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new(|_| {});
    let project = pm
        .add_project(tmp.path().to_path_buf(), None, None, None)
        .unwrap();

    assert!(project.collapsed);
    pm.set_collapsed(&project.id, false);
    assert!(!pm.get_project(&project.id).unwrap().collapsed);
}

#[test]
fn set_avatar_color() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new(|_| {});
    let project = pm
        .add_project(tmp.path().to_path_buf(), None, None, None)
        .unwrap();

    // 默认应为 None
    assert!(pm.get_project(&project.id).unwrap().avatar_color.is_none());

    // 设置具体颜色后读回
    pm.set_avatar_color(&project.id, Some("#61afef".into()));
    assert_eq!(
        pm.get_project(&project.id).unwrap().avatar_color,
        Some("#61afef".into())
    );

    // Reset 回 None
    pm.set_avatar_color(&project.id, None);
    assert!(pm.get_project(&project.id).unwrap().avatar_color.is_none());
}

#[test]
fn add_project_persists_avatar_color() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new(|_| {});
    let project = pm
        .add_project(tmp.path().to_path_buf(), None, None, Some("#98c379".into()))
        .unwrap();

    assert_eq!(project.avatar_color, Some("#98c379".into()));
    assert_eq!(
        pm.get_project(&project.id).unwrap().avatar_color,
        Some("#98c379".into())
    );
}

#[test]
fn set_view_diff() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new(|_| {});
    let project = pm
        .add_project(tmp.path().to_path_buf(), None, None, None)
        .unwrap();

    pm.set_view_diff(&project.id, PathBuf::from("src/main.rs"));
    match &pm.get_project(&project.id).unwrap().active_view {
        ViewMode::Diff { file_path } => assert_eq!(*file_path, PathBuf::from("src/main.rs")),
        _ => panic!("Expected Diff view"),
    }
}

#[test]
fn set_view_terminal() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new(|_| {});
    let project = pm
        .add_project(tmp.path().to_path_buf(), None, None, None)
        .unwrap();

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
    let mut pm = ProjectManager::new(|_| {});

    let ps = ProjectSession {
        id: "custom-id".into(),
        name: "test".into(),
        path: tmp.path().to_path_buf(),
        environment: ProjectEnvironment::Local,
        selected_agent: Some("gemini".into()),
        selected_ide: Some("vim".into()),
        terminal_history: vec![],
        last_status: TerminalStatus::Idle,
        collapsed: false,
        avatar_color: None,
    };
    let project = pm.add_project_from_session(&ps).unwrap();

    assert_eq!(project.id, "custom-id");
    assert_eq!(project.selected_agent, Some("gemini".into()));
    assert!(!project.collapsed);
}

#[test]
fn add_project_from_session_nonexistent_path_fails() {
    let mut pm = ProjectManager::new(|_| {});
    let ps = ProjectSession {
        id: "id".into(),
        name: "nonexistent".into(),
        path: "/nonexistent".into(),
        environment: ProjectEnvironment::Local,
        selected_agent: None,
        selected_ide: None,
        terminal_history: vec![],
        last_status: TerminalStatus::Idle,
        collapsed: true,
        avatar_color: None,
    };
    let result = pm.add_project_from_session(&ps);
    assert!(result.is_err());
}

#[test]
fn list_projects_returns_empty_changed_files() {
    let tmp = TempDir::new().unwrap();
    let repo = git2::Repository::init(tmp.path()).unwrap();
    let sig = git2::Signature::now("Test", "test@test.com").unwrap();
    std::fs::write(tmp.path().join("README.md"), "# Test\n").unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(std::path::Path::new("README.md")).unwrap();
    index.write().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    repo.commit(Some("HEAD"), &sig, &sig, "Init", &tree, &[])
        .unwrap();

    // 添加一个修改的文件
    std::fs::write(tmp.path().join("README.md"), "# Modified\n").unwrap();

    let mut pm = ProjectManager::new(|_| {});
    pm.add_project(tmp.path().to_path_buf(), None, None, None)
        .unwrap();

    // list_projects 返回的项目 changed_files 应该为空
    let projects = pm.list_projects();
    assert_eq!(projects.len(), 1);
    let project = &projects[0];

    // 如果 git_info 存在，changed_files 应该为空
    if let Some(ref git_info) = project.git_info {
        assert!(
            git_info.changed_files.is_empty(),
            "Expected empty changed_files in list_projects output"
        );
    }
}
