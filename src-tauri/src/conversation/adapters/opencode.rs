use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use rusqlite::OpenFlags;

use crate::conversation::adapter::{AgentSessionAdapter, ParsedMessage, ParsedMeta};
use crate::conversation::adapters::recent_messages_from;
use crate::conversation::types::MessageBlock;

const PREVIEW_LIMIT: u32 = 5;
/// Separator between DB path and session ID in synthetic file paths
const SYNTHETIC_SEP: char = '#';
/// Pattern for OpenCode SQLite database filenames
const DB_PATTERN: &str = "opencode*.db";

/// OpenCode 会话适配器
///
/// 会话格式：`~/.local/share/opencode/opencode*.db`
/// - 单 SQLite 文件存储所有会话
/// - 使用 session / message / part 三表
/// - 角色、摘要等元数据存储在 message.data JSON 中
/// - 文本内容存储在 part.data JSON 中
/// - 每个会话通过合成路径 `<dbPath>#<sessionId>` 标识
pub struct OpenCodeAdapter;

impl AgentSessionAdapter for OpenCodeAdapter {
    fn agent_id(&self) -> &str {
        "opencode"
    }

    fn session_root(&self) -> PathBuf {
        // OpenCode uses XDG ~/.local/share/opencode/ on all platforms
        // (including macOS and Windows) via the xdg-basedir npm package.
        // Override: OPENCODE_CONFIG_DIR env var.
        if let Ok(dir) = std::env::var("OPENCODE_CONFIG_DIR") {
            let trimmed = dir.trim().to_string();
            if !trimmed.is_empty() {
                let path = PathBuf::from(&trimmed);
                if path.is_absolute() {
                    return path;
                }
            }
        }
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("~"))
            .join(".local")
            .join("share")
            .join("opencode")
    }

    fn file_pattern(&self) -> &str {
        DB_PATTERN
    }

    fn parse_all_metas(&self) -> Option<Result<Vec<(ParsedMeta, PathBuf)>>> {
        let root = self.session_root();
        if !root.exists() {
            return Some(Ok(Vec::new()));
        }

        let mut results = Vec::new();

        let walkdir_iter: Vec<_> = walkdir::WalkDir::new(&root)
            .min_depth(1)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_file())
            .collect();

        for entry in &walkdir_iter {
            let path = entry.path();
            let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if !matches_db_pattern(fname) {
                continue;
            }

            match parse_opencode_db(path) {
                Ok(sessions) => results.extend(sessions),
                Err(e) => {
                    log::error!("Failed to parse OpenCode DB {}: {e}", path.display());
                }
            }
        }

        Some(Ok(results))
    }

    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
        if let Some((db_path, session_id)) = split_synthetic_path(file_path) {
            return parse_opencode_session(&db_path, &session_id);
        }
        anyhow::bail!("OpenCode adapter requires parse_all_metas; parse_meta called with: {}", file_path.display());
    }

    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>> {
        let (db_path, session_id) = split_synthetic_path(file_path)
            .context("Invalid synthetic path; expected <dbPath>#<sessionId>")?;

        let conn = rusqlite::Connection::open_with_flags(
            &db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .with_context(|| format!("Failed to open OpenCode DB: {}", db_path.display()))?;
        let _ = conn.execute_batch("PRAGMA query_only = ON");

        // Messages with their parts, ordered by time
        let mut stmt = conn
            .prepare(
                "SELECT m.id, json_extract(m.data, '$.role') AS role,
                        m.time_created,
                        json_extract(m.data, '$.model') AS model_json,
                        p.data AS part_data,
                        p.time_created AS part_time
                 FROM message m
                 JOIN part p ON p.message_id = m.id
                 WHERE m.session_id = ?1
                   AND json_extract(m.data, '$.role') IN ('user', 'assistant')
                 ORDER BY m.time_created ASC, p.time_created ASC",
            )
            .context("Failed to prepare message query")?;

        // Group parts by message
        let mut msg_map: Vec<(String, String, i64, Option<String>, Vec<serde_json::Value>)> =
            Vec::new();

        let rows = stmt
            .query_map([&session_id], |row| {
                let msg_id: String = row.get(0)?;
                let role: String = row.get(1)?;
                let ts: i64 = row.get(2)?;
                let model_json: Option<String> = row.get(3)?;
                let part_data_str: String = row.get(4)?;
                let _part_time: i64 = row.get(5)?;
                let part_data: serde_json::Value =
                    serde_json::from_str(&part_data_str).unwrap_or_default();
                Ok((msg_id, role, ts, model_json, part_data))
            })
            .context("Failed to query messages")?
            .filter_map(|r| r.ok());

        for (msg_id, role, ts, model_json, part_data) in rows {
            if let Some(pos) = msg_map.iter().position(|(id, _, _, _, _)| *id == msg_id) {
                msg_map[pos].4.push(part_data);
            } else {
                msg_map.push((msg_id, role, ts, model_json, vec![part_data]));
            }
        }

        // Build ParsedMessages
        let messages: Vec<ParsedMessage> = msg_map
            .into_iter()
            .enumerate()
            .map(|(seq, (_msg_id, role, ts, model_json, parts))| {
                let ts_ms = if ts > 1_000_000_000_000 {
                    ts
                } else {
                    ts * 1000
                };

                let mut content = String::new();
                let mut blocks: Vec<MessageBlock> = Vec::new();

                for part in &parts {
                    let part_type = part
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("text");
                    match part_type {
                        "text" => {
                            if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                                if !content.is_empty() {
                                    content.push('\n');
                                }
                                content.push_str(text);
                                blocks.push(MessageBlock::Text {
                                    text: text.to_string(),
                                });
                            }
                        }
                        "tool_use" => {
                            let id = part
                                .get("id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let name = part
                                .get("name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown")
                                .to_string();
                            let input = part
                                .get("input")
                                .cloned()
                                .unwrap_or(serde_json::Value::Null);
                            blocks.push(MessageBlock::ToolUse { id, name, input });
                        }
                        "tool_result" => {
                            let tool_use_id = part
                                .get("tool_use_id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let text = part
                                .get("text")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let is_error = part
                                .get("is_error")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            blocks.push(MessageBlock::ToolResult {
                                tool_use_id,
                                content: text.to_string(),
                                is_error,
                            });
                        }
                        _ => {}
                    }
                }

                let model = model_json
                    .as_deref()
                    .and_then(extract_model_id_from_json);

                ParsedMessage {
                    role,
                    content,
                    blocks,
                    model,
                    timestamp: ts_ms,
                    seq: seq as u32,
                }
            })
            .collect();

        Ok(messages)
    }

    fn extract_session_id(&self, file_path: &Path) -> Option<String> {
        let path_str = file_path.to_string_lossy();
        // Try synthetic path first
        if let Some((_, session_id)) = path_str.rsplit_once(SYNTHETIC_SEP) {
            return Some(session_id.to_string());
        }
        // Fallback: db file stem
        let file_stem = file_path.file_stem()?.to_str()?;
        Some(file_stem.to_string())
    }

    fn resume_command(&self, native_session_id: &str, _project_path: &str) -> Option<Vec<String>> {
        Some(vec!["--session".into(), native_session_id.into()])
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn matches_db_pattern(filename: &str) -> bool {
    filename.starts_with("opencode") && filename.ends_with(".db")
}

/// Split a synthetic path `<dbPath>#<sessionId>` into its components.
fn split_synthetic_path(path: &Path) -> Option<(PathBuf, String)> {
    let path_str = path.to_string_lossy();
    let (db_part, session_id) = path_str.rsplit_once(SYNTHETIC_SEP)?;
    if db_part.is_empty() || session_id.is_empty() {
        return None;
    }
    Some((PathBuf::from(db_part), session_id.to_string()))
}

/// Parse all sessions from an OpenCode SQLite database.
fn parse_opencode_db(db_path: &Path) -> Result<Vec<(ParsedMeta, PathBuf)>> {
    let conn = rusqlite::Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("Failed to open OpenCode DB: {}", db_path.display()))?;
    let _ = conn.execute_batch("PRAGMA query_only = ON");

    // Verify the session table exists
    let has_session_table: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='session'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if !has_session_table {
        return Ok(Vec::new());
    }

    // Query all valid sessions
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.title, s.directory, s.time_created, s.time_updated,
                    s.model, COALESCE(s.tokens_input, 0), COALESCE(s.tokens_output, 0),
                    COALESCE(s.tokens_reasoning, 0),
                    (SELECT COUNT(*) FROM message m
                     WHERE m.session_id = s.id
                       AND json_extract(m.data, '$.role') IN ('user','assistant')
                    ) AS msg_count
             FROM session s
             WHERE s.parent_id IS NULL
               AND s.time_archived IS NULL
             ORDER BY s.time_updated DESC",
        )
        .context("Failed to prepare session query")?;

    let rows = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let title: Option<String> = row.get(1)?;
            let directory: Option<String> = row.get(2)?;
            let time_created: i64 = row.get(3)?;
            let time_updated: i64 = row.get(4)?;
            let model_json: Option<String> = row.get(5)?;
            let tokens_input: i64 = row.get(6)?;
            let tokens_output: i64 = row.get(7)?;
            let tokens_reasoning: i64 = row.get(8)?;
            let msg_count: i64 = row.get(9)?;
            Ok((
                id, title, directory, time_created, time_updated,
                model_json, tokens_input, tokens_output, tokens_reasoning, msg_count,
            ))
        })
        .context("Failed to query sessions")?;

    let mut results = Vec::new();
    for row in rows {
        let (
            id, title, directory, time_created, time_updated,
            model_json, tokens_input, tokens_output, tokens_reasoning, msg_count,
        ) = row?;

        let synthetic_path = PathBuf::from(format!(
            "{}{}{}",
            db_path.display(),
            SYNTHETIC_SEP,
            id
        ));

        let started_at = normalize_timestamp(time_created);
        let updated_at = normalize_timestamp(time_updated);
        let model = model_json.as_deref().and_then(extract_model_id_from_json);

        let recent_messages = build_preview_messages(&conn, &id);

        let first_user_raw = recent_messages
            .iter()
            .find(|(role, _)| role == "user")
            .map(|(_, text)| text.clone());

        let meta = ParsedMeta {
            native_session_id: id,
            title,
            first_user_message: first_user_raw,
            recent_messages,
            model,
            started_at,
            updated_at,
            message_count: msg_count as u32,
            project_path: directory,
        };

        results.push((meta, synthetic_path));
    }

    Ok(results)
}

