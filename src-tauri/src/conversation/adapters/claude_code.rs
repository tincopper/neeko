use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::conversation::adapter::{AgentSessionAdapter, ParsedMessage, ParsedMeta};
use crate::conversation::adapters::{
    extract_content_text, linearize_tree_entries, parse_timestamp, read_jsonl, strip_ansi, truncate,
};

/// Claude Code 会话适配器
///
/// 会话格式：`~/.claude/projects/<sanitized-path>/*.jsonl`
/// - 首行 type="summary" 包含标题和时间戳
/// - 后续行为 type="user" / type="assistant"，树状结构通过 parentUuid 关联
/// - 不支持原生 CLI 恢复（仅 TUI 内的 /resume 命令）
pub struct ClaudeCodeAdapter;

impl AgentSessionAdapter for ClaudeCodeAdapter {
    fn agent_id(&self) -> &str {
        "claude-code"
    }

    fn session_root(&self) -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("~"))
            .join(".claude")
            .join("projects")
    }

    fn file_pattern(&self) -> &str {
        "*.jsonl"
    }

    #[allow(clippy::cast_possible_truncation)]
    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
        let entries = read_jsonl(file_path)?;
        let first = entries.first().context("Claude Code session file is empty")?;

        let native_session_id = file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        // 首行 summary 元数据
        let title = first
            .get("conversationTitle")
            .and_then(|v| v.as_str())
            .or_else(|| first.get("title").and_then(|v| v.as_str()))
            .map(|s| s.to_string());

        let started_at = first
            .get("createdAt")
            .or_else(|| first.get("created_at"))
            .or_else(|| first.get("startedAt"))
            .and_then(parse_timestamp)
            .unwrap_or(0);

        let updated_at = first
            .get("updatedAt")
            .or_else(|| first.get("updated_at"))
            .and_then(parse_timestamp)
            .or_else(|| {
                // 取最后一条消息的时间戳
                entries
                    .iter()
                    .rev()
                    .find(|e| {
                        e.get("type").and_then(|v| v.as_str())
                            == Some("assistant")
                            || e.get("type").and_then(|v| v.as_str()) == Some("user")
                    })
                    .and_then(|e| e.get("timestamp").and_then(parse_timestamp))
                    .or_else(|| {
                        entries
                            .last()
                            .and_then(|e| e.get("timestamp").and_then(parse_timestamp))
                    })
            })
            .unwrap_or(started_at);

        // 线性化消息并计数
        let linearized = linearize_tree_entries(
            &entries,
            "uuid",
            "parentUuid",
            "type",
            None,
        );
        let message_count = linearized.len() as u32;

        // 预览：找到第一条 user 消息
        let preview = entries
            .iter()
            .find(|e| {
                e.get("type").and_then(|v| v.as_str()) == Some("user")
            })
            .and_then(|e| {
                e.pointer("/message/content")
                    .map(extract_content_text)
                    .or_else(|| {
                        e.get("message")
                            .and_then(|m| m.get("content"))
                            .map(extract_content_text)
                    })
            })
            .map(|s| truncate(&strip_ansi(&s), 200))
            .unwrap_or_default();

        // 项目路径：从文件路径层级推断（目录名）
        let project_path = file_path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
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

    fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>> {
        let entries = read_jsonl(file_path)?;

        // 线性化树形结构
        let linearized =
            linearize_tree_entries(&entries, "uuid", "parentUuid", "type", None);

        let mut messages = Vec::new();
        for (idx, seq) in &linearized {
            let entry = &entries[*idx];
            let entry_type = entry
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let role = entry_type;

            let content = match entry.pointer("/message/content") {
                Some(content_val) => {
                    if content_val.is_array() {
                        extract_content_text(content_val)
                    } else if let Some(s) = content_val.as_str() {
                        s.to_string()
                    } else {
                        String::new()
                    }
                }
                None => {
                    // 尝试直接取 message 字段的字符串
                    entry
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("")
                        .to_string()
                }
            };

            let cleaned = strip_ansi(&content);
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
                timestamp,
                seq: *seq,
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

    fn create_claude_fixture(dir: &TempDir, name: &str) -> PathBuf {
        let path = dir.path().join(name);
        let mut content = String::new();

        // summary
        content.push_str(
            r#"{"type":"summary","conversationTitle":"Fix auth middleware","createdAt":"2025-01-15T10:00:00Z","updatedAt":"2025-01-15T11:00:00Z"}"#,
        );
        content.push('\n');

        // user (root level)
        content.push_str(
            r#"{"type":"user","uuid":"msg1","parentUuid":"root","timestamp":"2025-01-15T10:00:01Z","message":{"content":[{"type":"text","text":"Can you help me fix the auth middleware?"}]}}"#,
        );
        content.push('\n');

        // assistant
        content.push_str(
            r#"{"type":"assistant","uuid":"msg2","parentUuid":"msg1","timestamp":"2025-01-15T10:00:02Z","message":{"content":[{"type":"text","text":"Sure! Let me look at the auth module."}]}}"#,
        );
        content.push('\n');

        // user reply
        content.push_str(
            r#"{"type":"user","uuid":"msg3","parentUuid":"msg2","timestamp":"2025-01-15T10:00:03Z","message":{"content":[{"type":"text","text":"It's in src/auth/middleware.ts"}]}}"#,
        );
        content.push('\n');

        std::fs::write(&path, content).expect("Failed to write fixture");
        path
    }

    #[test]
    fn should_parse_meta() {
        let dir = TempDir::new().unwrap();
        let path = create_claude_fixture(&dir, "session-123.jsonl");
        let adapter = ClaudeCodeAdapter;

        let meta = adapter.parse_meta(&path).unwrap();
        assert_eq!(meta.native_session_id, "session-123");
        assert_eq!(meta.title.as_deref(), Some("Fix auth middleware"));
        assert_eq!(meta.message_count, 3);
        assert!(meta.preview.contains("auth middleware"));
    }

    #[test]
    fn should_parse_messages() {
        let dir = TempDir::new().unwrap();
        let path = create_claude_fixture(&dir, "session-456.jsonl");
        let adapter = ClaudeCodeAdapter;

        let messages = adapter.parse_messages(&path).unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "Can you help me fix the auth middleware?");
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[1].content, "Sure! Let me look at the auth module.");
        assert_eq!(messages[2].role, "user");
        assert_eq!(messages[2].content, "It's in src/auth/middleware.ts");
    }

    #[test]
    fn should_resume_command_return_none() {
        let cmd = ClaudeCodeAdapter.resume_command("test-id", "/projects/test");
        assert!(cmd.is_none());
    }

    #[test]
    fn should_handle_empty_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("empty.jsonl");
        std::fs::write(&path, "").expect("Failed to write");

        let result = ClaudeCodeAdapter.parse_meta(&path);
        assert!(result.is_err());
    }

    #[test]
    fn should_handle_branching_tree() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("branch.jsonl");
        let mut content = String::new();
        // summary
        content.push_str(
            r#"{"type":"summary","conversationTitle":"Branch test","createdAt":"2025-01-15T10:00:00Z"}"#,
        );
        content.push('\n');
        // user root
        content.push_str(
            r#"{"type":"user","uuid":"msg1","parentUuid":"root","timestamp":"2025-01-15T10:00:01Z","message":{"content":[{"type":"text","text":"First question"}]}}"#,
        );
        content.push('\n');
        // assistant (reply to msg1)
        content.push_str(
            r#"{"type":"assistant","uuid":"msg2","parentUuid":"msg1","timestamp":"2025-01-15T10:00:02Z","message":{"content":[{"type":"text","text":"First answer"}]}}"#,
        );
        content.push('\n');
        // user follow-up (branch A)
        content.push_str(
            r#"{"type":"user","uuid":"msg3","parentUuid":"msg2","timestamp":"2025-01-15T10:00:03Z","message":{"content":[{"type":"text","text":"Follow-up A"}]}}"#,
        );
        content.push('\n');

        std::fs::write(&path, content).expect("Failed to write fixture");

        let messages = ClaudeCodeAdapter.parse_messages(&path).unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].content, "First question");
        assert_eq!(messages[1].content, "First answer");
        assert_eq!(messages[2].content, "Follow-up A");
    }
}
