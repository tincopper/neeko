//! Grok CLI session adapter.
//!
//! Layout: `~/.grok/sessions/<url-encoded-cwd>/<uuid>/`
//! - `summary.json` — list metadata
//! - `updates.jsonl` — streaming session updates (chunked messages)

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

use crate::conversation::adapter::{AgentSessionAdapter, ParsedMessage, ParsedMeta};
use crate::conversation::adapters::{parse_timestamp, read_jsonl, recent_messages_from, strip_ansi};
use crate::conversation::types::MessageBlock;

/// Grok CLI session adapter.
pub struct GrokAdapter;

fn session_dir_from_summary(summary_path: &Path) -> PathBuf {
    summary_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| summary_path.to_path_buf())
}

fn updates_path(summary_path: &Path) -> PathBuf {
    session_dir_from_summary(summary_path).join("updates.jsonl")
}

fn content_text(content: &serde_json::Value) -> Option<String> {
    match content {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Object(map) => {
            if let Some(t) = map.get("text").and_then(|v| v.as_str()) {
                return Some(t.to_string());
            }
            if let Some(t) = map.get("type").and_then(|v| v.as_str()) {
                if t == "text" {
                    return map.get("text").and_then(|v| v.as_str()).map(|s| s.to_string());
                }
            }
            None
        }
        _ => None,
    }
}

/// Collapse chunked `user_message_chunk` / `agent_message_chunk` streams into full messages.
fn messages_from_updates(entries: &[serde_json::Value]) -> Vec<ParsedMessage> {
    let mut messages = Vec::new();
    let mut cur_role: Option<String> = None;
    let mut cur_buf = String::new();
    let mut cur_ts: i64 = 0;
    let mut seq = 0u32;

    let flush = |role: &mut Option<String>,
                 buf: &mut String,
                 ts: &mut i64,
                 seq: &mut u32,
                 out: &mut Vec<ParsedMessage>| {
        if let Some(r) = role.take() {
            let text = strip_ansi(buf.trim());
            buf.clear();
            if text.is_empty() {
                return;
            }
            out.push(ParsedMessage {
                role: r,
                content: text.clone(),
                blocks: vec![MessageBlock::Text { text }],
                model: None,
                timestamp: *ts,
                seq: *seq,
            });
            *seq = seq.saturating_add(1);
            *ts = 0;
        }
    };

    for entry in entries {
        let ts = entry
            .get("timestamp")
            .and_then(parse_timestamp)
            .unwrap_or(0);
        let update = entry
            .pointer("/params/update")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let kind = update
            .get("sessionUpdate")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let (role, piece) = match kind {
            "user_message_chunk" => (
                "user",
                update.get("content").and_then(content_text).unwrap_or_default(),
            ),
            "agent_message_chunk" => (
                "assistant",
                update.get("content").and_then(content_text).unwrap_or_default(),
            ),
            "agent_thought_chunk" => {
                // thinking is not a separate chat turn for list; skip for message list simplicity
                continue;
            }
            _ => {
                // boundary on non-chunk updates
                flush(&mut cur_role, &mut cur_buf, &mut cur_ts, &mut seq, &mut messages);
                continue;
            }
        };

        if piece.is_empty() {
            continue;
        }

        match &cur_role {
            Some(r) if r == role => {
                cur_buf.push_str(&piece);
                if cur_ts == 0 {
                    cur_ts = ts;
                }
            }
            Some(_) => {
                flush(&mut cur_role, &mut cur_buf, &mut cur_ts, &mut seq, &mut messages);
                cur_role = Some(role.to_string());
                cur_buf = piece;
                cur_ts = ts;
            }
            None => {
                cur_role = Some(role.to_string());
                cur_buf = piece;
                cur_ts = ts;
            }
        }
    }
    flush(
        &mut cur_role,
        &mut cur_buf,
        &mut cur_ts,
        &mut seq,
        &mut messages,
    );
    messages
}

impl AgentSessionAdapter for GrokAdapter {
    fn agent_id(&self) -> &str {
        "grok"
    }