/// Build preview messages for a given session.
fn build_preview_messages(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Vec<(String, String)> {
    let query = conn.prepare(
        "SELECT json_extract(m.data, '$.role') AS role,
                p.data AS part_data,
                p.time_created
         FROM message m
         JOIN part p ON p.message_id = m.id
         WHERE m.session_id = ?1
           AND json_extract(m.data, '$.role') IN ('user','assistant')
           AND json_extract(p.data, '$.type') = 'text'
         ORDER BY p.time_created DESC
         LIMIT ?2",
    );

    let mut stmt = match query {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let rows: Vec<(String, String, i64)> = match stmt.query_map(
        [session_id, &PREVIEW_LIMIT.to_string()],
        |row| {
            let role: String = row.get(0)?;
            let part_data_str: String = row.get(1)?;
            let ts: i64 = row.get(2)?;
            Ok((role, part_data_str, ts))
        },
    ) {
        Ok(r) => r.filter_map(|r| r.ok()).collect(),
        Err(_) => return Vec::new(),
    };

    // Reverse-iterate (query returns newest first, we want oldest-first for the ring buffer)
    let mut pairs: Vec<(String, String)> = Vec::new();
    for (role, part_data_str, _ts) in rows.into_iter().rev() {
        if let Some(text) = extract_part_text(&part_data_str) {
            if !text.trim().is_empty() {
                pairs.push((role, text));
            }
        }
    }

    recent_messages_from(pairs)
}

/// Parse a single session from a synthetic path reference.
fn parse_opencode_session(
    db_path: &Path,
    session_id: &str,
) -> Result<ParsedMeta> {
    let conn = rusqlite::Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("Failed to open OpenCode DB: {}", db_path.display()))?;
    let _ = conn.execute_batch("PRAGMA query_only = ON");

    let row = conn.query_row(
        "SELECT s.title, s.directory, s.time_created, s.time_updated,
                s.model, COALESCE(s.tokens_input, 0), COALESCE(s.tokens_output, 0),
                COALESCE(s.tokens_reasoning, 0),
                (SELECT COUNT(*) FROM message m
                 WHERE m.session_id = s.id
                   AND json_extract(m.data, '$.role') IN ('user','assistant')
                ) AS msg_count
         FROM session s
         WHERE s.id = ?1
         LIMIT 1",
        [session_id],
        |row| {
            let title: Option<String> = row.get(0)?;
            let directory: Option<String> = row.get(1)?;
            let time_created: i64 = row.get(2)?;
            let time_updated: i64 = row.get(3)?;
            let model_json: Option<String> = row.get(4)?;
            let tokens_input: i64 = row.get(5)?;
            let tokens_output: i64 = row.get(6)?;
            let tokens_reasoning: i64 = row.get(7)?;
            let msg_count: i64 = row.get(8)?;
            Ok((
                title, directory, time_created, time_updated,
                model_json, tokens_input, tokens_output, tokens_reasoning, msg_count,
            ))
        },
    ).context("Session not found in OpenCode database")?;

    let (
        title, directory, time_created, time_updated,
        model_json, _tokens_input, _tokens_output, _tokens_reasoning, msg_count,
    ) = row;

    let recent_messages = build_preview_messages(&conn, session_id);

    let first_user_raw = recent_messages
        .iter()
        .find(|(role, _)| role == "user")
        .map(|(_, text)| text.clone());

    Ok(ParsedMeta {
        native_session_id: session_id.to_string(),
        title,
        first_user_message: first_user_raw,
        recent_messages,
        model: model_json.as_deref().and_then(extract_model_id_from_json),
        started_at: normalize_timestamp(time_created),
        updated_at: normalize_timestamp(time_updated),
        message_count: msg_count as u32,
        project_path: directory,
    })
}

/// Extract model ID from OpenCode's JSON model column.
///
/// Supports two formats:
/// - `{"id": "glm-5.2", "providerID": "zai-coding-plan"}`
/// - `{"modelID": "claude-sonnet-4-5"}`
fn extract_model_id_from_json(json_str: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(json_str).ok()?;
    value
        .get("id")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("modelID").and_then(|v| v.as_str()))
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Extract text content from a part.data JSON string.
fn extract_part_text(part_data: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(part_data).ok()?;
    value
        .get("text")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Normalize timestamp to milliseconds.
fn normalize_timestamp(ts: i64) -> i64 {
    if ts > 1_000_000_000_000 {
        ts
    } else {
        ts * 1000
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_opencode_fixture(dir: &TempDir) -> PathBuf {
        let db_path = dir.path().join("opencode.db");
        let conn = rusqlite::Connection::open(&db_path).expect("Failed to create DB");

        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS session (
                id TEXT PRIMARY KEY,
                title TEXT,
                directory TEXT,
                time_created INTEGER,
                time_updated INTEGER,
                model TEXT,
                tokens_input INTEGER DEFAULT 0,
                tokens_output INTEGER DEFAULT 0,
                tokens_reasoning INTEGER DEFAULT 0,
                parent_id TEXT,
                time_archived INTEGER
            );
            CREATE TABLE IF NOT EXISTS message (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                time_created INTEGER,
                time_updated INTEGER,
                data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS part (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                time_created INTEGER,
                time_updated INTEGER,
                data TEXT NOT NULL
            );

            -- Session 1: active, with messages
            INSERT INTO session (id, title, directory, time_created, time_updated, model)
            VALUES ('ses-001', 'Fix UI bug', '/projects/test', 1736935200000, 1736938800000,
                    '{\"id\":\"claude-sonnet-4-5\"}');

            INSERT INTO message (id, session_id, time_created, data)
            VALUES ('m1', 'ses-001', 1736935201000,
                    '{\"role\":\"user\",\"summary\":{\"title\":\"UI bug report\",\"body\":\"The button is broken\"}}');
            INSERT INTO part (id, message_id, session_id, time_created, data)
            VALUES ('p1', 'm1', 'ses-001', 1736935201000,
                    '{\"type\":\"text\",\"text\":\"The button is not rendering correctly\"}');

            INSERT INTO message (id, session_id, time_created, data)
            VALUES ('m2', 'ses-001', 1736935202000,
                    '{\"role\":\"assistant\",\"model\":{\"id\":\"claude-sonnet-4-5\"}}');
            INSERT INTO part (id, message_id, session_id, time_created, data)
            VALUES ('p2', 'm2', 'ses-001', 1736935202000,
                    '{\"type\":\"text\",\"text\":\"Let me check the CSS. It seems like there is a z-index conflict.\"}');

            INSERT INTO message (id, session_id, time_created, data)
            VALUES ('m3', 'ses-001', 1736935203000,
                    '{\"role\":\"user\"}');
            INSERT INTO part (id, message_id, session_id, time_created, data)
            VALUES ('p3', 'm3', 'ses-001', 1736935203000,
                    '{\"type\":\"text\",\"text\":\"How do I fix the z-index?\"}');

            -- Session 2: archived (should be excluded)
            INSERT INTO session (id, title, directory, time_created, time_updated, time_archived)
            VALUES ('ses-archived', 'Archived session', '/projects/test', 1736935200000, 1736938800000, 1736940000000);

            -- Session 3: child session (should be excluded)
            INSERT INTO session (id, title, directory, time_created, time_updated, parent_id)
            VALUES ('ses-child', 'Child session', '/projects/test', 1736935200000, 1736938800000, 'ses-001');
            "
        ).expect("Failed to insert fixture data");

        db_path
    }

    #[test]
    fn should_parse_all_metas() {
        let dir = TempDir::new().unwrap();
        let db_path = create_opencode_fixture(&dir);

        let metas = parse_opencode_db(&db_path).expect("should succeed");

        // Should have 1 session (archived and child are excluded)
        assert_eq!(metas.len(), 1);
        let (meta, syn_path) = &metas[0];
        assert_eq!(meta.native_session_id, "ses-001");
        assert_eq!(meta.title.as_deref(), Some("Fix UI bug"));
        assert_eq!(meta.model.as_deref(), Some("claude-sonnet-4-5"));
        assert_eq!(meta.message_count, 3);
        assert_eq!(meta.project_path.as_deref(), Some("/projects/test"));
        assert_eq!(meta.started_at, 1736935200000);
        assert_eq!(meta.updated_at, 1736938800000);

        // Synthetic path should contain the DB path and session ID
        let syn_str = syn_path.to_string_lossy();
        assert!(syn_str.contains("#ses-001"));
        assert!(syn_str.contains("opencode.db"));

        // Preview messages should include recent messages
        assert!(meta.recent_messages.iter().any(|(_, t)| t.contains("button")));
    }

    #[test]
    fn should_parse_messages() {
        let dir = TempDir::new().unwrap();
        let db_path = create_opencode_fixture(&dir);
        let adapter = OpenCodeAdapter;

        let synthetic_path = PathBuf::from(format!("{}#ses-001", db_path.display()));
        let messages = adapter.parse_messages(&synthetic_path).unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].role, "user");
        assert!(messages[0].content.contains("button"));
        assert_eq!(messages[1].role, "assistant");
        assert!(messages[1].content.contains("z-index"));
        assert_eq!(messages[2].role, "user");
        assert!(messages[2].content.contains("z-index"));
    }

    #[test]
    fn should_handle_archived_sessions() {
        let dir = TempDir::new().unwrap();
        let db_path = create_opencode_fixture(&dir);

        let metas = parse_opencode_db(&db_path).expect("should succeed");

        // Archived and child sessions should be excluded
        let ids: Vec<&str> = metas.iter().map(|(m, _)| m.native_session_id.as_str()).collect();
        assert!(!ids.contains(&"ses-archived"));
        assert!(!ids.contains(&"ses-child"));
        assert!(ids.contains(&"ses-001"));
    }

    #[test]
    fn should_extract_model_id() {
        let json = r#"{"id":"claude-sonnet-4-5","providerID":"anthropic"}"#;
        assert_eq!(
            extract_model_id_from_json(json),
            Some("claude-sonnet-4-5".to_string())
        );

        let old_json = r#"{"modelID":"claude-sonnet-4-5"}"#;
        assert_eq!(
            extract_model_id_from_json(old_json),
            Some("claude-sonnet-4-5".to_string())
        );

        assert_eq!(extract_model_id_from_json("null"), None);
        assert_eq!(extract_model_id_from_json("{}"), None);
    }

    #[test]
    fn should_extract_part_text() {
        let json = r#"{"type":"text","text":"Hello world"}"#;
        assert_eq!(extract_part_text(json), Some("Hello world".to_string()));

        let tool_json = r#"{"type":"tool_use","name":"bash"}"#;
        assert_eq!(extract_part_text(tool_json), None);
    }

    #[test]
    fn should_split_synthetic_path() {
        let path = Path::new("/tmp/opencode.db#ses-abc123");
        let (db, sid) = split_synthetic_path(path).unwrap();
        assert_eq!(db, Path::new("/tmp/opencode.db"));
        assert_eq!(sid, "ses-abc123");
    }

    #[test]
    fn should_return_resume_command() {
        let cmd = OpenCodeAdapter.resume_command("ses-abc123", "/projects/test");
        assert_eq!(
            cmd,
            Some(vec!["--session".to_string(), "ses-abc123".to_string()])
        );
    }

    #[test]
    fn should_handle_nonexistent_db() {
        let path = Path::new("/nonexistent/opencode.db");
        let result = OpenCodeAdapter.parse_messages(&PathBuf::from(format!("{}#s1", path.display())));
        assert!(result.is_err());
    }

    #[test]
    fn should_extract_session_id() {
        let path = Path::new("/tmp/opencode.db");
        let id = OpenCodeAdapter.extract_session_id(path);
        assert_eq!(id, Some("opencode".to_string()));

        // Synthetic path
        let syn_path = Path::new("/tmp/opencode.db#ses-001");
        let id = OpenCodeAdapter.extract_session_id(syn_path);
        assert_eq!(id, Some("ses-001".to_string()));
    }
}
