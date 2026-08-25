//! 内置 Agent 契约测试：数量、完整性、能力矩阵与特例。

use crate::common::agent::types::ChatStart;

use super::{builtin_configs, config_map, default_configs};

#[test]
fn provides_eleven_builtin_configs() {
    assert_eq!(builtin_configs().len(), 11);
}

#[test]
fn serialized_configs_keep_is_builtin_and_chat() {
    // IPC 载荷契约：is_builtin 必须为 true（前端 filter 依据）；chat 序列化为
    // 小写字符串或省略（null 被 skip）。防止将来 serde 属性改动悄悄破坏前端。
    for c in builtin_configs() {
        let json = serde_json::to_value(&c).unwrap();
        assert_eq!(
            json["is_builtin"].as_bool(),
            Some(true),
            "{} is_builtin lost in serialization",
            c.id
        );
        if c.chat.is_some() {
            assert!(
                json["chat"].as_str().is_some(),
                "{} chat should serialize as string",
                c.id
            );
        }
    }
}

#[test]
fn default_configs_aliases_builtin() {
    assert_eq!(default_configs().len(), 11);
}

#[test]
fn all_configs_have_complete_contract() {
    for c in builtin_configs() {
        assert!(!c.id.is_empty(), "id empty");
        assert!(!c.name.is_empty(), "{} name empty", c.id);
        // mockAgent 为进程内 agent，允许空 command（无 CLI 能力）。
        if c.id != "mockAgent" {
            assert!(!c.command.is_empty(), "{} command empty", c.id);
        }
        assert!(!c.deploy.skills.is_empty(), "{} deploy.skills empty", c.id);
        assert!(c.is_builtin, "{} should be builtin", c.id);
    }
}

#[test]
fn config_map_links_ids() {
    let map = config_map();
    assert_eq!(map.len(), 11);
    assert!(map.contains_key("opencode"));
    assert!(map.contains_key("claude-code"));
    assert!(!map.contains_key("deepseek-harness"));
}

#[test]
fn chat_agents_are_exactly_two() {
    let chat: Vec<String> = builtin_configs()
        .into_iter()
        .filter(|c| c.is_chat_agent())
        .map(|c| c.id)
        .collect();
    assert_eq!(chat, vec!["opencode".to_string(), "mockAgent".to_string()]);
}

#[test]
fn opencode_defaults_to_serve_chat() {
    let c = config_map();
    let opencode = c.get("opencode").expect("opencode config");
    assert_eq!(opencode.chat, Some(ChatStart::Serve));
    assert!(opencode.is_cli_agent());
    assert!(opencode.is_headless_agent());
    assert_eq!(
        opencode.skill_path.as_deref(),
        Some("~/.config/opencode/skills")
    );
}

#[test]
fn mock_agent_is_chat_only() {
    let c = config_map();
    let mock = c.get("mockAgent").expect("mockAgent config");
    assert_eq!(mock.chat, Some(ChatStart::Mock));
    assert!(!mock.is_cli_agent(), "mockAgent 无 CLI 能力");
    assert!(!mock.is_headless_agent(), "mockAgent 无 Headless 能力");
    assert!(mock.detection.is_none(), "mockAgent 不可检测（恒已安装）");
}

#[test]
fn all_cli_agents_support_headless() {
    for c in builtin_configs() {
        if c.is_cli_agent() {
            assert!(c.is_headless_agent(), "{} 缺 prompt_args", c.id);
        }
    }
}

#[test]
fn special_skill_paths_preserved() {
    let map = config_map();
    assert_eq!(
        map.get("opencode").unwrap().skill_path.as_deref(),
        Some("~/.config/opencode/skills")
    );
    assert_eq!(
        map.get("claude-code").unwrap().skill_path.as_deref(),
        Some("~/.claude/skills")
    );
    assert_eq!(
        map.get("gemini").unwrap().skill_path.as_deref(),
        Some("~/.gemini/skills")
    );
}

#[test]
fn mcp_and_commands_deploy_capabilities() {
    let map = config_map();
    // claude-code 支持三类部署。
    let cc = map.get("claude-code").unwrap();
    assert!(cc.deploy.supports_mcp());
    assert!(cc.deploy.supports_commands());
    // mockAgent 仅 skill 部署。
    let mock = map.get("mockAgent").unwrap();
    assert!(!mock.deploy.supports_mcp());
    assert!(!mock.deploy.supports_commands());
}
