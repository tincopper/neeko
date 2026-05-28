use neeko_lib::agent::types::AgentConfig;
use neeko_lib::connection::types::AuthMethod;
use neeko_lib::git::types::DiffLine;
use neeko_lib::project::types::{FileChange, FileStatus, ViewMode};
use neeko_lib::session::types::{
    ProjectSession, RemoteEntrySession, RemoteProjectSession, SessionStore, WSLProjectSession,
};
use neeko_lib::terminal::types::TerminalStatus;
use std::collections::HashMap;
use std::path::PathBuf;

#[test]
fn terminal_status_serde_roundtrip() {
    let statuses = vec![
        TerminalStatus::Idle,
        TerminalStatus::Running,
        TerminalStatus::Failed,
    ];
    for status in statuses {
        let json = serde_json::to_string(&status).unwrap();
        let back: TerminalStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(format!("{:?}", status), format!("{:?}", back));
    }
}

#[test]
fn file_status_serde_roundtrip() {
    let statuses = vec![
        FileStatus::Modified,
        FileStatus::Added,
        FileStatus::Deleted,
        FileStatus::Renamed,
        FileStatus::Untracked,
    ];
    for status in statuses {
        let json = serde_json::to_string(&status).unwrap();
        let back: FileStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(format!("{:?}", status), format!("{:?}", back));
    }
}

#[test]
fn view_mode_terminal_serializes_as_string() {
    let mode = ViewMode::Terminal;
    let json = serde_json::to_string(&mode).unwrap();
    assert_eq!(json, r#""Terminal""#);
}

#[test]
fn view_mode_diff_serializes_as_object() {
    let mode = ViewMode::Diff {
        file_path: PathBuf::from("src/main.rs"),
    };
    let json = serde_json::to_string(&mode).unwrap();
    assert!(json.contains("Diff"));
    assert!(json.contains("src/main.rs"));
}

#[test]
fn auth_method_password_serialization() {
    let auth = AuthMethod::Password("secret".into());
    let json = serde_json::to_string(&auth).unwrap();
    assert!(json.contains("Password"));
    assert!(json.contains("secret"));

    let back: AuthMethod = serde_json::from_str(&json).unwrap();
    assert!(matches!(back, AuthMethod::Password(s) if s == "secret"));
}

#[test]
fn auth_method_keyfile_serialization() {
    let auth = AuthMethod::KeyFile("/path/to/key".into());
    let json = serde_json::to_string(&auth).unwrap();
    assert!(json.contains("KeyFile"));

    let back: AuthMethod = serde_json::from_str(&json).unwrap();
    assert!(matches!(back, AuthMethod::KeyFile(p) if p == "/path/to/key"));
}

#[test]
fn session_store_new_is_empty() {
    let store = SessionStore::new();
    assert!(store.projects.is_empty());
    assert!(store.active_project_id.is_none());
    assert!(store.wsl_entries.is_empty());
    assert!(store.remote_entries.is_empty());
    assert!(store.sidebar_width.is_none());
}

#[test]
fn session_store_defaults_for_missing_fields() {
    let json = r#"{
        "projects": [],
        "active_project_id": null,
        "last_updated": "2024-01-01T00:00:00+00:00"
    }"#;
    let store: SessionStore = serde_json::from_str(json).unwrap();
    assert!(store.wsl_entries.is_empty());
    assert!(store.remote_entries.is_empty());
    assert!(store.sidebar_width.is_none());
    assert!(store.worktree_state.is_empty());
}

#[test]
fn session_store_serde_roundtrip() {
    let store = SessionStore {
        projects: vec![ProjectSession {
            id: "p1".into(),
            name: "test".into(),
            path: PathBuf::from("/tmp/test"),
            selected_agent: Some("claude-code".into()),
            selected_ide: None,
            terminal_history: vec!["line1".into()],
            last_status: TerminalStatus::Idle,
            collapsed: true,
            avatar_color: None,
        }],
        active_project_id: Some("p1".into()),
        last_updated: "2024-01-01T00:00:00+00:00".into(),
        wsl_entries: vec![],
        remote_entries: vec![],
        sidebar_width: Some(300),
        worktree_state: HashMap::new(),
    };

    let json = serde_json::to_string(&store).unwrap();
    let back: SessionStore = serde_json::from_str(&json).unwrap();
    assert_eq!(back.projects.len(), 1);
    assert_eq!(back.projects[0].id, "p1");
    assert_eq!(back.sidebar_width, Some(300));
}

#[test]
fn diff_line_serde_roundtrip() {
    let lines = vec![
        DiffLine::Context("unchanged".into()),
        DiffLine::Added("new line".into()),
        DiffLine::Removed("old line".into()),
    ];
    for line in lines {
        let json = serde_json::to_string(&line).unwrap();
        let back: DiffLine = serde_json::from_str(&json).unwrap();
        assert_eq!(format!("{:?}", line), format!("{:?}", back));
    }
}

