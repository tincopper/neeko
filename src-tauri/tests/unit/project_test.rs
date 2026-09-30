use neeko_lib::common::terminal::types::TerminalStatus;
use neeko_lib::project::types::{ProjectEnvironment, ViewMode};
use neeko_lib::project::ProjectManager;
use neeko_lib::session::types::ProjectSession;
use std::path::PathBuf;
use tempfile::TempDir;

use super::support;

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

    assert_eq!(project.selected_agents, vec!["claude-code".to_string()]);
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
    let trepo = support::TestRepo::init();
    let mut pm = ProjectManager::new(|_| {});
    let project = pm
        .add_project(trepo.path().to_path_buf(), None, None, None)
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
fn set_selected_agents() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new(|_| {});
    let project = pm
        .add_project(tmp.path().to_path_buf(), None, None, None)
        .unwrap();

    pm.set_selected_agents(&project.id, vec!["opencode".to_string()]);
    assert_eq!(
        pm.get_project(&project.id).unwrap().selected_agents,
        vec!["opencode".to_string()]
    );

    pm.set_selected_agents(&project.id, vec![]);
    assert!(pm
        .get_project(&project.id)
        .unwrap()
        .selected_agents
        .is_empty());
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
        selected_agents: vec!["gemini".to_string()],
        selected_ide: Some("vim".into()),
        terminal_history: vec![],
        last_status: TerminalStatus::Idle,
        collapsed: false,
        avatar_color: None,
        primary_language: Some("go".into()),
    };
    let project = pm.add_project_from_session(&ps).unwrap();

    assert_eq!(project.id, "custom-id");
    assert_eq!(project.selected_agents, vec!["gemini".to_string()]);
    assert_eq!(project.primary_language, Some("go".into()));
    assert!(!project.collapsed);
}

#[test]
fn add_project_from_session_git_repo_restores_git_info() {
    // 回归：session 恢复必须重建 git_info。持久化类型不含 git_info，若恢复时留 None，
    // 前端 bootstrap 会把 null 误判为非 git 项目，跳过 changed/ignored 拉取，
    // 导致文件树 git 状态色与忽略灰化失效。
    let trepo = support::TestRepo::init();
    let mut pm = ProjectManager::new(|_| {});

    let ps = ProjectSession {
        id: "session-git".into(),
        name: "repo".into(),
        path: trepo.path().to_path_buf(),
        environment: ProjectEnvironment::Local,
        selected_agents: vec![],
        selected_ide: None,
        terminal_history: vec![],
        last_status: TerminalStatus::Idle,
        collapsed: true,
        avatar_color: None,
        primary_language: None,
    };
    let project = pm.add_project_from_session(&ps).unwrap();
    assert!(
        project.git_info.is_some(),
        "git repo session restore must populate git_info"
    );
}

#[test]
fn add_project_from_session_non_git_keeps_git_info_none() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new(|_| {});

    let ps = ProjectSession {
        id: "session-plain".into(),
        name: "plain".into(),
        path: tmp.path().to_path_buf(),
        environment: ProjectEnvironment::Local,
        selected_agents: vec![],
        selected_ide: None,
        terminal_history: vec![],
        last_status: TerminalStatus::Idle,
        collapsed: true,
        avatar_color: None,
        primary_language: None,
    };
    let project = pm.add_project_from_session(&ps).unwrap();
    assert!(project.git_info.is_none());
}

#[test]
fn set_primary_language_persists_on_project() {
    let tmp = TempDir::new().unwrap();
    let mut pm = ProjectManager::new(|_| {});
    let project = pm
        .add_project(tmp.path().to_path_buf(), None, None, None)
        .unwrap();
    assert!(project.primary_language.is_none());

    pm.set_primary_language(&project.id, Some("rust".into()));
    assert_eq!(
        pm.get_project(&project.id).unwrap().primary_language,
        Some("rust".into())
    );

    pm.set_primary_language(&project.id, Some("  ".into()));
    assert!(pm
        .get_project(&project.id)
        .unwrap()
        .primary_language
        .is_none());

    pm.set_primary_language(&project.id, Some("go".into()));
    pm.set_primary_language(&project.id, None);
    assert!(pm
        .get_project(&project.id)
        .unwrap()
        .primary_language
        .is_none());
}

#[test]
fn add_project_from_session_nonexistent_path_fails() {
    let mut pm = ProjectManager::new(|_| {});
    let ps = ProjectSession {
        id: "id".into(),
        name: "nonexistent".into(),
        path: "/nonexistent".into(),
        environment: ProjectEnvironment::Local,
        selected_agents: vec![],
        selected_ide: None,
        terminal_history: vec![],
        last_status: TerminalStatus::Idle,
        collapsed: true,
        avatar_color: None,
        primary_language: None,
    };
    let result = pm.add_project_from_session(&ps);
    assert!(result.is_err());
}

#[test]
fn list_projects_carries_git_metadata_but_no_per_worktree_status() {
    let trepo = support::TestRepo::init();

    // 脏工作树：status 事实存在，但它属于**仓库单元**，不属于项目登记信息
    std::fs::write(trepo.path().join("README.md"), "# Modified\n").unwrap();

    let mut pm = ProjectManager::new(|_| {});
    pm.add_project(trepo.path().to_path_buf(), None, None, None)
        .unwrap();

    let projects = pm.list_projects();
    assert_eq!(projects.len(), 1);
    let project = &projects[0];

    // 项目登记只带 per-project 元数据（旧断言是「changed_files 为空」，现在类型上
    // 就没有这个字段 —— 断言升级为「IPC 载荷里根本不允许出现这两个键」，语义不变强于不变弱）
    let git_info = project
        .git_info
        .as_ref()
        .expect("git 项目的 list_projects 必须带 git_info");
    assert!(!git_info.current_branch.is_empty());

    let json = serde_json::to_value(&projects).expect("serialize projects");
    let dump = json.to_string();
    assert!(
        !dump.contains("changed_files"),
        "list_projects 载荷不得携带 per-worktree 变更列表（它是单元事实，走 GitStatusSnapshot）\n{dump}"
    );
    assert!(
        !dump.contains("is_clean"),
        "list_projects 载荷不得携带 per-worktree clean 标记\n{dump}"
    );
}
