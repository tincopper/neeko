use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::conversation::adapter::{AgentSessionAdapter, ParsedMessage, ParsedMeta};
use crate::conversation::adapters::{
    linearize_tree_entries, parse_timestamp, read_jsonl, recent_messages_from,
    strip_ansi,
};

/// Pi CLI 会话适配器
///
/// 会话格式：`~/.pi/agent/sessions/<sanitized-path>/*.jsonl`
/// - 首行 type="session" 包含版本、ID、时间戳
/// - 后续行为 type="message" 含 id/parentId 树结构 和 message.role/ content
/// - 不支持原生 CLI 恢复（仅 TUI 内的 /resume 命令）
pub struct PiAdapter;

impl AgentSessionAdapter for PiAdapter {
    fn agent_id(&self) -> &str {
        "pi"
    }

    fn session_root(&self) -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("~"))
            .join(".pi")
            .join("agent")
            .join("sessions")
    }

    fn file_pattern(&self) -> &str {
        "*.jsonl"
    }

    #[allow(clippy::cast_possible_truncation)]
    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
        let entries = read_jsonl(file_path)?;
        let first = entries.first().context("Pi session file is empty")?;

        // 从 session 行提取 session ID
        let native_session_id = first
            .get("id")
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
            .get("name")
            .or_else(|| first.get("title"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let started_at = first
            .get("timestamp")
            .and_then(parse_timestamp)
            .unwrap_or(0);

        let updated_at = entries
            .last()
            .and_then(|e| e.get("timestamp"))
            .and_then(parse_timestamp)
            .unwrap_or(started_at);

        // 消息数
        let message_entries: Vec<&serde_json::Value> = entries
            .iter()
            .filter(|e| {
                e.get("type").and_then(|v| v.as_str()) == Some("message")
            })
            .collect();
        let message_count = message_entries.len() as u32;

        // 首条用户消息（P3 标题候选）
        let first_user_raw = message_entries
            .iter()
            .find(|e| {
                e.pointer("/message/role")
                    .and_then(|v| v.as_str())
                    == Some("user")
            })
            .or_else(|| message_entries.first())
            .and_then(|e| {
                e.pointer("/message/content")
                    .and_then(|v| v.as_str())
                    .or_else(|| e.pointer("/message/text").and_then(|v| v.as_str()))
                    .or_else(|| e.get("content").and_then(|v| v.as_str()))
            })
            .map(|s| s.to_string());

        // 最近消息缓冲（剔除 harness 注入噪声），供 manager 构建预览
        let recent_pairs: Vec<(String, String)> = message_entries
            .iter()
            .filter_map(|e| {
                let role = e
                    .pointer("/message/role")
                    .and_then(|v| v.as_str())
                    .unwrap_or("user")
                    .to_string();
                let text = e
                    .pointer("/message/content")
                    .and_then(|v| v.as_str())
                    .or_else(|| e.pointer("/message/text").and_then(|v| v.as_str()))
                    .or_else(|| e.get("content").and_then(|v| v.as_str()))?;
                let t = text.trim().to_string();
                if t.is_empty() {
                    return None;
                }
                Some((role, t))
            })
            .collect();
        let recent_messages = recent_messages_from(recent_pairs);

        // 项目路径：从 session 行或文件路径
        let project_path = first
            .get("cwd")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                file_path
                    .parent()
                    .and_then(|p| p.file_name())
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string())
            });

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

        // 线性化树形结构
        let linearized =
            linearize_tree_entries(&entries, "id", "parentId", "type", None);

        let mut messages = Vec::new();
        for (idx, seq) in &linearized {
            let entry = &entries[*idx];
            let entry_type = entry
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if entry_type != "message" {
                continue;
            }

            let role = entry
                .pointer("/message/role")
                .and_then(|v| v.as_str())
                .unwrap_or("user");

            let content = entry
                .pointer("/message/content")
                .and_then(|v| v.as_str())
                .or_else(|| {
                    entry
                        .pointer("/message/text")
                        .and_then(|v| v.as_str())
                })
                .or_else(|| entry.get("content").and_then(|v| v.as_str()))
                .unwrap_or("");

            let cleaned = strip_ansi(content);
            if cleaned.is_empty() {
                continue;
            }

            let timestamp = entry
                .get("timestamp")
                .and_then(parse_timestamp)
                .unwrap_or(0);

            messages.push(ParsedMessage {
                role: role.to_string(),
                content: cleaned,
                blocks: Vec::new(),
                timestamp,
                seq: *seq,
            });
        }

        Ok(messages)
    }

    fn extract_session_id(&self, file_path: &Path) -> Option<String> {
        // Pi 的 session ID 在文件内容中
        // 对于扫描快速过滤，通过读取首行提取
        let content = std::fs::read_to_string(file_path).ok()?;
        let first_line = content.lines().next()?;
        let trimmed = first_line.trim();
        if trimmed.is_empty() {
            return None;
        }
        let val: serde_json::Value = serde_json::from_str(trimmed).ok()?;
        val.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())
    }

    fn resume_command(&self, native_session_id: &str, _project_path: &str) -> Option<Vec<String>> {
        Some(vec!["--session".into(), native_session_id.into()])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_pi_fixture(dir: &TempDir, name: &str) -> PathBuf {
        let path = dir.path().join(name);
        let mut content = String::new();

        // session header
        content.push_str(
            r#"{"type":"session","version":3,"id":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2025-01-15T10:00:00Z","cwd":"/projects/test"}"#,
        );
        content.push('\n');

        // message 1 (user)
        content.push_str(
            r#"{"type":"message","id":"msg1","parentId":"root","timestamp":"2025-01-15T10:00:01Z","message":{"role":"user","content":"How do I implement authentication?"}}"#,
        );
        content.push('\n');

        // message 2 (assistant)
        content.push_str(
            r#"{"type":"message","id":"msg2","parentId":"msg1","timestamp":"2025-01-15T10:00:02Z","message":{"role":"assistant","content":"You should use JWT tokens. Here's a basic setup..."}}"#,
        );
        content.push('\n');

        // message 3 (user follow-up)
        content.push_str(
            r#"{"type":"message","id":"msg3","parentId":"msg2","timestamp":"2025-01-15T10:00:03Z","message":{"role":"user","content":"Can you show me the code?"}}"#,
        );
        content.push('\n');

        std::fs::write(&path, content).expect("Failed to write fixture");
        path
    }

    #[test]
    fn should_parse_meta() {
        let dir = TempDir::new().unwrap();
        let path = create_pi_fixture(&dir, "session-pi.jsonl");
        let adapter = PiAdapter;

        let meta = adapter.parse_meta(&path).unwrap();
        assert_eq!(
            meta.native_session_id,
            "550e8400-e29b-41d4-a716-446655440000"
        );
        assert_eq!(meta.message_count, 3);
        assert!(meta.recent_messages.iter().any(|(_, t)| t.contains("authentication")));
        assert_eq!(meta.project_path.as_deref(), Some("/projects/test"));
    }

    #[test]
    fn should_parse_messages() {
        let dir = TempDir::new().unwrap();
        let path = create_pi_fixture(&dir, "session-pi.jsonl");
        let adapter = PiAdapter;

        let messages = adapter.parse_messages(&path).unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "How do I implement authentication?");
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[1].content, "You should use JWT tokens. Here's a basic setup...");
        assert_eq!(messages[2].role, "user");
        assert_eq!(messages[2].content, "Can you show me the code?");
    }

    #[test]
    fn should_extract_session_id() {
        let dir = TempDir::new().unwrap();
        let path = create_pi_fixture(&dir, "session-pi.jsonl");

        let id = PiAdapter.extract_session_id(&path);
        assert_eq!(
            id,
            Some("550e8400-e29b-41d4-a716-446655440000".to_string())
        );
    }

    #[test]
    fn should_return_resume_command() {
        let cmd = PiAdapter.resume_command("test-session-id", "/projects/test");
        assert_eq!(cmd, Some(vec!["--session".to_string(), "test-session-id".to_string()]));
    }

    #[test]
    fn should_handle_empty_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("empty.jsonl");
        std::fs::write(&path, "").expect("Failed to write");

        let result = PiAdapter.parse_meta(&path);
        assert!(result.is_err());
    }
}
