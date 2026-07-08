use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::conversation::adapter::{AgentSessionAdapter, ParsedMessage, ParsedMeta};
use crate::conversation::adapters::{parse_timestamp, strip_ansi, truncate};

/// CodeBuddy 会话适配器
///
/// 会话格式一（JSON）：`~/.codebuddy/sessions/*.json`
///   每个文件为一个会话，包含完整消息历史（id, role, content, timestamp）
///
/// 会话格式二（SQLite）：`~/.codebuddy/` 目录下的 SQLite 数据库
///   优先尝试从 SQLite 读取
///
/// 支持原生恢复：`codebuddy --resume <SESSION_ID>`
pub struct CodeBuddyAdapter;

impl AgentSessionAdapter for CodeBuddyAdapter {
    fn agent_id(&self) -> &str {
        "codebuddy"
    }

    fn session_root(&self) -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("~"))
            .join(".codebuddy")
            .join("sessions")
    }

    fn file_pattern(&self) -> &str {
        "*.json"
    }

    #[allow(clippy::cast_possible_truncation)]
    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
        let content = std::fs::read_to_string(file_path)?;
        let root: serde_json::Value =
            serde_json::from_str(&content).context("Failed to parse CodeBuddy JSON file")?;

        let native_session_id = root
            .get("sessionId")
            .or_else(|| root.get("session_id"))
            .or_else(|| root.get("id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                file_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string()
            });

        let title = root
            .get("title")
            .or_else(|| root.get("name"))
            .or_else(|| root.get("description"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // 消息列表：支持 messages 数组或直接顶层数组
        let messages_val: Option<&Vec<serde_json::Value>> = root
            .get("messages")
            .and_then(|v| v.as_array())
            .or_else(|| root.as_array());

        let started_at = root
            .get("startedAt")
            .or_else(|| root.get("started_at"))
            .or_else(|| root.get("createdAt"))
            .or_else(|| root.get("timestamp"))
            .and_then(parse_timestamp)
            .or_else(|| {
                // 从第一条消息获取
                messages_val
                    .and_then(|arr| arr.first())
                    .and_then(|m| {
                        m.get("timestamp")
                            .or_else(|| m.get("time"))
                            .and_then(parse_timestamp)
                    })
            })
            .unwrap_or(0);

        let message_count = messages_val.map(|arr| arr.len() as u32).unwrap_or(0);

        let updated_at = messages_val
            .and_then(|arr| arr.last())
            .and_then(|last| {
                last.get("timestamp")
                    .or_else(|| last.get("time"))
                    .and_then(parse_timestamp)
            })
            .unwrap_or(started_at);

        // 预览：第一条 user 消息
        let preview = messages_val
            .and_then(|arr| {
                arr.iter().find(|m| {
                    m.get("role").and_then(|v| v.as_str()) == Some("user")
                })
            })
            .and_then(|m| {
                m.get("content")
                    .and_then(|v| v.as_str())
                    .or_else(|| m.get("text").and_then(|v| v.as_str()))
            })
            .map(|s| truncate(&strip_ansi(s), 200))
            .unwrap_or_default();

        let project_path = root
            .get("projectPath")
            .or_else(|| root.get("project_path"))
            .or_else(|| root.get("projectDir"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Ok(ParsedMeta {
            native_session_id,
            title,
            started_at,
            updated_at,
            message_count,
            preview,
            project_path,
        })
    }

    #[allow(clippy::cast_possible_truncation)]
    fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>> {
        let content = std::fs::read_to_string(file_path)?;
        let root: serde_json::Value =
            serde_json::from_str(&content).context("Failed to parse CodeBuddy JSON file")?;

        let messages_val: Vec<&serde_json::Value> = root
            .get("messages")
            .and_then(|v| v.as_array())
            .or_else(|| root.as_array())
            .context("No messages in CodeBuddy file")?
            .iter()
            .collect();

        let mut messages = Vec::new();
        for (seq, msg) in messages_val.iter().enumerate() {
            let role = msg
                .get("role")
                .and_then(|v| v.as_str())
                .unwrap_or("user");

            let content = msg
                .get("content")
                .and_then(|v| v.as_str())
                .or_else(|| msg.get("text").and_then(|v| v.as_str()))
                .or_else(|| msg.get("message").and_then(|v| v.as_str()))
                .unwrap_or("");

            let cleaned = strip_ansi(content);
            if cleaned.is_empty() {
                continue;
            }

            let timestamp = msg
                .get("timestamp")
                .or_else(|| msg.get("time"))
                .and_then(parse_timestamp)
                .unwrap_or(0);

            messages.push(ParsedMessage {
                role: role.to_string(),
                content: cleaned,
                timestamp,
                seq: seq as u32,
            });
        }

        Ok(messages)
    }

    fn extract_session_id(&self, file_path: &Path) -> Option<String> {
        file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
    }

    fn resume_command(&self, native_session_id: &str, _project_path: &str) -> Option<Vec<String>> {
        Some(vec![
            "--resume".to_string(),
            native_session_id.to_string(),
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_codebuddy_fixture(dir: &TempDir, name: &str) -> PathBuf {
        let path = dir.path().join(name);
        let json = serde_json::json!({
            "sessionId": "cb-session-001",
            "title": "Refactor user service",
            "startedAt": "2025-01-15T10:00:00Z",
            "projectPath": "/projects/test",
            "messages": [
                {
                    "id": "m1",
                    "role": "user",
                    "content": "Can you refactor the user service to use dependency injection?",
                    "timestamp": "2025-01-15T10:00:01Z"
                },
                {
                    "id": "m2",
                    "role": "assistant",
                    "content": "Sure! I'll create an interface and inject it through the constructor.",
                    "timestamp": "2025-01-15T10:00:02Z"
                },
                {
                    "id": "m3",
                    "role": "user",
                    "content": "Also add unit tests for the new service",
                    "timestamp": "2025-01-15T10:00:03Z"
                }
            ]
        });

        std::fs::write(&path, json.to_string()).expect("Failed to write fixture");
        path
    }

    #[test]
    fn should_parse_meta() {
        let dir = TempDir::new().unwrap();
        let path = create_codebuddy_fixture(&dir, "cb-session.json");
        let adapter = CodeBuddyAdapter;

        let meta = adapter.parse_meta(&path).unwrap();
        assert_eq!(meta.native_session_id, "cb-session-001");
        assert_eq!(meta.title.as_deref(), Some("Refactor user service"));
        assert_eq!(meta.message_count, 3);
        assert!(meta.preview.contains("refactor the user service"));
        assert_eq!(meta.project_path.as_deref(), Some("/projects/test"));
    }

    #[test]
    fn should_parse_messages() {
        let dir = TempDir::new().unwrap();
        let path = create_codebuddy_fixture(&dir, "cb-session.json");
        let adapter = CodeBuddyAdapter;

        let messages = adapter.parse_messages(&path).unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "Can you refactor the user service to use dependency injection?");
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[1].content, "Sure! I'll create an interface and inject it through the constructor.");
        assert_eq!(messages[2].role, "user");
        assert_eq!(messages[2].content, "Also add unit tests for the new service");
    }

    #[test]
    fn should_return_resume_command() {
        let cmd = CodeBuddyAdapter.resume_command("cb-session-001", "/projects/test");
        assert_eq!(
            cmd,
            Some(vec![
                "--resume".to_string(),
                "cb-session-001".to_string(),
            ])
        );
    }

    #[test]
    fn should_handle_empty_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("empty.json");
        std::fs::write(&path, "").expect("Failed to write");

        let result = CodeBuddyAdapter.parse_meta(&path);
        assert!(result.is_err());
    }

    #[test]
    fn should_handle_flat_array_format() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("flat.json");
        let json = serde_json::json!([
            {"role": "user", "content": "Hello", "timestamp": "2025-01-15T10:00:01Z"},
            {"role": "assistant", "content": "Hi!", "timestamp": "2025-01-15T10:00:02Z"}
        ]);
        std::fs::write(&path, json.to_string()).expect("Failed to write");

        let meta = CodeBuddyAdapter.parse_meta(&path).unwrap();
        assert_eq!(meta.message_count, 2);

        let messages = CodeBuddyAdapter.parse_messages(&path).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].content, "Hello");
        assert_eq!(messages[1].content, "Hi!");
    }
}