#[test]
fn file_change_serde_roundtrip() {
    let change = FileChange {
        path: PathBuf::from("src/main.rs"),
        status: FileStatus::Modified,
        additions: 5,
        deletions: 2,
    };
    let json = serde_json::to_string(&change).unwrap();
    let back: FileChange = serde_json::from_str(&json).unwrap();
    assert_eq!(back.path, PathBuf::from("src/main.rs"));
    assert_eq!(back.additions, 5);
    assert_eq!(back.deletions, 2);
}

#[test]
fn agent_config_serde_roundtrip() {
    let config = AgentConfig {
        id: "test".into(),
        name: "Test".into(),
        command: "test-cmd".into(),
        args: vec!["--flag".into()],
        env: HashMap::from([("KEY".into(), "VAL".into())]),
        icon: Some("icon.png".into()),
        enabled: true,
        prompt_args: None,
        post_prompt_args: None,
        is_builtin: false,
        default_skill_path: None,
    };
    let json = serde_json::to_string(&config).unwrap();
    let back: AgentConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(back.id, "test");
    assert_eq!(back.args, vec!["--flag"]);
    assert_eq!(back.env.get("KEY").unwrap(), "VAL");
}

#[test]
fn project_session_missing_avatar_color_defaults_to_none() {
    // 旧 sessions.json 缺 avatar_color 字段时反序列化为 None
    let json = r#"{
        "id": "p1",
        "name": "test",
        "path": "/tmp/test",
        "selected_agent": null,
        "selected_ide": null,
        "terminal_history": [],
        "last_status": "Idle"
    }"#;
    let session: ProjectSession = serde_json::from_str(json).unwrap();
    assert!(session.avatar_color.is_none());
}

#[test]
fn project_session_avatar_color_serde_roundtrip() {
    let session = ProjectSession {
        id: "p1".into(),
        name: "test".into(),
        path: PathBuf::from("/tmp/test"),
        selected_agent: None,
        selected_ide: None,
        terminal_history: vec![],
        last_status: TerminalStatus::Idle,
        collapsed: true,
        avatar_color: Some("#61afef".into()),
    };
    let json = serde_json::to_string(&session).unwrap();
    let back: ProjectSession = serde_json::from_str(&json).unwrap();
    assert_eq!(back.avatar_color, Some("#61afef".into()));
}

#[test]
fn wsl_project_session_missing_avatar_color_defaults_to_none() {
    let json = r#"{
        "id": "w1",
        "name": "wsl-app",
        "path": "/home/user/app",
        "distro": "Ubuntu",
        "entry_id": "e1"
    }"#;
    let session: WSLProjectSession = serde_json::from_str(json).unwrap();
    assert!(session.avatar_color.is_none());
    assert!(session.selected_agent.is_none());
}

#[test]
fn wsl_project_session_avatar_color_serde_roundtrip() {
    let session = WSLProjectSession {
        id: "w1".into(),
        name: "wsl-app".into(),
        path: "/home/user/app".into(),
        distro: "Ubuntu".into(),
        entry_id: "e1".into(),
        selected_agent: None,
        selected_ide: None,
        avatar_color: Some("#e06c75".into()),
    };
    let json = serde_json::to_string(&session).unwrap();
    let back: WSLProjectSession = serde_json::from_str(&json).unwrap();
    assert_eq!(back.avatar_color, Some("#e06c75".into()));
}

#[test]
fn remote_project_session_missing_avatar_color_defaults_to_none() {
    let json = r#"{
        "id": "r1",
        "name": "remote-app",
        "path": "/srv/app",
        "entry_id": "e1"
    }"#;
    let session: RemoteProjectSession = serde_json::from_str(json).unwrap();
    assert!(session.avatar_color.is_none());
}

#[test]
fn remote_project_session_avatar_color_serde_roundtrip() {
    let session = RemoteProjectSession {
        id: "r1".into(),
        name: "remote-app".into(),
        path: "/srv/app".into(),
        entry_id: "e1".into(),
        selected_agent: None,
        selected_ide: None,
        avatar_color: Some("#c678dd".into()),
    };
    let json = serde_json::to_string(&session).unwrap();
    let back: RemoteProjectSession = serde_json::from_str(&json).unwrap();
    assert_eq!(back.avatar_color, Some("#c678dd".into()));
}

#[test]
fn remote_entry_session_saved_auth_default() {
    let json = r#"{
        "id": "r1",
        "host": "example.com",
        "port": 22,
        "username": "user",
        "projects": []
    }"#;
    let entry: RemoteEntrySession = serde_json::from_str(json).unwrap();
    assert!(entry.saved_auth.is_none());
}
