//! Reasonix session adapter.
//!
//! Layout: `~/.reasonix/projects/<sanitized-cwd>/sessions/<id>.jsonl`
//! Companion: `<id>.jsonl.meta`, `<id>.events.jsonl` (full history log)
//!
//! **Full transcript source:** For multi-turn sessions the main `*.jsonl` is often
//! only a stub (system + first user + first assistant tool call). The complete
//! message list lives in sibling `*.events.jsonl` as `replace` / `append` ops.
//! `parse_messages` prefers reconstructing from events when present and richer.
//!
//! Main-session filter (D3): only primary `.jsonl` transcripts for listing.
//! Excludes: `*recovery*`, `*.events.jsonl` as scan hits, indexes, goal-state,
//! ckpt dirs, subagents.
//!
//! Resume (official CLI docs + local v1.17.11):
//! - `reasonix --continue` — latest session
//! - `reasonix --resume` — interactive picker (needs TTY)
//! - `reasonix --resume <session-id|path|unique-title-substring>` — resume that session
//!   (needs interactive TTY; Neeko PTY provides this)
//! - `reasonix run --resume PATH "task"` — one-shot non-interactive run on a session file
//!
//! History panel Resume uses the **interactive** form so the user continues the TUI
//! session, not a one-shot `run` task.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

use crate::conversation::adapter::{AgentSessionAdapter, ParsedMessage, ParsedMeta};
use crate::conversation::adapters::{parse_timestamp, read_jsonl, recent_messages_from, strip_ansi};
use crate::conversation::types::MessageBlock;

/// Reasonix CLI session adapter.
pub struct ReasonixAdapter;

/// Whether this path is a main session transcript under a project sessions dir.
pub(crate) fn is_main_reasonix_session(file_path: &Path) -> bool {
    let name = match file_path.file_name().and_then(|s| s.to_str()) {
        Some(n) => n,
        None => return false,
    };
    if !name.ends_with(".jsonl") {
        return false;
    }
    // Exclude noise suffixes / keywords
    if name.contains("recovery")
        || name.ends_with(".events.jsonl")
        || name.ends_with(".conflicts.jsonl")
        || name.ends_with(".event-index.json")
    {
        return false;
    }
    // Must live under .../sessions/ and not under .../sessions/subagents/
    let comps: Vec<&str> = file_path
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect();
    if comps
        .windows(2)
        .any(|w| w[0] == "sessions" && w[1] == "subagents")
    {
        return false;
    }
    comps.iter().any(|c| *c == "sessions")
}

/// Best-effort reverse of path sanitization (`/` → `-`, leading `/` dropped).
fn unsanitize_project_dir(name: &str) -> Option<String> {
    if name.is_empty() {
        return None;
    }
    // Common pattern: `-Users-tomgs-RustroverProjects-neeko` → `/Users/tomgs/...`
    if name.starts_with('-') {
        let restored = name.replacen('-', "/", 1).replace('-', "/");
        // Over-replaces hyphens inside folder names; acceptable best-effort for filter/display.
        return Some(restored);
    }
    Some(name.replace('-', "/"))
}

fn project_path_from_file(file_path: &Path) -> Option<String> {
    // .../projects/<sanitized>/sessions/<file>
    let mut comps: Vec<&std::ffi::OsStr> = file_path.iter().collect();
    while let Some(last) = comps.last() {
        if *last == "sessions" {
            comps.pop();
            break;
        }
        comps.pop();
    }
    let sanitized = comps.last()?.to_str()?;
    unsanitize_project_dir(sanitized)
}

fn meta_path_for(jsonl: &Path) -> PathBuf {
    let mut p = jsonl.as_os_str().to_os_string();
    p.push(".meta");
    PathBuf::from(p)
}

