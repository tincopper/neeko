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
    });

    assert_eq!(manager.get_agents().len(), initial + 1);
    let agent = manager.get_agent("test-agent").unwrap();
    assert_eq!(agent.name, "Test Agent");
    assert_eq!(agent.args, vec!["--verbose"]);
}

#[test]
fn add_agent_with_duplicate_id() {
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
    });

    // duplicates are allowed — both entries exist
    assert_eq!(manager.get_agents().len(), initial + 1);
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
    });
    assert!(manager.get_agent("temp").is_some());

    manager.remove_agent("temp");
    assert!(manager.get_agent("temp").is_none());
}

#[test]
fn remove_default_agent() {
    let mut manager = AgentManager::new();
    let initial = manager.get_agents().len();

    manager.remove_agent("claude-code");
    assert_eq!(manager.get_agents().len(), initial - 1);
    assert!(manager.get_agent("claude-code").is_none());
}

#[test]
fn remove_nonexistent_agent_is_noop() {
    let mut manager = AgentManager::new();
    let initial = manager.get_agents().len();
    manager.remove_agent("does-not-exist");
    assert_eq!(manager.get_agents().len(), initial);
}
