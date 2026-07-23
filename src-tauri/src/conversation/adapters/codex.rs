use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use anyhow::{Context, Result};
use regex::Regex;

use crate::conversation::adapter::{AgentSessionAdapter, ParsedMessage, ParsedMeta};
use crate::conversation::adapters::{
    parse_timestamp, read_jsonl, recent_messages_from, strip_ansi,
};
use crate::conversation::normalize::is_harness_injected_user_turn;
use crate::conversation::types::MessageBlock;

/// Codex CLI 会话适配器
///
/// 会话格式：`~/.codex/sessions/YYYY/MM/DD/rollout-YYYY-MM-DDThh-mm-ss-<uuid>.jsonl`
///
/// 当前（2026）rollout 格式：
/// - `session_meta.payload`：`session_id` / `cwd` / 可选 title
/// - `response_item.payload`：
///   - `type=message` + `role` + `content: [{type: input_text|output_text, text}]`
///   - `type=function_call` / `function_call_output` / `reasoning` / …
/// - `event_msg.payload`：`user_message` / `agent_message`（用户可见摘要，可选）
///
/// 懒命名标题：`{CODEX_HOME}/session_index.jsonl` 行内 `id` → `thread_name`
/// （rollout 自身常无 title；与 orca session-scanner 对齐）
///
/// 兼容旧 fixture：`turn_context.payload.transcript`、`response_item.payload.delta`
///
/// 原生恢复：`codex resume <SESSION_ID>`
pub struct CodexAdapter;

const CODEX_SESSION_INDEX_FILE: &str = "session_index.jsonl";

/// Signature-cached map of session id → thread_name from one `session_index.jsonl`.
struct SessionIndexTitleCache {
    index_path: PathBuf,
    /// `(len, modified)` of the index file when titles were loaded.
    signature: (u64, SystemTime),
    titles: HashMap<String, String>,
}

static SESSION_INDEX_TITLE_CACHE: Mutex<Option<SessionIndexTitleCache>> = Mutex::new(None);

/// Extract plain text from Codex message content (string | content blocks array).
fn extract_message_text(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(parts) => {
            let mut out = String::new();
            for part in parts {
                let part_type = part.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if matches!(
                    part_type,
                    "input_text" | "output_text" | "text" | "input_image"
                ) {
                    if let Some(t) = part.get("text").and_then(|v| v.as_str()) {
                        if !out.is_empty() {
                            out.push('\n');
                        }
                        out.push_str(t);
                    }
                }
            }
            out
        }
        _ => String::new(),
    }
}

/// Whether text is harness / system injection (reuse shared normalize rules + Codex extras).
///
/// Aligns with orca text-normalization: suppress `# AGENTS.md instructions` and
/// `<INSTRUCTIONS>` whole turns, plus Codex sandbox/bootstrap dumps.
fn looks_like_injected_context(text: &str) -> bool {
    if is_harness_injected_user_turn(text) {
        return true;
    }
    let t = text.trim_start();
    let lower = t.to_ascii_lowercase();
    lower.starts_with("# agents.md instructions")
        || lower.starts_with("<instructions>")
        || lower.starts_with("<permissions instructions>")
        || lower.starts_with("<trellis-bootstrap>")
}

/// Orca: skip internal worker/sub-agent transcripts (payload.source.subagent present).
fn is_codex_worker_session(session_payload: &serde_json::Value) -> bool {
    session_payload
        .pointer("/source/subagent")
        .is_some()
}

impl AgentSessionAdapter for CodexAdapter {
    fn agent_id(&self) -> &str {
        "codex"
    }

    fn session_root(&self) -> PathBuf {
        codex_home_dir().join("sessions")
    }

    fn file_pattern(&self) -> &str {
        "rollout-*.jsonl"
    }

    #[allow(clippy::cast_possible_truncation)]
    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
        let entries = read_jsonl(file_path)?;
        let first = entries.first().context("Codex session file is empty")?;

        let session_meta = entries
            .iter()
            .find(|e| e.get("type").and_then(|v| v.as_str()) == Some("session_meta"));