/// Sibling event log: `foo.jsonl` → `foo.events.jsonl` (not `foo.jsonl.events`).
fn events_path_for(jsonl: &Path) -> PathBuf {
    let stem = jsonl
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("session");
    jsonl
        .parent()
        .map(|p| p.join(format!("{stem}.events.jsonl")))
        .unwrap_or_else(|| PathBuf::from(format!("{stem}.events.jsonl")))
}

/// Rebuild full message list from Reasonix event log (`replace` + `append`).
///
/// Returns `None` if the events file is missing, empty, or yields fewer useful
/// chat rows than the main transcript (fallback to main jsonl).
fn load_messages_from_events(jsonl: &Path) -> Option<Vec<serde_json::Value>> {
    let events_path = events_path_for(jsonl);
    if !events_path.is_file() {
        return None;
    }
    let entries = read_jsonl(&events_path).ok()?;
    if entries.is_empty() {
        return None;
    }

    let mut messages: Vec<serde_json::Value> = Vec::new();
    for entry in entries {
        let op = entry.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match op {
            "replace" => {
                if let Some(arr) = entry.get("messages").and_then(|v| v.as_array()) {
                    messages = arr.clone();
                }
            }
            "append" => {
                if let Some(arr) = entry.get("messages").and_then(|v| v.as_array()) {
                    messages.extend(arr.iter().cloned());
                }
            }
            _ => {}
        }
    }

    if messages.is_empty() {
        return None;
    }
    Some(messages)
}

/// Count user/assistant/tool rows that would produce UI content.
fn chat_entry_weight(entries: &[serde_json::Value]) -> usize {
    entries
        .iter()
        .filter(|e| {
            matches!(
                e.get("role").and_then(|v| v.as_str()),
                Some("user") | Some("assistant") | Some("tool")
            )
        })
        .count()
}

/// Choose the richest message source: events log when it has more chat rows.
fn load_transcript_entries(jsonl: &Path) -> Result<Vec<serde_json::Value>> {
    let main = read_jsonl(jsonl).unwrap_or_default();
    let main_w = chat_entry_weight(&main);
    if let Some(from_events) = load_messages_from_events(jsonl) {
        let ev_w = chat_entry_weight(&from_events);
        // Prefer events when strictly richer (typical multi-turn sessions).
        if ev_w > main_w {
            return Ok(from_events);
        }
    }
    Ok(main)
}

