use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use regex::Regex;

use crate::conversation::adapter::{AgentSessionAdapter, ParsedMessage, ParsedMeta};
use crate::conversation::adapters::{
    parse_timestamp, read_jsonl, recent_messages_from, strip_ansi,
};

/// Codex CLI 会话适配器
///
/// 会话格式：`~/.codex/sessions/YYYY/MM/DD/rollout-YYYY-MM-DDThh-mm-ss-<uuid>.jsonl`
/// - 首行 type="session_meta" 包含标题和开始时间
/// - type="turn_context" 包含用户输入（transcript 字段）
/// - type="response_item" 中 payload.type="message" 包含助手回复（delta 字段）
/// - 支持原生恢复：`codex resume <SESSION_ID>`
pub struct CodexAdapter;

impl AgentSessionAdapter for CodexAdapter {
    fn agent_id(&self) -> &str {
        "codex"
    }

    fn session_root(&self) -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("~"))
            .join(".codex")
            .join("sessions")
    }

    fn file_pattern(&self) -> &str {
        "rollout-*.jsonl"
    }

    #[allow(clippy::cast_possible_truncation)]
    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
        let entries = read_jsonl(file_path)?;
        let first = entries.first().context("Codex session file is empty")?;

        // 从文件名提取 UUID 作为原生会话 ID
        let native_session_id = extract_codex_session_id_from_filename(file_path)
            .unwrap_or_else(|| {
                file_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string()
            });

        // 首行 session_meta
        let title = first
            .pointer("/payload/title")
            .or_else(|| first.pointer("/title"))
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

        // 消息数 = turn_context + response_item 条数
        let message_count = entries
            .iter()
            .filter(|e| {
                e.get("type")
                    .and_then(|v| v.as_str())
                    .is_some_and(|t| t == "turn_context" || t == "response_item")
            })
            .count() as u32;

        // 预览/首条用户消息：第一条 turn_context 的 transcript（净化交给 manager）
        let first_user_raw = entries
            .iter()
            .find(|e| {
                e.get("type").and_then(|v| v.as_str()) == Some("turn_context")
            })
            .and_then(|e| {
                e.pointer("/payload/transcript")
                    .and_then(|v| v.as_str())
                    .or_else(|| e.get("transcript").and_then(|v| v.as_str()))
            })
            .map(|s| s.to_string());

        let recent_pairs: Vec<(String, String)> = entries
            .iter()
            .filter_map(|e| {
                let t = e
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let (role, text) = match t {
                    "turn_context" => (
                        "user",
                        e.pointer("/payload/transcript")
                            .and_then(|v| v.as_str())
                            .or_else(|| e.get("transcript").and_then(|v| v.as_str())),
                    ),
                    "response_item" => (
                        "assistant",
                        e.pointer("/payload/content")
                            .and_then(|v| v.as_str())
                            .or_else(|| e.get("content").and_then(|v| v.as_str()))
                    ),
                    _ => return None,
                };
                let t = text?.trim().to_string();
                if t.is_empty() {
                    return None;
                }
                Some((role.to_string(), t))
            })
            .collect();
        let recent_messages = recent_messages_from(recent_pairs);

        let project_path = first
            .pointer("/payload/cwd")
            .or_else(|| first.pointer("/cwd"))
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

    fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>> {
        let entries = read_jsonl(file_path)?;
        let mut messages = Vec::new();
        let mut seq = 0u32;

        for entry in &entries {
            let entry_type = entry
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            match entry_type {
                "turn_context" => {
                    // 用户消息
                    let content = entry
                        .pointer("/payload/transcript")
                        .or_else(|| entry.get("transcript"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let timestamp = entry
                        .get("timestamp")
                        .and_then(parse_timestamp)
                        .unwrap_or(0);
                    let cleaned = strip_ansi(content);

                    if !cleaned.is_empty() {
                        messages.push(ParsedMessage {
                            role: "user".to_string(),
                            content: cleaned,
                            blocks: Vec::new(),
                            model: None,
                            timestamp,
                            seq,
                        });
                        seq += 1;
                    }
                }
                "response_item" => {
                    // 助手回复（可能包含多个 delta 片段）
                    let payload_type = entry
                        .pointer("/payload/type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");

                    if payload_type == "message" {
                        let delta = entry
                            .pointer("/payload/delta")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let timestamp = entry
                            .get("timestamp")
                            .and_then(parse_timestamp)
                            .unwrap_or(0);
                        let cleaned = strip_ansi(delta);

                        if !cleaned.is_empty() {
                            messages.push(ParsedMessage {
                                role: "assistant".to_string(),
                                content: cleaned,
                                blocks: Vec::new(),
                                model: None,
                                timestamp,
                                seq,
                            });
                            seq += 1;
                        }
                    }
                }
                _ => {}
            }
        }

        Ok(messages)
    }

    fn extract_session_id(&self, file_path: &Path) -> Option<String> {
        extract_codex_session_id_from_filename(file_path)
    }

    fn resume_command(&self, native_session_id: &str, _project_path: &str) -> Option<Vec<String>> {
        Some(vec![
            "resume".to_string(),
            native_session_id.to_string(),
        ])
    }
}

/// 从 Codex 文件名中提取 UUID
///
/// 文件名格式：`rollout-YYYY-MM-DDThh-mm-ss-<uuid>.jsonl`
fn extract_codex_session_id_from_filename(path: &Path) -> Option<String> {
    let file_name = path.file_name()?.to_str()?;
    // Match pattern: rollout-YYYY-MM-DDThh-mm-ss-<uuid>.jsonl
    // UUID is the last segment before .jsonl
    let re = Regex::new(r"^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([a-f0-9-]+)\.jsonl$")
        .ok()?;
    let caps = re.captures(file_name)?;
    Some(caps.get(1)?.as_str().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_codex_fixture(dir: &TempDir, name: &str) -> PathBuf {
        let path = dir.path().join(name);
        let mut content = String::new();

        // session_meta
        content.push_str(
            r#"{"type":"session_meta","timestamp":"2025-01-15T10:00:00Z","payload":{"title":"Fix login bug","cwd":"/projects/test","started_at":"2025-01-15T10:00:00Z"}}"#,
        );
        content.push('\n');

        // turn_context (user)
        content.push_str(
            r#"{"type":"turn_context","timestamp":"2025-01-15T10:00:01Z","payload":{"transcript":"Can you help me fix the login issue?"}}"#,
        );
        content.push('\n');

        // response_item (assistant)
        content.push_str(
            r#"{"type":"response_item","timestamp":"2025-01-15T10:00:02Z","payload":{"type":"message","delta":"I see the issue. The auth token validation is missing a null check."}}"#,
        );
        content.push('\n');

        // turn_context (user)
        content.push_str(
            r#"{"type":"turn_context","timestamp":"2025-01-15T10:00:03Z","payload":{"transcript":"Where should I add it?"}}"#,
        );
        content.push('\n');

        // response_item (assistant)
        content.push_str(
            r#"{"type":"response_item","timestamp":"2025-01-15T10:00:04Z","payload":{"type":"message","delta":"In the middleware file, around line 45."}}"#,
        );
        content.push('\n');

        std::fs::write(&path, content).expect("Failed to write fixture");
        path
    }

    #[test]
    fn should_parse_meta() {
        let dir = TempDir::new().unwrap();
        let path = create_codex_fixture(&dir, "rollout-2025-01-15T10-00-00-123e4567-e89b-12d3-a456-426614174000.jsonl");
        let adapter = CodexAdapter;

        let meta = adapter.parse_meta(&path).unwrap();
        assert_eq!(meta.native_session_id, "123e4567-e89b-12d3-a456-426614174000");
        assert_eq!(meta.title.as_deref(), Some("Fix login bug"));
        assert_eq!(meta.message_count, 4);
        assert!(meta.recent_messages.iter().any(|(_, t)| t.contains("login")));
        assert_eq!(meta.project_path.as_deref(), Some("/projects/test"));
    }

    #[test]
    fn should_parse_messages() {
        let dir = TempDir::new().unwrap();
        let path = create_codex_fixture(&dir, "rollout-2025-01-15T10-00-00-test-uuid.jsonl");
        let adapter = CodexAdapter;

        let messages = adapter.parse_messages(&path).unwrap();
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "Can you help me fix the login issue?");
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[1].content, "I see the issue. The auth token validation is missing a null check.");
        assert_eq!(messages[2].role, "user");
        assert_eq!(messages[2].content, "Where should I add it?");
        assert_eq!(messages[3].role, "assistant");
        assert_eq!(messages[3].content, "In the middleware file, around line 45.");
        assert_eq!(messages[3].seq, 3);
    }

    #[test]
    fn should_extract_session_id() {
        let path = Path::new("rollout-2025-01-15T10-00-00-123e4567-e89b-12d3-a456-426614174000.jsonl");
        let id = CodexAdapter.extract_session_id(path);
        assert_eq!(id, Some("123e4567-e89b-12d3-a456-426614174000".to_string()));
    }

    #[test]
    fn should_extract_session_id_none_for_non_matching() {
        let path = Path::new("other-file.jsonl");
        let id = CodexAdapter.extract_session_id(path);
        assert!(id.is_none());
    }

    #[test]
    fn should_return_resume_command() {
        let cmd = CodexAdapter.resume_command("test-uuid", "/projects/test");
        assert_eq!(cmd, Some(vec!["resume".to_string(), "test-uuid".to_string()]));
    }

    #[test]
    fn should_handle_empty_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("rollout-empty.jsonl");
        std::fs::write(&path, "").expect("Failed to write");

        let result = CodexAdapter.parse_meta(&path);
        assert!(result.is_err());
    }
}