        // Orca: skip internal worker / sub-agent transcripts in the same sessions tree.
        if let Some(meta) = session_meta {
            let payload = meta.get("payload").cloned().unwrap_or(serde_json::Value::Null);
            if is_codex_worker_session(&payload) {
                anyhow::bail!("skip: codex worker/subagent session");
            }
            // Also reject non-user thread sources when present (thread_source / threadSource).
            let thread_source = payload
                .get("thread_source")
                .or_else(|| payload.get("threadSource"))
                .and_then(|v| v.as_str());
            if matches!(thread_source, Some(s) if s != "user" && !s.is_empty()) {
                anyhow::bail!("skip: codex non-user thread_source={thread_source:?}");
            }
        }

        let native_session_id = session_meta
            .and_then(|e| {
                e.pointer("/payload/id")
                    .or_else(|| e.pointer("/payload/session_id"))
                    .and_then(|v| v.as_str())
            })
            .map(|s| s.to_string())
            .or_else(|| extract_codex_session_id_from_filename(file_path))
            .unwrap_or_else(|| {
                file_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string()
            });

        // Title: meta title / thread_name → session_index.jsonl (lazy names) → first user (manager)
        let mut title = session_meta
            .and_then(|e| {
                e.pointer("/payload/title")
                    .or_else(|| e.pointer("/payload/thread_name"))
                    .or_else(|| e.pointer("/payload/threadName"))
            })
            .or_else(|| first.pointer("/payload/title"))
            .or_else(|| first.pointer("/title"))
            .and_then(|v| v.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        if title.is_none() {
            if let Some(indexed) =
                lookup_session_index_title(file_path, &native_session_id)
            {
                title = Some(indexed);
            }
        }

        let started_at = session_meta
            .and_then(|e| {
                e.pointer("/payload/timestamp")
                    .or_else(|| e.get("timestamp"))
                    .and_then(parse_timestamp)
            })
            .or_else(|| first.get("timestamp").and_then(parse_timestamp))
            .unwrap_or(0);

        let updated_at = entries
            .last()
            .and_then(|e| e.get("timestamp"))
            .and_then(parse_timestamp)
            .unwrap_or(started_at);

        let model = entries.iter().rev().find_map(|e| {
            e.pointer("/payload/model")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        });

        // Collect chat-facing message pairs (current + legacy formats)
        let chat_pairs = collect_chat_text_pairs(&entries);
        let message_count = chat_pairs.len() as u32;

        let first_user_raw = chat_pairs
            .iter()
            .find(|(role, text)| role == "user" && !looks_like_injected_context(text))
            .map(|(_, t)| t.clone())
            .or_else(|| {
                chat_pairs
                    .iter()
                    .find(|(role, _)| role == "user")
                    .map(|(_, t)| t.clone())
            });

        let recent_messages = recent_messages_from(chat_pairs);

        let project_path = session_meta
            .and_then(|e| e.pointer("/payload/cwd"))
            .or_else(|| first.pointer("/payload/cwd"))
            .or_else(|| first.pointer("/cwd"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                // turn_context / workspace
                entries.iter().find_map(|e| {
                    e.pointer("/payload/cwd")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
            });

        Ok(ParsedMeta {
            native_session_id,
            title,
            first_user_message: first_user_raw,
            recent_messages,
            model,
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
            let entry_type = entry.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let timestamp = entry
                .get("timestamp")
                .and_then(parse_timestamp)
                .unwrap_or(0);

            match entry_type {
                // ── Current format: response_item message ───────────────
                "response_item" => {
                    let payload = entry.get("payload").cloned().unwrap_or(serde_json::Value::Null);
                    let payload_type = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");

                    match payload_type {
                        "message" => {
                            let role = payload
                                .get("role")
                                .and_then(|v| v.as_str())
                                .unwrap_or("assistant");
                            // Skip pure developer system prompts in the viewer
                            if role == "developer" || role == "system" {
                                continue;
                            }
                            let content_val =
                                payload.get("content").cloned().unwrap_or(serde_json::Value::Null);
                            let text = extract_message_text(&content_val);
                            // Legacy delta fallback
                            let text = if text.is_empty() {
                                payload
                                    .get("delta")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string()
                            } else {
                                text
                            };
                            let cleaned = strip_ansi(text.trim());
                            if cleaned.is_empty() || looks_like_injected_context(&cleaned) {
                                continue;
                            }
                            let role_out = if role == "user" {
                                "user"
                            } else {
                                "assistant"
                            };
                            messages.push(ParsedMessage {
                                role: role_out.to_string(),
                                content: cleaned.clone(),
                                blocks: vec![MessageBlock::Text { text: cleaned }],
                                model: None,
                                timestamp,
                                seq,
                            });
                            seq = seq.saturating_add(1);
                        }
                        "function_call" | "custom_tool_call" => {
                            let id = payload
                                .get("call_id")
                                .or_else(|| payload.get("id"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("tool")
                                .to_string();
                            let name = payload
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("tool")
                                .to_string();
                            let input = payload
                                .get("arguments")
                                .cloned()
                                .or_else(|| payload.get("input").cloned())
                                .unwrap_or(serde_json::Value::Null);
                            // arguments often a JSON string
                            let input = if let serde_json::Value::String(s) = &input {
                                serde_json::from_str(s).unwrap_or(input.clone())
                            } else {
                                input
                            };
                            messages.push(ParsedMessage {
                                role: "assistant".to_string(),
                                content: format!("[tool:{name}]"),
                                blocks: vec![MessageBlock::ToolUse { id, name, input }],
                                model: None,
                                timestamp,
                                seq,
                            });
                            seq = seq.saturating_add(1);
                        }
                        "function_call_output" | "custom_tool_call_output" => {
                            let tool_use_id = payload
                                .get("call_id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let content = payload
                                .get("output")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let cleaned = strip_ansi(&content);
                            if cleaned.trim().is_empty() {
                                continue;
                            }
                            // Truncate huge tool outputs for UI
                            let cleaned = if cleaned.chars().count() > 4000 {
                                format!(
                                    "{}…",
                                    cleaned.chars().take(4000).collect::<String>()
                                )
                            } else {
                                cleaned
                            };
                            messages.push(ParsedMessage {
                                role: "assistant".to_string(),
                                content: cleaned.clone(),
                                blocks: vec![MessageBlock::ToolResult {
                                    tool_use_id,
                                    content: cleaned,
                                    is_error: false,
                                }],
                                model: None,
                                timestamp,
                                seq,
                            });
                            seq = seq.saturating_add(1);
                        }
                        "reasoning" => {
                            let thinking = payload
                                .pointer("/summary/0/text")
                                .and_then(|v| v.as_str())
                                .or_else(|| payload.get("content").and_then(|v| v.as_str()))
                                .unwrap_or("");
                            let cleaned = strip_ansi(thinking.trim());
                            if cleaned.is_empty() {
                                continue;
                            }
                            messages.push(ParsedMessage {
                                role: "assistant".to_string(),
                                content: cleaned.clone(),
                                blocks: vec![MessageBlock::Thinking {
                                    thinking: cleaned,
                                }],
                                model: None,
                                timestamp,
                                seq,
                            });
                            seq = seq.saturating_add(1);
                        }
                        _ => {}
                    }
                }
                // ── Legacy: turn_context.transcript ─────────────────────
                "turn_context" => {
                    let content = entry
                        .pointer("/payload/transcript")
                        .or_else(|| entry.get("transcript"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let cleaned = strip_ansi(content);
                    if cleaned.is_empty() {
                        continue;
                    }
                    messages.push(ParsedMessage {
                        role: "user".to_string(),
                        content: cleaned.clone(),
                        blocks: vec![MessageBlock::Text { text: cleaned }],
                        model: None,
                        timestamp,
                        seq,
                    });
                    seq = seq.saturating_add(1);
                }
                // Prefer not to double-count event_msg if response_item already has messages.
                // Only used as fallback when no response_item messages collected yet — handled after loop.
                _ => {}
            }
        }

        // Fallback: if no chat messages from response_item/turn_context, use event_msg
        if messages.is_empty() {
            for entry in &entries {
                if entry.get("type").and_then(|v| v.as_str()) != Some("event_msg") {
                    continue;
                }
                let pl = entry.get("payload").cloned().unwrap_or(serde_json::Value::Null);
                let et = pl.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let (role, text) = match et {
                    "user_message" => (
                        "user",
                        pl.get("message").and_then(|v| v.as_str()).unwrap_or(""),
                    ),
                    "agent_message" => (
                        "assistant",
                        pl.get("message").and_then(|v| v.as_str()).unwrap_or(""),
                    ),
                    _ => continue,
                };
                let cleaned = strip_ansi(text.trim());
                if cleaned.is_empty() || looks_like_injected_context(&cleaned) {
                    continue;
                }
                let ts = entry
                    .get("timestamp")
                    .and_then(parse_timestamp)
                    .unwrap_or(0);
                messages.push(ParsedMessage {
                    role: role.to_string(),
                    content: cleaned.clone(),
                    blocks: vec![MessageBlock::Text { text: cleaned }],
                    model: None,
                    timestamp: ts,
                    seq,
                });
                seq = seq.saturating_add(1);
            }
        }

        Ok(messages)
    }

    fn extract_session_id(&self, file_path: &Path) -> Option<String> {
        extract_codex_session_id_from_filename(file_path)
    }

    fn resume_command(&self, native_session_id: &str, _project_path: &str) -> Option<Vec<String>> {
        Some(vec!["resume".to_string(), native_session_id.to_string()])
    }
}

/// Collect (role, text) pairs for preview / counts from current + legacy formats.
fn collect_chat_text_pairs(entries: &[serde_json::Value]) -> Vec<(String, String)> {
    let mut pairs = Vec::new();

    for e in entries {
        let t = e.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match t {
            "response_item" => {
                let pl = e.get("payload").cloned().unwrap_or(serde_json::Value::Null);
                if pl.get("type").and_then(|v| v.as_str()) != Some("message") {
                    continue;
                }
                let role = pl.get("role").and_then(|v| v.as_str()).unwrap_or("");
                if role != "user" && role != "assistant" {
                    continue;
                }
                let text = extract_message_text(
                    pl.get("content").unwrap_or(&serde_json::Value::Null),
                );
                let text = if text.is_empty() {
                    pl.get("delta")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string()
                } else {
                    text
                };
                let text = text.trim().to_string();
                if text.is_empty() || looks_like_injected_context(&text) {
                    continue;
                }
                pairs.push((role.to_string(), text));
            }
            "turn_context" => {
                if let Some(text) = e
                    .pointer("/payload/transcript")
                    .and_then(|v| v.as_str())
                    .or_else(|| e.get("transcript").and_then(|v| v.as_str()))
                {
                    let text = text.trim().to_string();
                    if !text.is_empty() {
                        pairs.push(("user".to_string(), text));
                    }
                }
            }
            "event_msg" => {
                // Only if we still have nothing — filled after loop if pairs empty
            }
            _ => {}
        }
    }

    if pairs.is_empty() {
        for e in entries {
            if e.get("type").and_then(|v| v.as_str()) != Some("event_msg") {
                continue;
            }
            let pl = e.get("payload").cloned().unwrap_or(serde_json::Value::Null);
            let et = pl.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let (role, text) = match et {
                "user_message" => (
                    "user",
                    pl.get("message").and_then(|v| v.as_str()).unwrap_or(""),
                ),
                "agent_message" => (
                    "assistant",
                    pl.get("message").and_then(|v| v.as_str()).unwrap_or(""),
                ),
                _ => continue,
            };
            let text = text.trim().to_string();
            if text.is_empty() || looks_like_injected_context(&text) {
                continue;
            }
            pairs.push((role.to_string(), text));
        }
    }

    pairs
}

/// Codex home: `$CODEX_HOME` when set, else `~/.codex`.
fn codex_home_dir() -> PathBuf {
    if let Ok(home) = std::env::var("CODEX_HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("~"))
        .join(".codex")
}

/// Walk up from a rollout path to the parent of a `sessions` directory (= codex home).
fn codex_home_from_session_file(session_file: &Path) -> Option<PathBuf> {
    let mut current = session_file.parent()?;
    loop {
        if current
            .file_name()
            .and_then(|s| s.to_str())
            .is_some_and(|n| n == "sessions")
        {
            return current.parent().map(|p| p.to_path_buf());
        }
        match current.parent() {
            Some(parent) if parent != current => current = parent,
            _ => return None,
        }
    }
}

/// Best-effort title from `{codex_home}/session_index.jsonl` (`id` → `thread_name`).
/// Missing / unreadable index is non-fatal (returns None).
fn lookup_session_index_title(session_file: &Path, session_id: &str) -> Option<String> {
    if session_id.is_empty() {
        return None;
    }
    let codex_home = codex_home_from_session_file(session_file)?;
    let titles = read_session_index_titles(&codex_home);
    titles.get(session_id).cloned()
}

fn index_file_signature(path: &Path) -> Option<(u64, SystemTime)> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    Some((meta.len(), modified))
}

fn read_session_index_titles(codex_home: &Path) -> HashMap<String, String> {
    let index_path = codex_home.join(CODEX_SESSION_INDEX_FILE);
    let signature = match index_file_signature(&index_path) {
        Some(s) => s,
        None => return HashMap::new(),
    };

    {
        let cache = SESSION_INDEX_TITLE_CACHE
            .lock()
            .expect("infallible: session index title cache");
        if let Some(entry) = cache.as_ref() {
            if entry.index_path == index_path && entry.signature == signature {
                return entry.titles.clone();
            }
        }
    }

    let titles = read_session_index_titles_from_disk(&index_path);
    {
        let mut cache = SESSION_INDEX_TITLE_CACHE
            .lock()
            .expect("infallible: session index title cache");
        *cache = Some(SessionIndexTitleCache {
            index_path,
            signature,
            titles: titles.clone(),
        });
    }
    titles
}

fn read_session_index_titles_from_disk(index_path: &Path) -> HashMap<String, String> {
    let mut titles = HashMap::new();
    let content = match std::fs::read_to_string(index_path) {
        Ok(c) => c,
        Err(_) => return titles,
    };
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(record) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let Some(id) = record.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(name) = record
            .get("thread_name")
            .or_else(|| record.get("threadName"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        titles.insert(id.to_string(), name.to_string());
    }
    titles
}

/// 从 Codex 文件名中提取 UUID
///
/// 文件名格式：`rollout-YYYY-MM-DDThh-mm-ss-<uuid>.jsonl`
fn extract_codex_session_id_from_filename(path: &Path) -> Option<String> {
    let file_name = path.file_name()?.to_str()?;
    // Match pattern: rollout-YYYY-MM-DDThh-mm-ss-<uuid>.jsonl
    // UUID is the last segment before .jsonl
    let re =
        Regex::new(r"^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([a-f0-9-]+)\.jsonl$").ok()?;
    let caps = re.captures(file_name)?;
    Some(caps.get(1)?.as_str().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Legacy fixture (turn_context + delta) — still supported.
    fn create_legacy_codex_fixture(dir: &TempDir, name: &str) -> PathBuf {
        let path = dir.path().join(name);
        let mut content = String::new();
        content.push_str(
            r#"{"type":"session_meta","timestamp":"2025-01-15T10:00:00Z","payload":{"title":"Fix login bug","cwd":"/projects/test","started_at":"2025-01-15T10:00:00Z"}}"#,
        );
        content.push('\n');
        content.push_str(
            r#"{"type":"turn_context","timestamp":"2025-01-15T10:00:01Z","payload":{"transcript":"Can you help me fix the login issue?"}}"#,
        );
        content.push('\n');
        content.push_str(
            r#"{"type":"response_item","timestamp":"2025-01-15T10:00:02Z","payload":{"type":"message","delta":"I see the issue. The auth token validation is missing a null check."}}"#,
        );
        content.push('\n');
        content.push_str(
            r#"{"type":"turn_context","timestamp":"2025-01-15T10:00:03Z","payload":{"transcript":"Where should I add it?"}}"#,
        );
        content.push('\n');
        content.push_str(
            r#"{"type":"response_item","timestamp":"2025-01-15T10:00:04Z","payload":{"type":"message","delta":"In the middleware file, around line 45."}}"#,
        );
        content.push('\n');
        std::fs::write(&path, content).expect("Failed to write fixture");
        path
    }

    /// Current Codex rollout format (2026).
    /// Uses `r##"..."##` so embedded `"#` (e.g. AGENTS.md headings) do not end the raw string.
    fn create_modern_codex_fixture(dir: &TempDir, name: &str) -> PathBuf {
        let path = dir.path().join(name);
        let content = r##"
{"timestamp":"2026-07-16T03:09:03.825Z","type":"session_meta","payload":{"session_id":"019f68e6-1a7f-75e0-8765-84171499aa7b","id":"019f68e6-1a7f-75e0-8765-84171499aa7b","timestamp":"2026-07-16T03:08:58.383Z","cwd":"/Users/tomgs/RustroverProjects/neeko","originator":"codex-tui"}}
{"timestamp":"2026-07-16T03:09:03.828Z","type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"<permissions instructions>\nSandbox"}]}}
{"timestamp":"2026-07-16T03:09:03.828Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions for /Users/tomgs/RustroverProjects/neeko\n\n<INSTRUCTIONS>\n# Repository Guidelines"}]}}
{"timestamp":"2026-07-16T03:09:03.828Z","type":"turn_context","payload":{"turn_id":"t1","cwd":"/Users/tomgs/RustroverProjects/neeko","model":"gpt-5.3"}}
{"timestamp":"2026-07-16T03:09:04.058Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"analyze wsl local ssh project unification"}]}}
{"timestamp":"2026-07-16T03:09:04.059Z","type":"event_msg","payload":{"type":"user_message","message":"analyze wsl local ssh project unification","images":[]}}
{"timestamp":"2026-07-16T03:09:10.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Check the Project abstraction layer first."}]}}
{"timestamp":"2026-07-16T03:09:11.000Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"call_1","arguments":"{\"cmd\":\"ls\"}"}}
{"timestamp":"2026-07-16T03:09:12.000Z","type":"response_item","payload":{"type":"function_call_output","call_id":"call_1","output":"src\nsrc-tauri\n"}}
{"timestamp":"2026-07-16T03:09:13.000Z","type":"event_msg","payload":{"type":"agent_message","message":"Project unification looks complete."}}
"##;
        std::fs::write(&path, content.trim_start()).expect("Failed to write modern fixture");
        path
    }

    #[test]
    fn should_parse_meta_legacy() {
        let dir = TempDir::new().unwrap();
        let path = create_legacy_codex_fixture(
            &dir,
            "rollout-2025-01-15T10-00-00-123e4567-e89b-12d3-a456-426614174000.jsonl",
        );
        let meta = CodexAdapter.parse_meta(&path).unwrap();
        assert_eq!(
            meta.native_session_id,
            "123e4567-e89b-12d3-a456-426614174000"
        );
        assert_eq!(meta.title.as_deref(), Some("Fix login bug"));
        assert!(meta.message_count >= 2);
        assert!(meta
            .recent_messages
            .iter()
            .any(|(_, t)| t.contains("login")));
        assert_eq!(meta.project_path.as_deref(), Some("/projects/test"));
    }

    #[test]
    fn should_parse_messages_legacy() {
        let dir = TempDir::new().unwrap();
        let path = create_legacy_codex_fixture(&dir, "rollout-2025-01-15T10-00-00-test-uuid.jsonl");
        let messages = CodexAdapter.parse_messages(&path).unwrap();
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "Can you help me fix the login issue?");
        assert_eq!(messages[1].role, "assistant");
        assert!(messages[1].content.contains("auth token"));
    }

    #[test]
    fn should_parse_meta_modern_format() {
        let dir = TempDir::new().unwrap();
        let path = create_modern_codex_fixture(
            &dir,
            "rollout-2026-07-16T11-08-58-019f68e6-1a7f-75e0-8765-84171499aa7b.jsonl",
        );
        let meta = CodexAdapter.parse_meta(&path).unwrap();
        assert_eq!(
            meta.native_session_id,
            "019f68e6-1a7f-75e0-8765-84171499aa7b"
        );
        assert_eq!(
            meta.project_path.as_deref(),
            Some("/Users/tomgs/RustroverProjects/neeko")
        );
        // First real user prompt, not AGENTS.md
        assert!(
            meta.first_user_message
                .as_ref()
                .is_some_and(|s| s.contains("wsl")),
            "first_user={:?}",
            meta.first_user_message
        );
        assert!(
            meta.message_count >= 2,
            "message_count={}",
            meta.message_count
        );
        assert!(meta
            .recent_messages
            .iter()
            .any(|(r, t)| r == "assistant" && t.contains("Project")));
    }

    #[test]
    fn should_parse_messages_modern_format() {
        let dir = TempDir::new().unwrap();
        let path = create_modern_codex_fixture(
            &dir,
            "rollout-2026-07-16T11-08-58-019f68e6-1a7f-75e0-8765-84171499aa7b.jsonl",
        );
        let messages = CodexAdapter.parse_messages(&path).unwrap();
        assert!(
            !messages.is_empty(),
            "modern codex must surface chat messages"
        );
        let user = messages.iter().find(|m| m.role == "user");
        assert!(user.is_some());
        assert!(user.unwrap().content.contains("wsl"));
        // AGENTS.md injection filtered
        assert!(!messages.iter().any(|m| m.content.contains("AGENTS.md")));
        let assistant = messages.iter().find(|m| {
            m.role == "assistant" && m.blocks.iter().any(|b| matches!(b, MessageBlock::Text { .. }))
        });
        assert!(assistant.is_some());
        // tool blocks present
        assert!(messages.iter().any(|m| m
            .blocks
            .iter()
            .any(|b| matches!(b, MessageBlock::ToolUse { .. }))));
    }

    #[test]
    fn should_extract_session_id() {
        let path =
            Path::new("rollout-2025-01-15T10-00-00-123e4567-e89b-12d3-a456-426614174000.jsonl");
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
        assert_eq!(
            cmd,
            Some(vec!["resume".to_string(), "test-uuid".to_string()])
        );
    }

    #[test]
    fn should_handle_empty_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("rollout-empty.jsonl");
        std::fs::write(&path, "").expect("Failed to write");
        let result = CodexAdapter.parse_meta(&path);
        assert!(result.is_err());
    }

    #[test]
    fn should_parse_real_home_session_if_present() {
        let home = dirs::home_dir().expect("home");
        let root = home.join(".codex").join("sessions");
        if !root.is_dir() {
            return;
        }
        // Prefer the known modern session when present; otherwise any rollout.
        let preferred = root.join(
            "2026/07/23/rollout-2026-07-23T21-26-01-019f8f27-8d73-7dd3-aa3c-b5bf01ca1b6f.jsonl",
        );
        let path = if preferred.is_file() {
            preferred
        } else {
            let mut found = None;
            for entry in walkdir::WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
                let p = entry.path();
                if p.is_file()
                    && p.file_name()
                        .and_then(|s| s.to_str())
                        .is_some_and(|n| n.starts_with("rollout-") && n.ends_with(".jsonl"))
                {
                    found = Some(p.to_path_buf());
                    break;
                }
            }
            let Some(p) = found else {
                return;
            };
            p
        };
        let meta = CodexAdapter
            .parse_meta(&path)
            .unwrap_or_else(|e| panic!("parse_meta real {}: {e}", path.display()));
        assert!(!meta.native_session_id.is_empty());
        let messages = CodexAdapter
            .parse_messages(&path)
            .unwrap_or_else(|e| panic!("parse_messages real {}: {e}", path.display()));
        // Real sessions may be short; at least parse without empty forced if file has user content
        // Soft assert: if file is large, expect messages
        if std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) > 2000 {
            assert!(
                !messages.is_empty(),
                "large real codex session should yield messages: {}",
                path.display()
            );
            // Injections must not surface as chat
            assert!(!messages.iter().any(|m| m.content.contains("AGENTS.md")));
            assert!(
                !messages
                    .iter()
                    .any(|m| m.content.to_ascii_lowercase().contains("<permissions"))
            );
        }
    }

    #[test]
    fn should_lookup_title_from_session_index_when_meta_has_none() {
        let codex_home = TempDir::new().unwrap();
        let sessions = codex_home
            .path()
            .join("sessions")
            .join("2026")
            .join("07")
            .join("23");
        std::fs::create_dir_all(&sessions).unwrap();

        let session_id = "019f8f27-8d73-7dd3-aa3c-b5bf01ca1b6f";
        let rollout_name =
            format!("rollout-2026-07-23T21-26-01-{session_id}.jsonl");
        let path = sessions.join(&rollout_name);

        // Modern rollout without title / thread_name in session_meta
        let content = format!(
            r##"{{"timestamp":"2026-07-23T13:26:01.000Z","type":"session_meta","payload":{{"session_id":"{session_id}","id":"{session_id}","timestamp":"2026-07-23T13:26:01.000Z","cwd":"/tmp/proj","originator":"codex-tui"}}}}
{{"timestamp":"2026-07-23T13:26:02.000Z","type":"response_item","payload":{{"type":"message","role":"user","content":[{{"type":"input_text","text":"hello from fixture"}}]}}}}
"##
        );
        std::fs::write(&path, content).unwrap();

        // Orca-aligned index: id → thread_name
        let index_line = serde_json::json!({
            "id": session_id,
            "thread_name": "Indexed Codex resume picker title"
        });
        std::fs::write(
            codex_home.path().join(CODEX_SESSION_INDEX_FILE),
            format!("{index_line}\n"),
        )
        .unwrap();

        // Clear cache so this fixture path is not polluted by prior tests
        *SESSION_INDEX_TITLE_CACHE
            .lock()
            .expect("infallible: session index title cache") = None;

        let meta = CodexAdapter.parse_meta(&path).unwrap();
        assert_eq!(meta.native_session_id, session_id);
        assert_eq!(
            meta.title.as_deref(),
            Some("Indexed Codex resume picker title")
        );
    }

    #[test]
    fn should_prefer_meta_title_over_session_index() {
        let codex_home = TempDir::new().unwrap();
        let sessions = codex_home.path().join("sessions").join("2026").join("01");
        std::fs::create_dir_all(&sessions).unwrap();
        let session_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        let path = sessions.join(format!("rollout-2026-01-01T00-00-00-{session_id}.jsonl"));
        let content = format!(
            r#"{{"type":"session_meta","timestamp":"2026-01-01T00:00:00Z","payload":{{"id":"{session_id}","session_id":"{session_id}","title":"Meta wins","cwd":"/p"}}}}
{{"type":"response_item","timestamp":"2026-01-01T00:00:01Z","payload":{{"type":"message","role":"user","content":[{{"type":"input_text","text":"hi"}}]}}}}
"#
        );
        std::fs::write(&path, content).unwrap();
        std::fs::write(
            codex_home.path().join(CODEX_SESSION_INDEX_FILE),
            format!(
                r#"{{"id":"{session_id}","thread_name":"Index should not win"}}
"#
            ),
        )
        .unwrap();
        *SESSION_INDEX_TITLE_CACHE
            .lock()
            .expect("infallible: session index title cache") = None;

        let meta = CodexAdapter.parse_meta(&path).unwrap();
        assert_eq!(meta.title.as_deref(), Some("Meta wins"));
    }

    #[test]
    fn should_skip_worker_subagent_session() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(
            "rollout-2026-07-16T11-08-58-019f68e6-1a7f-75e0-8765-84171499aa7b.jsonl",
        );
        let content = r#"{"type":"session_meta","timestamp":"2026-07-16T03:09:03.825Z","payload":{"session_id":"019f68e6-1a7f-75e0-8765-84171499aa7b","id":"019f68e6-1a7f-75e0-8765-84171499aa7b","cwd":"/tmp","source":{"subagent":{"id":"worker-1"}}}}
{"type":"response_item","timestamp":"2026-07-16T03:09:04.000Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"worker task"}]}}
"#;
        std::fs::write(&path, content).unwrap();
        let err = CodexAdapter.parse_meta(&path).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.starts_with("skip:"),
            "worker sessions must bail with skip: prefix, got {msg}"
        );
    }

    #[test]
    fn should_return_none_when_session_index_missing() {
        let codex_home = TempDir::new().unwrap();
        let sessions = codex_home.path().join("sessions");
        std::fs::create_dir_all(&sessions).unwrap();
        let path = sessions.join(
            "rollout-2026-07-23T21-26-01-019f8f27-8d73-7dd3-aa3c-b5bf01ca1b6f.jsonl",
        );
        std::fs::write(
            &path,
            r#"{"type":"session_meta","timestamp":"2026-07-23T13:26:01Z","payload":{"id":"019f8f27-8d73-7dd3-aa3c-b5bf01ca1b6f","session_id":"019f8f27-8d73-7dd3-aa3c-b5bf01ca1b6f","cwd":"/p"}}
{"type":"response_item","timestamp":"2026-07-23T13:26:02Z","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"no index"}]}}
"#,
        )
        .unwrap();
        *SESSION_INDEX_TITLE_CACHE
            .lock()
            .expect("infallible: session index title cache") = None;

        let meta = CodexAdapter.parse_meta(&path).unwrap();
        assert!(meta.title.is_none());
        assert!(
            meta.first_user_message
                .as_ref()
                .is_some_and(|s| s.contains("no index"))
        );
    }
}
