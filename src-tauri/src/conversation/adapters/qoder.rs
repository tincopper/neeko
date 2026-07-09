use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::conversation::adapter::{AgentSessionAdapter, ParsedMessage, ParsedMeta};
use crate::conversation::adapters::{
    parse_timestamp, read_jsonl, recent_messages_from, strip_ansi,
};

/// Qoder CLI 会话适配器
///
/// 会话格式：`~/.qodercli/projects/<project>/*.jsonl`
/// - JSONL 格式，会话由 UUID 标识
/// - 首行可能包含 session 元数据
/// - 消息行包含 context、tool calls、user/assistant 消息
/// - 不支持原生 CLI 恢复（仅 TUI 内的 /resume 命令）
pub struct QoderAdapter;

impl AgentSessionAdapter for QoderAdapter {
    fn agent_id(&self) -> &str {
        "qoder"
    }

    fn session_root(&self) -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("~"))
            .join(".qodercli")
            .join("projects")
    }

    fn file_pattern(&self) -> &str {
        "*.jsonl"
    }

    #[allow(clippy::cast_possible_truncation)]
    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
        let entries = read_jsonl(file_path)?;
        let first = entries.first().context("Qoder session file is empty")?;

        let native_session_id = first
            .get("sessionId")
            .or_else(|| first.get("session_id"))
            .or_else(|| first.get("id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                file_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string()
            });

        let title = first
            .get("title")
            .or_else(|| first.get("name"))
            .or_else(|| first.get("description"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let started_at = first
            .get("timestamp")
            .or_else(|| first.get("createdAt"))
            .or_else(|| first.get("startedAt"))
            .and_then(parse_timestamp)
            .unwrap_or(0);

        let updated_at = entries
            .last()
            .and_then(|e| e.get("timestamp"))
            .or_else(|| {
                entries
                    .last()
                    .and_then(|e| e.get("time"))
            })
            .and_then(parse_timestamp)
            .unwrap_or(started_at);

        // 消息数：过滤 message/chat 类型的行
        let message_count = entries
            .iter()
            .filter(|e| {
                let entry_type = e
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                entry_type == "message"
                    || entry_type == "chat"
                    || entry_type == "user"
                    || entry_type == "assistant"
                    || e.get("role").is_some()
            })
            .count() as u32;

        // 预览/首条用户消息：第一条用户消息（净化交给 manager）
        let first_user_raw = entries
            .iter()
            .find(|e| {
                e.get("role").and_then(|v| v.as_str()) == Some("user")
                    || e.get("type").and_then(|v| v.as_str()) == Some("user")
            })
            .or_else(|| {
                entries.iter().find(|e| {
                    e.get("type").and_then(|v| v.as_str()) == Some("message")
                        && e.get("role").and_then(|v| v.as_str()) == Some("user")
                })
            })
            .and_then(|e| {
                e.get("content")
                    .and_then(|v| v.as_str())
                    .or_else(|| e.get("text").and_then(|v| v.as_str()))
            })
            .map(|s| s.to_string());

        // 最近消息缓冲（剔除 harness 注入噪声），供 manager 构建预览
        let recent_pairs: Vec<(String, String)> = entries
            .iter()
            .filter_map(|e| {
                let role = e
                    .get("role")
                    .and_then(|v| v.as_str())
                    .or_else(|| e.get("type").and_then(|v| v.as_str()))
                    .unwrap_or("user")
                    .to_string();
                let text = e
                    .get("content")
                    .and_then(|v| v.as_str())
                    .or_else(|| e.get("text").and_then(|v| v.as_str()))?;
                let t = text.trim().to_string();
                if t.is_empty() {
                    return None;
                }
                Some((role, t))
            })
            .collect();
        let recent_messages = recent_messages_from(recent_pairs);

        // 项目路径：从文件路径推断
        let project_path = file_path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
            .map(|s| s.to_string());
 
        Ok(ParsedMeta {
            native_session_id,
            title,
            first_user_message: first_user_raw,
            recent_messages,
            started_at,
            updated_at,
            message_count,
            project_path,
        })
    }

    fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>> {
        let entries = read_jsonl(file_path)?;
        let mut messages: Vec<ParsedMessage> = Vec::new();
        let mut seq = 0u32;

        for entry in &entries {
            let entry_type = entry
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            // 跳过 context/tool 类型的行（这些没有 role）
            if entry_type == "context" || entry_type == "tool_call" || entry_type == "tool_result" {
                continue;
            }

            // 尝试从 role 或 type 确定角色
            let role = match entry
                .get("role")
                .and_then(|v| v.as_str())
            {
                Some(r) => r,
                None => match entry_type {
                    "user" | "chat" => "user",
                    "assistant" | "ai" => "assistant",
                    _ => continue,
                },
            };

            let content = entry
                .get("content")
                .and_then(|v| v.as_str())
                .or_else(|| entry.get("text").and_then(|v| v.as_str()))
                .or_else(|| entry.get("message").and_then(|v| v.as_str()))
                .unwrap_or("");

            let cleaned = strip_ansi(content);
            if cleaned.is_empty() {
                continue;
            }

            let timestamp = entry
                .get("timestamp")
                .or_else(|| entry.get("time"))
                .and_then(parse_timestamp)
                .unwrap_or(0);

            // 去重：如果上一条消息角色相同且时间接近，追加内容
            if let Some(last) = messages.last_mut() {
                if last.role == role
                    && (timestamp == 0 || last.timestamp == timestamp)
                {
                    last.content.push(' ');
                    last.content.push_str(&cleaned);
                    continue;
                }
            }

            messages.push(ParsedMessage {
                role: role.to_string(),
                content: cleaned,
                blocks: Vec::new(),
                timestamp,
                seq,
            });
            seq += 1;
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

    fn create_qoder_fixture(dir: &TempDir, name: &str) -> PathBuf {
        let path = dir.path().join(name);
        let mut content = String::new();

        // session info line
        content.push_str(
            r#"{"type":"session","sessionId":"qoder-session-001","title":"Debug database connection","timestamp":"2025-01-15T10:00:00Z"}"#,
        );
        content.push('\n');

        // user message
        content.push_str(
            r#"{"type":"message","role":"user","content":"I'm having trouble connecting to the database","timestamp":"2025-01-15T10:00:01Z"}"#,
        );
        content.push('\n');

        // assistant message
        content.push_str(
            r#"{"type":"message","role":"assistant","content":"Let me check your database configuration. Is the server running?","timestamp":"2025-01-15T10:00:02Z"}"#,
        );
        content.push('\n');

        // context (should be skipped)
        content.push_str(
            r#"{"type":"context","content":"project context: web app with PostgreSQL","timestamp":"2025-01-15T10:00:00Z"}"#,
        );
        content.push('\n');

        // user follow-up
        content.push_str(
            r#"{"type":"message","role":"user","content":"Yes, it's running but getting connection refused","timestamp":"2025-01-15T10:00:03Z"}"#,
        );
        content.push('\n');

        std::fs::write(&path, content).expect("Failed to write fixture");
        path
    }

    #[test]
    fn should_parse_meta() {
        let dir = TempDir::new().unwrap();
        let path = create_qoder_fixture(&dir, "qoder-session.jsonl");
        let adapter = QoderAdapter;

        let meta = adapter.parse_meta(&path).unwrap();
        assert_eq!(meta.native_session_id, "qoder-session-001");
        assert_eq!(meta.title.as_deref(), Some("Debug database connection"));
        assert_eq!(meta.message_count, 3); // only user/assistant, not context
        assert!(meta.recent_messages.iter().any(|(_, t)| t.contains("database")));
    }

    #[test]
    fn should_parse_messages() {
        let dir = TempDir::new().unwrap();
        let path = create_qoder_fixture(&dir, "qoder-session.jsonl");
        let adapter = QoderAdapter;

        let messages = adapter.parse_messages(&path).unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].role, "user");
        assert!(messages[0].content.contains("database"));
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[2].role, "user");
        assert!(messages[2].content.contains("connection refused"));
    }

    #[test]
    fn should_resume_command_return_none() {
        let cmd = QoderAdapter.resume_command("test-id", "/projects/test");
        assert!(cmd.is_none());
    }

    #[test]
    fn should_handle_empty_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("empty.jsonl");
        std::fs::write(&path, "").expect("Failed to write");

        let result = QoderAdapter.parse_meta(&path);
        assert!(result.is_err());
    }
}
