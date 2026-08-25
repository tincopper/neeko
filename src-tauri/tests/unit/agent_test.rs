use neeko_lib::agent::AgentManager;
use neeko_lib::common::agent::types::AgentConfig;
use std::collections::HashMap;

#[test]
fn new_manager_has_default_agents() {
    let manager = AgentManager::new();
    let agents = manager.get_agents();
    assert!(!agents.is_empty());
}

#[test]
fn new_manager_contains_claude_code() {
    let manager = AgentManager::new();
    assert!(manager.get_agent("claude-code").is_some());
    let agent = manager.get_agent("claude-code").unwrap();
    assert_eq!(agent.command, "claude");
    assert!(agent.enabled);
}

#[test]
fn new_manager_contains_all_defaults() {
    let manager = AgentManager::new();
    let expected_ids = [
        "opencode",
        "claude-code",
        "gemini",
        "codex",
        "qoder",
        "codebuddy",
        "pi",
        "omp",
        "reasonix",
        "grok",
    ];
    for id in expected_ids {
        assert!(
            manager.get_agent(id).is_some(),
            "Missing default agent: {}",
            id
        );
    }
}

#[test]
fn get_agent_nonexistent_returns_none() {
    let manager = AgentManager::new();
    assert!(manager.get_agent("nonexistent").is_none());
}

#[test]
fn get_agents_returns_clone() {
    let manager = AgentManager::new();
    let agents1 = manager.get_agents();
    let agents2 = manager.get_agents();
    assert_eq!(agents1.len(), agents2.len());
}

#[test]
fn add_custom_agent() {
    let mut manager = AgentManager::new();
    let initial = manager.get_agents().len();

    manager.add_agent(AgentConfig {
        id: "test-agent".into(),
        name: "Test Agent".into(),
        command: "test".into(),
        args: vec!["--verbose".into()],
        env: HashMap::from([("KEY".into(), "val".into())]),
        icon: Some("test.png".into()),
        enabled: true,
        prompt_args: None,
        post_prompt_args: None,
        is_builtin: false,
        skill_path: None,
        chat: None,
        detection: None,
        deploy: Default::default(),
    });

    assert_eq!(manager.get_agents().len(), initial + 1);
    let agent = manager.get_agent("test-agent").unwrap();
    assert_eq!(agent.name, "Test Agent");
    assert_eq!(agent.args, vec!["--verbose"]);
}

#[test]
fn add_agent_with_builtin_id_overrides_in_place() {
    let mut manager = AgentManager::new();
    let initial = manager.get_agents().len();

    manager.add_agent(AgentConfig {
        id: "claude-code".into(),
        name: "Duplicate".into(),
        command: "dup".into(),
        args: vec![],
        env: HashMap::new(),
        icon: None,
        enabled: true,
        prompt_args: None,
        post_prompt_args: None,
        is_builtin: false,
        skill_path: None,
        chat: None,
        detection: None,
        deploy: Default::default(),
    });

    // 内置 id → 原位覆盖：长度不变、取回覆盖值、内置身份保留（不产生重复条目）
    assert_eq!(manager.get_agents().len(), initial);
    let agent = manager.get_agent("claude-code").expect("still present");
    assert_eq!(agent.command, "dup");
    assert_eq!(agent.name, "Duplicate");
    assert!(agent.is_builtin, "override keeps builtin identity");
}

#[test]
fn remove_agent() {
    let mut manager = AgentManager::new();
    manager.add_agent(AgentConfig {
        id: "temp".into(),
        name: "Temp".into(),
        command: "temp".into(),
        args: vec![],
        env: HashMap::new(),
        icon: None,
        enabled: true,
        prompt_args: None,
        post_prompt_args: None,
        is_builtin: false,
        skill_path: None,
        chat: None,
        detection: None,
        deploy: Default::default(),
    });
    assert!(manager.get_agent("temp").is_some());

    manager.remove_agent("temp");
    assert!(manager.get_agent("temp").is_none());
}

#[test]
fn remove_default_agent_resets_to_factory() {
    let mut manager = AgentManager::new();
    let initial = manager.get_agents().len();

    // 先覆盖，再 remove → 恢复出厂（内置不会被删除）
    manager.add_agent(AgentConfig {
        id: "claude-code".into(),
        name: "Custom Claude".into(),
        command: "my-claude".into(),
        args: vec![],
        env: HashMap::new(),
        icon: None,
        enabled: true,
        prompt_args: None,
        post_prompt_args: None,
        is_builtin: false,
        skill_path: None,
        chat: None,
        detection: None,
        deploy: Default::default(),
    });
    assert_eq!(
        manager.get_agent("claude-code").unwrap().command,
        "my-claude"
    );

    manager.remove_agent("claude-code");
    // 恢复出厂：仍在列表，值为内置原值
    assert_eq!(manager.get_agents().len(), initial);
    let agent = manager.get_agent("claude-code").expect("still present");
    assert_eq!(agent.command, "claude");
    assert!(agent.is_builtin);
}

#[test]
fn remove_nonexistent_agent_is_noop() {
    let mut manager = AgentManager::new();
    let initial = manager.get_agents().len();
    manager.remove_agent("does-not-exist");
    assert_eq!(manager.get_agents().len(), initial);
}