    fn session_root(&self) -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("~"))
            .join(".grok")
            .join("sessions")
    }

    fn file_pattern(&self) -> &str {
        "**/summary.json"
    }

    #[allow(clippy::cast_possible_truncation)]
    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
        if file_path.file_name().and_then(|s| s.to_str()) != Some("summary.json") {
            bail!("Grok: expected summary.json, got {}", file_path.display());
        }

        let content = std::fs::read_to_string(file_path)
            .with_context(|| format!("read {}", file_path.display()))?;
        let root: serde_json::Value = serde_json::from_str(&content).context("parse summary.json")?;

        let info = root.get("info").cloned().unwrap_or(serde_json::Value::Null);
        let native_session_id = info
            .get("id")
            .and_then(|v| v.as_str())
            .or_else(|| {
                file_path
                    .parent()
                    .and_then(|p| p.file_name())
                    .and_then(|s| s.to_str())
            })
            .unwrap_or("unknown")
            .to_string();

        let project_path = info
            .get("cwd")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let title = root
            .get("session_summary")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let started_at = root
            .get("created_at")
            .and_then(parse_timestamp)
            .unwrap_or(0);
        let updated_at = root
            .get("updated_at")
            .and_then(parse_timestamp)
            .unwrap_or(started_at);

        let message_count = root
            .get("num_chat_messages")
            .or_else(|| root.get("num_messages"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;

        let model = root
            .get("current_model_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Lightweight recent preview from updates if present
        let mut recent_messages = Vec::new();
        let mut first_user_message = None;
        let updates = updates_path(file_path);
        if updates.is_file() {
            if let Ok(entries) = read_jsonl(&updates) {
                let msgs = messages_from_updates(&entries);
                first_user_message = msgs
                    .iter()
                    .find(|m| m.role == "user")
                    .map(|m| m.content.clone());
                recent_messages = recent_messages_from(
                    msgs.into_iter()
                        .map(|m| (m.role, m.content))
                        .collect(),
                );
            }
        }

        Ok(ParsedMeta {
            native_session_id,
            title,
            first_user_message,
            recent_messages,
            model,
            started_at,
            updated_at,
            message_count,
            project_path,
        })
    }

    fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>> {
        // Accept either summary.json or updates.jsonl as entry
        let updates = if file_path.file_name().and_then(|s| s.to_str()) == Some("summary.json") {
            updates_path(file_path)
        } else if file_path.file_name().and_then(|s| s.to_str()) == Some("updates.jsonl") {
            file_path.to_path_buf()
        } else {
            session_dir_from_summary(file_path).join("updates.jsonl")
        };

        if !updates.is_file() {
            return Ok(Vec::new());
        }
        let entries = read_jsonl(&updates)?;
        Ok(messages_from_updates(&entries))
    }

    fn extract_session_id(&self, file_path: &Path) -> Option<String> {
        if file_path.file_name().and_then(|s| s.to_str()) == Some("summary.json") {
            return file_path
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|s| s.to_str())
                .map(|s| s.to_string());
        }
        file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
    }

    fn resume_command(&self, native_session_id: &str, _project_path: &str) -> Option<Vec<String>> {
        Some(vec!["--resume".into(), native_session_id.into()])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_grok_session(root: &Path) -> PathBuf {
        let dir = root
            .join("%2FUsers%2Ftomgs%2Fproject")
            .join("019f84cb-139c-7c02-a22d-a8cfb1680484");
        std::fs::create_dir_all(&dir).unwrap();
        let summary = dir.join("summary.json");
        std::fs::write(
            &summary,
            r#"{
  "info": {
    "id": "019f84cb-139c-7c02-a22d-a8cfb1680484",
    "cwd": "/Users/tomgs/project"
  },
  "session_summary": "Agent Skills UI Redesign",
  "created_at": "2026-07-21T13:08:49.257458Z",
  "updated_at": "2026-07-22T08:26:28.254724Z",
  "num_messages": 10,
  "num_chat_messages": 4,
  "current_model_id": "grok-4.5"
}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("updates.jsonl"),
            r#"{"timestamp":1784639329,"method":"session/update","params":{"update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"Hello "}}}}
{"timestamp":1784639330,"method":"session/update","params":{"update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"world"}}}}
{"timestamp":1784639331,"method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Hi there"}}}}
{"timestamp":1784639332,"method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"t1"}}}
"#,
        )
        .unwrap();
        summary
    }

    #[test]
    fn should_parse_meta_from_summary() {
        let dir = TempDir::new().unwrap();
        let summary = write_grok_session(dir.path());
        let meta = GrokAdapter.parse_meta(&summary).unwrap();
        assert_eq!(meta.native_session_id, "019f84cb-139c-7c02-a22d-a8cfb1680484");
        assert_eq!(meta.title.as_deref(), Some("Agent Skills UI Redesign"));
        assert_eq!(meta.project_path.as_deref(), Some("/Users/tomgs/project"));
        assert_eq!(meta.message_count, 4);
        assert_eq!(meta.model.as_deref(), Some("grok-4.5"));
    }

    #[test]
    fn should_collapse_message_chunks() {
        let dir = TempDir::new().unwrap();
        let summary = write_grok_session(dir.path());
        let messages = GrokAdapter.parse_messages(&summary).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "Hello world");
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[1].content, "Hi there");
    }

    #[test]
    fn should_return_resume_args() {
        assert_eq!(
            GrokAdapter.resume_command("abc", "/p"),
            Some(vec!["--resume".into(), "abc".into()])
        );
    }

    #[test]
    fn should_scan_nested_summary_via_manager() {
        use crate::conversation::manager::ConversationManager;

        let dir = TempDir::new().unwrap();
        write_grok_session(dir.path());

        struct RootGrok {
            root: PathBuf,
        }
        impl AgentSessionAdapter for RootGrok {
            fn agent_id(&self) -> &str {
                "grok"
            }
            fn session_root(&self) -> PathBuf {
                self.root.clone()
            }
            fn file_pattern(&self) -> &str {
                GrokAdapter.file_pattern()
            }
            fn parse_meta(&self, p: &Path) -> Result<ParsedMeta> {
                GrokAdapter.parse_meta(p)
            }
            fn parse_messages(&self, p: &Path) -> Result<Vec<ParsedMessage>> {
                GrokAdapter.parse_messages(p)
            }
            fn extract_session_id(&self, p: &Path) -> Option<String> {
                GrokAdapter.extract_session_id(p)
            }
            fn resume_command(&self, id: &str, pp: &str) -> Option<Vec<String>> {
                GrokAdapter.resume_command(id, pp)
            }
        }

        let manager = ConversationManager::new(vec![Box::new(RootGrok {
            root: dir.path().to_path_buf(),
        })]);
        let reports = manager.scan_all(None).unwrap();
        assert_eq!(reports[0].sessions_found, 1);
        let list = manager.list(Some("/Users/tomgs/project"), None).unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].supports_resume);
    }
}
