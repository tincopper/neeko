use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::conversation::adapter::{AgentSessionAdapter, ParsedMessage, ParsedMeta};
use crate::conversation::adapters::{
    parse_timestamp, recent_messages_from, strip_ansi,
};

/// Gemini CLI 会话适配器
///
/// 会话格式：`~/.gemini/tmp/<hash>/chats/*.json`
/// - 单文件 JSON，ConversationRecord 结构
/// - 包含 sessionId, projectHash, startTime, messages 数组
/// - 不支持原生 CLI 恢复（仅 TUI 内的 /chat resume 命令）
pub struct GeminiAdapter;

impl AgentSessionAdapter for GeminiAdapter {
    fn agent_id(&self) -> &str {
        "gemini"
    }

    fn session_root(&self) -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("~"))
            .join(".gemini")
            .join("tmp")
    }

    fn file_pattern(&self) -> &str {
        "*.json"
    }

    #[allow(clippy::cast_possible_truncation)]
    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
        let content = std::fs::read_to_string(file_path)?;
        let root: serde_json::Value =
            serde_json::from_str(&content).context("Failed to parse Gemini JSON file")?;

        let native_session_id = root
            .get("sessionId")
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
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let started_at = root
            .get("startTime")
            .or_else(|| root.get("startedAt"))
            .or_else(|| root.get("createdAt"))
            .and_then(parse_timestamp)
            .unwrap_or(0);

        // 消息列表
        let messages_val = root.get("messages").and_then(|v| v.as_array());
        let message_count = messages_val.map(|arr| arr.len() as u32).unwrap_or(0);

        let updated_at = messages_val
            .and_then(|arr| arr.last())
            .and_then(|last| {
                last.get("timestamp")
                    .or_else(|| last.get("time"))
                    .and_then(parse_timestamp)
            })
            .unwrap_or(started_at);

        // 首条用户消息（P3 标题候选）
        let first_user_raw = messages_val
            .and_then(|arr| {
                arr.iter().find(|m| {
                    m.get("type").and_then(|v| v.as_str())
                        == Some("user")
                })
            })
            .and_then(|m| m.get("content").and_then(|v| v.as_str()))
            .map(|s| s.to_string());

        // 最近消息缓冲（剔除 harness 注入噪声），供 manager 构建预览
        let recent_pairs: Vec<(String, String)> = messages_val
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| {
                        let role = m
                            .get("role")
                            .and_then(|v| v.as_str())
                            .unwrap_or("user")
                            .to_string();
                        let text = m
                            .get("content")
                            .and_then(|v| v.as_str())
                            .or_else(|| m.get("text").and_then(|v| v.as_str()))?;
                        let t = text.trim().to_string();
                        if t.is_empty() {
                            return None;
                        }
                        Some((role, t))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let recent_messages = recent_messages_from(recent_pairs);

        let project_path = root
            .get("projectPath")
            .or_else(|| root.get("projectHash"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
 
        Ok(ParsedMeta {
            native_session_id,
            title,
            first_user_message: first_user_raw,
            recent_messages,
            model: None,
            started_at,
            updated_at,
            message_count,
            project_path,
        })
    }

    #[allow(clippy::cast_possible_truncation)]
    fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>> {
        let content = std::fs::read_to_string(file_path)?;
        let root: serde_json::Value =
            serde_json::from_str(&content).context("Failed to parse Gemini JSON file")?;

        let messages_val = root
            .get("messages")
            .and_then(|v| v.as_array())
            .context("No messages array in Gemini conversation")?;

        let mut messages = Vec::new();
        for (seq, msg) in messages_val.iter().enumerate() {
            let role = msg
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("user")
                .to_string()
                .replace("gemini", "assistant");

            let content = msg
                .get("content")
                .and_then(|v| v.as_str())
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
                role,
                content: cleaned,
                blocks: Vec::new(),
                model: None,
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

    fn resume_command(&self, _native_session_id: &str, _project_path: &str) -> Option<Vec<String>> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_gemini_fixture(dir: &TempDir, name: &str) -> PathBuf {
        let path = dir.path().join(name);
        let json = serde_json::json!({
            "sessionId": "gemini-session-001",
            "projectHash": "abc123def456",
            "startTime": "2025-01-15T10:00:00Z",
            "title": "API design discussion",
            "messages": [
                {
                    "id": "m1",
                    "timestamp": "2025-01-15T10:00:01Z",
                    "type": "user",
                    "content": "Can you help me design a REST API?"
                },
                {
                    "id": "m2",
                    "timestamp": "2025-01-15T10:00:02Z",
                    "type": "gemini",
                    "content": "Sure! Let's start with the endpoints..."
                },
                {
                    "id": "m3",
                    "timestamp": "2025-01-15T10:00:03Z",
                    "type": "user",
                    "content": "What about authentication?"
                }
            ]
        });

        std::fs::write(&path, json.to_string()).expect("Failed to write fixture");
        path
    }

    #[test]
    fn should_parse_meta() {
        let dir = TempDir::new().unwrap();
        let path = create_gemini_fixture(&dir, "chat-001.json");
        let adapter = GeminiAdapter;

        let meta = adapter.parse_meta(&path).unwrap();
        assert_eq!(meta.native_session_id, "gemini-session-001");
        assert_eq!(meta.title.as_deref(), Some("API design discussion"));
        assert_eq!(meta.message_count, 3);
        assert!(meta.recent_messages.iter().any(|(_, t)| t.contains("REST API")));
    }

    #[test]
    fn should_parse_messages() {
        let dir = TempDir::new().unwrap();
        let path = create_gemini_fixture(&dir, "chat-001.json");
        let adapter = GeminiAdapter;

        let messages = adapter.parse_messages(&path).unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "Can you help me design a REST API?");
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[1].content, "Sure! Let's start with the endpoints...");
        assert_eq!(messages[2].role, "user");
        assert_eq!(messages[2].content, "What about authentication?");
    }

    #[test]
    fn should_resume_command_return_none() {
        let cmd = GeminiAdapter.resume_command("test-id", "/projects/test");
        assert!(cmd.is_none());
    }

    #[test]
    fn should_handle_empty_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("empty.json");
        std::fs::write(&path, "").expect("Failed to write");

        let result = GeminiAdapter.parse_meta(&path);
        assert!(result.is_err());
    }

    #[test]
    fn should_handle_missing_messages() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("no-msgs.json");
        let json = serde_json::json!({
            "sessionId": "test-id",
            "startTime": "2025-01-15T10:00:00Z"
        });
        std::fs::write(&path, json.to_string()).expect("Failed to write");

        let meta = GeminiAdapter.parse_meta(&path).unwrap();
        assert_eq!(meta.message_count, 0);

        let result = GeminiAdapter.parse_messages(&path);
        assert!(result.is_err());
    }
}