fn content_as_text(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(arr) => {
            let mut out = String::new();
            for part in arr {
                if let Some(t) = part.get("text").and_then(|v| v.as_str()) {
                    if !out.is_empty() {
                        out.push('\n');
                    }
                    out.push_str(t);
                } else if let Some(s) = part.as_str() {
                    if !out.is_empty() {
                        out.push('\n');
                    }
                    out.push_str(s);
                }
            }
            out
        }
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Strip Reasonix harness wrappers from the first user message so the UI shows the real ask.
///
/// Real sessions often wrap the human prompt after blocks like:
/// `<reasoning-language>…</reasoning-language>`, `<response-language>…`, `[Plan mode …]`.
fn extract_human_user_prompt(raw: &str) -> String {
    let s = raw.trim();
    if s.is_empty() {
        return String::new();
    }

    // Prefer text after the last closing harness tag / plan-mode bracket block.
    let markers = [
        "</response-language>",
        "</reasoning-language>",
        "</capability-route>",
        "[Plan mode",
    ];
    let mut cut = 0usize;
    for m in markers {
        if let Some(idx) = s.rfind(m) {
            let after = idx + m.len();
            // For "[Plan mode …]" skip to matching closing `]`
            let after = if m.starts_with('[') {
                s[after..]
                    .find(']')
                    .map(|j| after + j + 1)
                    .unwrap_or(after)
            } else {
                after
            };
            if after > cut {
                cut = after;
            }
        }
    }

    let candidate = s[cut..].trim();
    if candidate.len() >= 8 {
        return candidate.to_string();
    }
    // Fallback: last non-empty paragraph
    s.rsplit("\n\n")
        .map(str::trim)
        .find(|p| p.len() >= 8 && !p.starts_with('<') && !p.starts_with('['))
        .unwrap_or(s)
        .to_string()
}

fn parse_tool_arguments(args: &serde_json::Value) -> serde_json::Value {
    match args {
        serde_json::Value::String(s) => serde_json::from_str(s).unwrap_or_else(|_| args.clone()),
        other => other.clone(),
    }
}

impl AgentSessionAdapter for ReasonixAdapter {
    fn agent_id(&self) -> &str {
        "reasonix"
    }

    fn session_root(&self) -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("~"))
            .join(".reasonix")
            .join("projects")
    }

    fn discovery_roots(
        &self,
        project_path: Option<&str>,
    ) -> Option<Vec<std::path::PathBuf>> {
        crate::conversation::scope::discovery_roots_for(
            self.session_root(),
            project_path,
            crate::conversation::scope::EncodeStyle::Claude,
        )
    }

    fn file_pattern(&self) -> &str {
        // Nested under projects/<sanitized>/sessions/
        "**/sessions/*.jsonl"
    }

    #[allow(clippy::cast_possible_truncation)]
    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
        if !is_main_reasonix_session(file_path) {
            bail!("skip: Reasonix non-main session {}", file_path.display());
        }

        let stem = file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        let mut title: Option<String> = None;
        let mut started_at: i64 = 0;
        let mut updated_at: i64 = 0;
        let mut model: Option<String> = None;
        let mut message_count: u32 = 0;
        let mut native_session_id = stem.clone();

        let meta_file = meta_path_for(file_path);
        if meta_file.is_file() {
            let raw = std::fs::read_to_string(&meta_file).context("read jsonl.meta")?;
            if let Ok(m) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(id) = m.get("id").and_then(|v| v.as_str()) {
                    native_session_id = id.to_string();
                }
                started_at = m.get("created_at").and_then(parse_timestamp).unwrap_or(0);
                updated_at = m
                    .get("updated_at")
                    .and_then(parse_timestamp)
                    .unwrap_or(started_at);
                model = m
                    .get("model")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                title = m
                    .get("preview")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
                message_count = m.get("turns").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            }
        }

        // Prefer events-backed transcript when richer than the main stub jsonl.
        let entries = load_transcript_entries(file_path).unwrap_or_default();
        let derived_count = chat_entry_weight(&entries) as u32;
        // meta.turns is often under-counted vs full event log — take the max.
        message_count = message_count.max(derived_count);

        let first_user_raw = entries
            .iter()
            .find(|e| e.get("role").and_then(|v| v.as_str()) == Some("user"))
            .map(|e| content_as_text(e.get("content").unwrap_or(&serde_json::Value::Null)))
            .filter(|s| !s.trim().is_empty())
            .map(|s| extract_human_user_prompt(&s));

        if title.is_none() {
            title = first_user_raw
                .as_ref()
                .map(|s| s.chars().take(80).collect());
        }

        if started_at == 0 {
            if let Ok(meta) = std::fs::metadata(file_path) {
                if let Ok(created) = meta.created() {
                    if let Ok(d) = created.duration_since(std::time::UNIX_EPOCH) {
                        started_at = d.as_millis() as i64;
                    }
                }
                if let Ok(modified) = meta.modified() {
                    if let Ok(d) = modified.duration_since(std::time::UNIX_EPOCH) {
                        updated_at = d.as_millis() as i64;
                    }
                }
            }
        }
        if updated_at == 0 {
            updated_at = started_at;
        }

        if model.is_none() {
            if let Some(pos) = stem.find("-deepseek") {
                model = Some(stem[pos + 1..].to_string());
            } else {
                let parts: Vec<&str> = stem.split('-').collect();
                if parts.len() >= 3 {
                    model = Some(parts[2..].join("-"));
                }
            }
        }

        // Preview: prefer human-facing user/assistant text (not tool-only rows)
        let mut recent_pairs: Vec<(String, String)> = Vec::new();
        if let Some(ref u) = first_user_raw {
            recent_pairs.push(("user".to_string(), u.clone()));
        }
        for e in &entries {
            let role = e.get("role").and_then(|v| v.as_str()).unwrap_or("");
            if role != "assistant" {
                continue;
            }
            let text = content_as_text(e.get("content").unwrap_or(&serde_json::Value::Null));
            let t = text.trim().to_string();
            if t.is_empty() {
                continue;
            }
            recent_pairs.push(("assistant".to_string(), t));
        }
        let recent_messages = recent_messages_from(recent_pairs);

        Ok(ParsedMeta {
            native_session_id,
            title,
            first_user_message: first_user_raw,
            recent_messages,
            model,
            started_at,
            updated_at,
            message_count,
            project_path: project_path_from_file(file_path),
        })
    }

    fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>> {
        if !is_main_reasonix_session(file_path) {
            bail!("skip: Reasonix not a main session file");
        }
        // Multi-turn history is usually in sibling `*.events.jsonl` (replace/append).
        let entries = load_transcript_entries(file_path)?;
        let mut messages = Vec::new();
        let mut seq = 0u32;
        let mut first_user_done = false;

        for entry in entries {
            let role = entry
                .get("role")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            match role.as_str() {
                "system" => continue,
                "user" => {
                    let content_val =
                        entry.get("content").cloned().unwrap_or(serde_json::Value::Null);
                    let raw = content_as_text(&content_val);
                    let text = if first_user_done {
                        strip_ansi(raw.trim())
                    } else {
                        first_user_done = true;
                        strip_ansi(extract_human_user_prompt(&raw).trim())
                    };
                    if text.is_empty() {
                        continue;
                    }
                    messages.push(ParsedMessage {
                        role: "user".to_string(),
                        content: text.clone(),
                        blocks: vec![MessageBlock::Text { text }],
                        model: None,
                        timestamp: 0,
                        seq,
                    });
                    seq = seq.saturating_add(1);
                }
                "assistant" => {
                    let mut blocks = Vec::new();
                    let content_val =
                        entry.get("content").cloned().unwrap_or(serde_json::Value::Null);
                    let text = strip_ansi(content_as_text(&content_val).trim());
                    if !text.is_empty() {
                        blocks.push(MessageBlock::Text { text: text.clone() });
                    }
                    if let Some(rc) = entry.get("reasoning_content").and_then(|v| v.as_str()) {
                        let t = strip_ansi(rc.trim());
                        if !t.is_empty() {
                            blocks.push(MessageBlock::Thinking { thinking: t });
                        }
                    }
                    if let Some(calls) = entry.get("tool_calls").and_then(|v| v.as_array()) {
                        for (i, call) in calls.iter().enumerate() {
                            let id = call
                                .get("id")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| format!("call-{i}"));
                            // Real Reasonix: {id, name, arguments} (not OpenAI nested function)
                            let name = call
                                .get("name")
                                .or_else(|| call.pointer("/function/name"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("tool")
                                .to_string();
                            let input = call
                                .get("arguments")
                                .cloned()
                                .or_else(|| call.pointer("/function/arguments").cloned())
                                .or_else(|| call.get("input").cloned())
                                .unwrap_or(serde_json::Value::Null);
                            let input = parse_tool_arguments(&input);
                            blocks.push(MessageBlock::ToolUse { id, name, input });
                        }
                    }
                    if blocks.is_empty() {
                        continue;
                    }
                    let content = if text.is_empty() {
                        blocks
                            .iter()
                            .filter_map(|b| match b {
                                MessageBlock::Text { text } => Some(text.clone()),
                                MessageBlock::Thinking { thinking } => Some(thinking.clone()),
                                MessageBlock::ToolUse { name, .. } => {
                                    Some(format!("[tool:{name}]"))
                                }
                                MessageBlock::ToolResult { content, .. } => Some(content.clone()),
                            })
                            .collect::<Vec<_>>()
                            .join("\n")
                    } else {
                        text
                    };
                    messages.push(ParsedMessage {
                        role: "assistant".to_string(),
                        content,
                        blocks,
                        model: None,
                        timestamp: 0,
                        seq,
                    });
                    seq = seq.saturating_add(1);
                }
                "tool" => {
                    let tool_use_id = entry
                        .get("tool_call_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let name = entry
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("tool");
                    let raw = content_as_text(
                        entry.get("content").unwrap_or(&serde_json::Value::Null),
                    );
                    let cleaned = strip_ansi(raw.trim());
                    if cleaned.is_empty() {
                        continue;
                    }
                    // Truncate huge tool dumps for UI
                    let cleaned = if cleaned.chars().count() > 6000 {
                        format!("{}…", cleaned.chars().take(6000).collect::<String>())
                    } else {
                        cleaned
                    };
                    let is_error = cleaned.starts_with("blocked:")
                        || cleaned.starts_with("error:")
                        || cleaned.starts_with("Error");
                    messages.push(ParsedMessage {
                        role: "assistant".to_string(),
                        content: format!("[{name}] {cleaned}"),
                        blocks: vec![MessageBlock::ToolResult {
                            tool_use_id,
                            content: cleaned,
                            is_error,
                        }],
                        model: None,
                        timestamp: 0,
                        seq,
                    });
                    seq = seq.saturating_add(1);
                }
                _ => {}
            }
        }
        Ok(messages)
    }

    fn extract_session_id(&self, file_path: &Path) -> Option<String> {
        let meta_file = meta_path_for(file_path);
        if meta_file.is_file() {
            if let Ok(raw) = std::fs::read_to_string(meta_file) {
                if let Ok(m) = serde_json::from_str::<serde_json::Value>(&raw) {
                    if let Some(id) = m.get("id").and_then(|v| v.as_str()) {
                        return Some(id.to_string());
                    }
                }
            }
        }
        file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
    }

    fn resume_command(&self, native_session_id: &str, project_path: &str) -> Option<Vec<String>> {
        // pflag requires `--resume=<value>` (NoOptDefVal treats space-separated
        // `--resume value` as boolean true without consuming the next arg).
        if project_path.is_empty() {
            Some(vec![format!("--resume={}", native_session_id)])
        } else {
            Some(vec![
                "--dir".into(),
                project_path.to_string(),
                format!("--resume={}", native_session_id),
            ])
        }
    }

    fn resume_command_for_file(
        &self,
        native_session_id: &str,
        project_path: &str,
        file_path: &Path,
    ) -> Option<Vec<String>> {
        // Prefer absolute session file path for unique match (docs: id | path | title substring).
        // Fall back to native session id when path is empty/missing.
        let query = {
            let p = file_path.to_string_lossy();
            if !p.is_empty() && file_path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                p.to_string()
            } else if !native_session_id.is_empty() {
                native_session_id.to_string()
            } else {
                return None;
            }
        };

        // Interactive TUI resume — works in Neeko PTY (needs a real terminal).
        // Do NOT use `run --resume` here: that is one-shot task mode, not session continue.
        // pflag requires `--resume=<value>`; `--resume value` (space-separated)
        // is treated as boolean true via NoOptDefVal and the value is dropped.
        if project_path.is_empty() {
            Some(vec![format!("--resume={}", query)])
        } else {
            Some(vec![
                "--dir".into(),
                project_path.to_string(),
                format!("--resume={}", query),
            ])
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_session(root: &Path) -> PathBuf {
        let sessions = root
            .join("-Users-tomgs-RustroverProjects-neeko")
            .join("sessions");
        std::fs::create_dir_all(&sessions).unwrap();
        let jsonl = sessions.join("20260711-101052.014171000-deepseek-v4-flash.jsonl");
        std::fs::write(
            &jsonl,
            r##"{"role":"system","content":"You are Reasonix"}
{"role":"user","content":"<reasoning-language>\nuse zh\n</reasoning-language>\n\n<response-language>\nuse zh\n</response-language>\n\n[Plan mode — planning only.]\n\nLocal WSL SSH command trait abstraction design please"}
{"role":"assistant","content":"I'll survey the codebase first.","reasoning_content":"Need to explore exec paths","tool_calls":[{"id":"call_1","name":"explore","arguments":"{\"task\":\"find Command usage\"}"}]}
{"role":"tool","tool_call_id":"call_1","name":"explore","content":"blocked: explore is not available in plan mode"}
{"role":"assistant","content":"Here is the plan.","reasoning_content":null}
"##,
        )
        .unwrap();
        std::fs::write(
            meta_path_for(&jsonl),
            r#"{
  "id": "20260711-101052.014171000-deepseek-v4-flash",
  "created_at": "2026-07-11T10:12:19.208405Z",
  "updated_at": "2026-07-11T10:12:19.636553Z",
  "model": "deepseek-flash/deepseek-v4-flash",
  "turns": 1,
  "preview": "hello"
}"#,
        )
        .unwrap();
        // noise files
        std::fs::write(
            sessions.join("20260711-101052.014171000-deepseek-v4-flash.events.jsonl"),
            "{}\n",
        )
        .unwrap();
        std::fs::write(
            sessions.join("20260711-101052.014171000-deepseek-v4-flash-recovery-abc.jsonl"),
            "{}\n",
        )
        .unwrap();
        jsonl
    }

    #[test]
    fn should_detect_main_session_only() {
        let main = PathBuf::from(
            "/home/u/.reasonix/projects/-Users-x/sessions/20260711-deepseek-v4-flash.jsonl",
        );
        let events = PathBuf::from(
            "/home/u/.reasonix/projects/-Users-x/sessions/20260711-deepseek-v4-flash.events.jsonl",
        );
        let recovery = PathBuf::from(
            "/home/u/.reasonix/projects/-Users-x/sessions/20260711-recovery-abc.jsonl",
        );
        let sub = PathBuf::from("/home/u/.reasonix/sessions/subagents/sa_20260713.jsonl");
        assert!(is_main_reasonix_session(&main));
        assert!(!is_main_reasonix_session(&events));
        assert!(!is_main_reasonix_session(&recovery));
        assert!(!is_main_reasonix_session(&sub));
    }

    #[test]
    fn should_strip_harness_from_user_prompt() {
        let raw = "<reasoning-language>\nzh\n</reasoning-language>\n\n<response-language>\nzh\n</response-language>\n\n[Plan mode — planning only.]\n\nPlease design a Command trait";
        let human = extract_human_user_prompt(raw);
        assert!(human.contains("Command trait"));
        assert!(!human.contains("reasoning-language"));
    }

    #[test]
    fn should_parse_meta_and_messages_with_tools() {
        let dir = TempDir::new().unwrap();
        let path = write_session(dir.path());
        let meta = ReasonixAdapter.parse_meta(&path).unwrap();
        assert_eq!(
            meta.native_session_id,
            "20260711-101052.014171000-deepseek-v4-flash"
        );
        // meta.preview still used as title when present
        assert_eq!(meta.title.as_deref(), Some("hello"));
        assert!(
            meta.first_user_message
                .as_ref()
                .is_some_and(|s| s.to_ascii_lowercase().contains("command trait")),
            "first_user={:?}",
            meta.first_user_message
        );

        let messages = ReasonixAdapter.parse_messages(&path).unwrap();
        assert!(
            messages.len() >= 3,
            "expected user + assistants + tool, got {}",
            messages.len()
        );
        assert_eq!(messages[0].role, "user");
        assert!(messages[0]
            .content
            .to_ascii_lowercase()
            .contains("command trait"));
        assert!(!messages[0].content.contains("reasoning-language"));

        // Tool result present as ToolResult block
        assert!(messages.iter().any(|m| m
            .blocks
            .iter()
            .any(|b| matches!(b, MessageBlock::ToolResult { .. }))));
        // Tool use with name "explore"
        assert!(messages.iter().any(|m| m.blocks.iter().any(|b| matches!(
            b,
            MessageBlock::ToolUse { name, .. } if name == "explore"
        ))));
        // Final assistant text
        assert!(messages
            .iter()
            .any(|m| m.role == "assistant" && m.content.contains("plan")));
    }

    /// Multi-turn sessions keep a stub main jsonl; full history is in `*.events.jsonl`.
    #[test]
    fn should_prefer_events_log_when_richer_than_main_jsonl() {
        let dir = TempDir::new().unwrap();
        let sessions = dir
            .path()
            .join("-Users-tomgs-RustroverProjects-neeko")
            .join("sessions");
        std::fs::create_dir_all(&sessions).unwrap();
        let jsonl = sessions.join("20260712-session.jsonl");
        // Stub main file (what user saw as nearly empty detail)
        std::fs::write(
            &jsonl,
            r##"{"role":"system","content":"You are Reasonix"}
{"role":"user","content":"<response-language>\nzh\n</response-language>\n\n分析当前gitpush不支持登陆的问题"}
{"role":"assistant","content":null,"reasoning_content":"thinking…","tool_calls":[{"id":"c1","name":"explore","arguments":"{}"}]}
"##,
        )
        .unwrap();
        // Full event log with later assistant analysis text
        let events = sessions.join("20260712-session.events.jsonl");
        std::fs::write(
            &events,
            r##"{"schema_version":1,"type":"replace","revision":1,"messages":[{"role":"system","content":"You are Reasonix"},{"role":"user","content":"<response-language>\nzh\n</response-language>\n\n分析当前gitpush不支持登陆的问题"},{"role":"assistant","content":null,"reasoning_content":"thinking…","tool_calls":[{"id":"c1","name":"explore","arguments":"{}"}]},{"role":"tool","tool_call_id":"c1","name":"explore","content":"found transport.rs"}]}
{"schema_version":1,"type":"append","revision":2,"messages":[{"role":"assistant","content":"现在我已经获得了完整的上下文。让我来做一个全面的分析报告。\n\n## Git Push 登录问题完整分析\n\n根因是 credentials。","reasoning_content":null}]}
"##,
        )
        .unwrap();

        let messages = ReasonixAdapter.parse_messages(&jsonl).unwrap();
        assert!(
            messages.len() >= 4,
            "events should expand stub session, got {} msgs: {:?}",
            messages.len(),
            messages
                .iter()
                .map(|m| (m.role.as_str(), m.content.chars().take(40).collect::<String>()))
                .collect::<Vec<_>>()
        );
        assert!(
            messages.iter().any(|m| m.content.contains("Git Push") || m.content.contains("分析报告")),
            "expected final analysis text from events log"
        );
        let meta = ReasonixAdapter.parse_meta(&jsonl).unwrap();
        assert!(
            meta.message_count >= 4,
            "message_count should reflect events, got {}",
            meta.message_count
        );
    }

    #[test]
    fn should_resume_interactive_with_file_path_and_dir() {
        let path = PathBuf::from(
            "/Users/tomgs/.reasonix/projects/-Users-x/sessions/sess.jsonl",
        );
        let cmd = ReasonixAdapter
            .resume_command_for_file("sess-id", "/Users/tomgs/proj", &path)
            .expect("resume");
        // pflag requires `--resume=<value>` form (NoOptDefVal, not space-separated).
        assert_eq!(
            cmd,
            vec![
                "--dir".to_string(),
                "/Users/tomgs/proj".to_string(),
                format!("--resume={}", path.to_string_lossy()),
            ]
        );
    }

    #[test]
    fn should_resume_with_session_id_when_no_file() {
        let cmd = ReasonixAdapter
            .resume_command("20260711-101052.014171000-deepseek-v4-flash", "/p")
            .expect("resume");
        // pflag requires `--resume=<value>` form.
        assert_eq!(
            cmd,
            vec![
                "--dir".to_string(),
                "/p".to_string(),
                "--resume=20260711-101052.014171000-deepseek-v4-flash".to_string(),
            ]
        );
    }

    #[test]
    fn should_scan_only_main_via_manager() {
        use crate::conversation::manager::ConversationManager;

        let dir = TempDir::new().unwrap();
        write_session(dir.path());

        struct RootRx {
            root: PathBuf,
        }
        impl AgentSessionAdapter for RootRx {
            fn agent_id(&self) -> &str {
                "reasonix"
            }
            fn session_root(&self) -> PathBuf {
                self.root.clone()
            }
            fn file_pattern(&self) -> &str {
                ReasonixAdapter.file_pattern()
            }
            fn parse_meta(&self, p: &Path) -> Result<ParsedMeta> {
                ReasonixAdapter.parse_meta(p)
            }
            fn parse_messages(&self, p: &Path) -> Result<Vec<ParsedMessage>> {
                ReasonixAdapter.parse_messages(p)
            }
            fn extract_session_id(&self, p: &Path) -> Option<String> {
                ReasonixAdapter.extract_session_id(p)
            }
            fn resume_command(&self, id: &str, pp: &str) -> Option<Vec<String>> {
                ReasonixAdapter.resume_command(id, pp)
            }
            fn resume_command_for_file(
                &self,
                id: &str,
                pp: &str,
                fp: &Path,
            ) -> Option<Vec<String>> {
                ReasonixAdapter.resume_command_for_file(id, pp, fp)
            }
        }

        let manager = ConversationManager::new(vec![Box::new(RootRx {
            root: dir.path().to_path_buf(),
        })]);
        let reports = manager.scan_all(None).unwrap();
        assert_eq!(
            reports[0].sessions_found, 1,
            "noise events/recovery must not count; errors={:?}",
            reports[0].errors
        );

        let list = manager.list(None, None).unwrap();
        assert_eq!(list.len(), 1);
        let msgs = manager.get_messages(&list[0].id).unwrap();
        assert!(
            !msgs.is_empty(),
            "detail view must show messages for reasonix session"
        );

        let resume = manager
            .get_resume_command(&list[0].id)
            .unwrap()
            .expect("resume");
        // Interactive: reasonix [--dir …] --resume=<path|id> — not `run --resume`
        // pflag's NoOptDefVal requires `--resume=<value>` form.
        assert_eq!(resume[0], "--dir");
        assert!(
            resume.iter().any(|a| a.starts_with("--resume=")),
            "expected --resume=<value>, got {resume:?}"
        );
        assert!(
            !resume.iter().any(|a| a == "run"),
            "History resume must not use one-shot run mode: {resume:?}"
        );
        assert!(
            resume.iter().any(|a| a.contains(".jsonl") || a.contains("deepseek")),
            "resume query should be path or session id, got {resume:?}"
        );
    }

    #[test]
    fn should_parse_real_home_session_if_present() {
        let home = dirs::home_dir().expect("home");
        let root = home.join(".reasonix").join("projects");
        if !root.is_dir() {
            return;
        }
        let mut found = None;
        for entry in walkdir::WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
            let p = entry.path();
            if p.is_file() && is_main_reasonix_session(p) {
                if std::fs::metadata(p).map(|m| m.len()).unwrap_or(0) > 5000 {
                    found = Some(p.to_path_buf());
                    break;
                }
            }
        }
        let Some(path) = found else {
            return;
        };
        let messages = ReasonixAdapter
            .parse_messages(&path)
            .unwrap_or_else(|e| panic!("parse_messages {}: {e}", path.display()));
        assert!(
            !messages.is_empty(),
            "real reasonix session should yield messages: {}",
            path.display()
        );
        assert!(
            messages.iter().any(|m| m.role == "user"),
            "expected a user message"
        );
    }
}
