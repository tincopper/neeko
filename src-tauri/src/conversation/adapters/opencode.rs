use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use crate::conversation::adapter::{AgentSessionAdapter, ParsedMessage, ParsedMeta};
use crate::conversation::adapters::{
    recent_messages_from, strip_ansi,
};

/// OpenCode 会话适配器
///
/// 会话格式：`~/.local/share/opencode/opencode.db`
/// - 单 SQLite 文件，使用 Drizzle ORM 模式
/// - 包含 sessions、messages、parts 表
/// - 不支持原生 CLI 恢复（ACP 协议为 Phase 2）
///
/// 注意：由于 OpenCode 将所有会话存储在一个 SQLite 文件中，
/// 当前实现返回数据库中最近（updated_at 最新）的会话。
pub struct OpenCodeAdapter;

impl AgentSessionAdapter for OpenCodeAdapter {
    fn agent_id(&self) -> &str {
        "opencode"
    }

    fn session_root(&self) -> PathBuf {
        dirs::data_dir()
            .unwrap_or_else(|| {
                dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("~"))
                    .join(".local")
                    .join("share")
            })
            .join("opencode")
    }

    fn file_pattern(&self) -> &str {
        "opencode.db"
    }

    fn parse_meta(&self, file_path: &Path) -> Result<ParsedMeta> {
        if !file_path.exists() {
            anyhow::bail!("OpenCode database not found: {}", file_path.display());
        }

        let conn = rusqlite::Connection::open(file_path)
            .context("Failed to open OpenCode SQLite database")?;

        // Detect column names in sessions table
        let session_cols = get_column_names(&conn, "sessions");
        let use_camel = session_cols.contains(&"createdAt".to_string());
        let use_snake = session_cols.contains(&"created_at".to_string());

        let created_col = if use_camel { "createdAt" } else if use_snake { "created_at" } else { "createdAt" };
        let updated_col = if use_camel { "updatedAt" } else if use_snake { "updated_at" } else { "createdAt" };
        let project_col = if use_camel { "projectPath" } else if use_snake { "project_path" } else { "projectPath" };
        let has_data_col = session_cols.contains(&"data".to_string());

        // Build query with detected column names
        let session_query = format!(
            "SELECT id, title, {created} AS created, {updated} AS updated, {project} AS project \
             FROM sessions ORDER BY {updated} DESC LIMIT 1",
            created = created_col,
            updated = updated_col,
            project = project_col,
        );

        let (native_session_id, title, started_at, updated_at, project_path_str): (String, Option<String>, i64, i64, Option<String>) = conn
            .query_row(&session_query, [], |row| {
                let id: String = row.get(0)?;
                let title: Option<String> = row.get(1)?;
                let created_val: i64 = row.get(2)?;
                let updated_val: i64 = row.get(3)?;
                let project_path: Option<String> = row.get(4)?;
                let created_ms = if created_val > 1_000_000_000_000 { created_val } else { created_val * 1000 };
                let updated_ms = if updated_val > 1_000_000_000_000 { updated_val } else { updated_val * 1000 };
                let pp = project_path.filter(|s| !s.is_empty());
                Ok((id, title, created_ms, updated_ms, pp))
            })
            .context("No sessions found in OpenCode database")?;

        // Extract summary.title from data JSON if available (orca pattern)
        let title = if has_data_col {
            let data_query = format!(
                "SELECT data FROM sessions ORDER BY {updated} DESC LIMIT 1",
                updated = updated_col,
            );
            let data_json: Option<String> = conn
                .query_row(&data_query, [], |row| row.get::<_, Option<String>>(0))
                .ok()
                .flatten();
            let summary_title = data_json
                .as_deref()
                .and_then(|json_str| {
                    serde_json::from_str::<serde_json::Value>(json_str)
                        .ok()
                        .and_then(|v| {
                            v.pointer("/summary/title")
                                .and_then(|t| t.as_str().map(|s| s.to_string()))
                        })
                });
            summary_title.or(title)
        } else {
            title
        };

        let project_path = project_path_str;

        // Detect column names in messages table
        let msg_cols = get_column_names(&conn, "messages");
        let msg_session_col = if msg_cols.contains(&"sessionId".to_string()) { "sessionId" } else { "session_id" };
        let msg_seq_col = if msg_cols.contains(&"seq".to_string()) { "seq" } else { "createdAt" };
        let _msg_created_col = if msg_cols.contains(&"createdAt".to_string()) { "createdAt" } else { "created_at" };

        // Count messages for this session
        let count_query = format!(
            "SELECT COUNT(*) FROM messages WHERE {session_col} = ?1",
            session_col = msg_session_col,
        );
        let message_count: u32 = conn
            .query_row(&count_query, [&native_session_id], |row| row.get(0))
            .unwrap_or(0);

        // 最近消息缓冲（剔除 harness 注入噪声），供 manager 构建预览
        let preview_query = format!(
            "SELECT content, role FROM messages \
             WHERE {session_col} = ?1 \
             AND content IS NOT NULL AND content != '' \
             ORDER BY {seq_col} ASC",
            session_col = msg_session_col,
            seq_col = msg_seq_col,
        );
        let recent_messages: Vec<(String, String)> = {
            let mut stmt = match conn.prepare(&preview_query) {
                Ok(s) => s,
                Err(_) => return Ok(ParsedMeta {
                    native_session_id,
                    title,
                    first_user_message: None,
                    recent_messages: Vec::new(),
                    started_at,
                    updated_at,
                    message_count,
                    project_path,
                }),
            };
            let rows: Vec<(String, String)> = match stmt.query_map([&native_session_id], |row| {
                let content: String = row.get(0)?;
                let role: String = row.get(1)?;
                Ok((content, role))
            }) {
                Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
                Err(_) => Vec::new(),
            };
            let pairs: Vec<(String, String)> = rows
                .into_iter()
                .map(|(content, role)| (role, content))
                .collect();
            recent_messages_from(pairs)
        };

        let first_user_raw = recent_messages
            .iter()
            .find(|(role, _)| role == "user")
            .map(|(_, text)| text.clone());

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

    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>> {
        if !file_path.exists() {
            anyhow::bail!("OpenCode database not found: {}", file_path.display());
        }

        // We need a session ID to query messages. The manager calls parse_meta first,
        // but here we don't have the cache lookup. We'll get the same most recent session.
        // Note: This means parse_messages will always return messages for the most recent session.
        // This is a limitation of the single-file approach.

        let conn = rusqlite::Connection::open(file_path)
            .context("Failed to open OpenCode SQLite database")?;

        // Detect column names
        let session_cols = get_column_names(&conn, "sessions");
        let msg_cols = get_column_names(&conn, "messages");
        let use_camel = session_cols.contains(&"createdAt".to_string());

        let updated_col = if use_camel { "updatedAt" } else if session_cols.contains(&"updated_at".to_string()) { "updated_at" } else { "createdAt" };
        let msg_session_col = if msg_cols.contains(&"sessionId".to_string()) { "sessionId" } else { "session_id" };
        let msg_seq_col = if msg_cols.contains(&"seq".to_string()) { "seq" } else { "createdAt" };
        let msg_created_col = if msg_cols.contains(&"createdAt".to_string()) { "createdAt" } else { "created_at" };

        // Get the most recent session ID
        let session_query = format!(
            "SELECT id FROM sessions ORDER BY {updated} DESC LIMIT 1",
            updated = updated_col,
        );
        let session_id: String = conn
            .query_row(&session_query, [], |row| row.get(0))
            .context("No sessions found in OpenCode database")?;

        // Query messages for this session
        let msg_query = format!(
            "SELECT role, content, {created} as ts, {seq_col} as seq \
             FROM messages \
             WHERE {session_col} = ?1 \
             ORDER BY {order_col} ASC",
            created = msg_created_col,
            seq_col = msg_seq_col,
            session_col = msg_session_col,
            order_col = msg_seq_col,
        );
        let mut stmt = conn
            .prepare(&msg_query)
            .context("Failed to prepare messages query")?;

        let messages: Vec<ParsedMessage> = stmt
            .query_map([&session_id], |row| {
                let role: String = row.get(0)?;
                let content: String = row.get(1)?;
                let ts: i64 = row.get(2)?;
                let seq: i64 = row.get(3)?;

                let ts_ms = if ts > 1_000_000_000_000 {
                    ts
                } else {
                    ts * 1000
                };

                Ok((role, content, ts_ms, seq as u32))
            })
            .context("Failed to query messages")?
            .filter_map(|r| r.ok())
            .filter(|(_, content, _, _)| !content.is_empty())
            .map(|(role, content, timestamp, seq)| {
                ParsedMessage {
                    role: role.replace("gemini", "assistant"),
                    content: strip_ansi(&content),
                    blocks: Vec::new(),
                    timestamp,
                    seq,
                }
            })
            .collect();

        Ok(messages)
    }

    fn extract_session_id(&self, file_path: &Path) -> Option<String> {
        let file_stem = file_path.file_stem()?.to_str()?;
        if file_stem == "opencode" {
            // Return a placeholder; real session IDs come from the DB
            Some("opencode".to_string())
        } else {
            None
        }
    }

    fn resume_command(&self, native_session_id: &str, _project_path: &str) -> Option<Vec<String>> {
        Some(vec!["--session".into(), native_session_id.into()])
    }
}

/// 获取 SQLite 表的列名列表
fn get_column_names(conn: &rusqlite::Connection, table: &str) -> Vec<String> {
    let query = format!("PRAGMA table_info({})", table);
    let mut stmt = match conn.prepare(&query) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = match stmt.query_map([], |row| {
        let name: String = row.get(1)?;
        Ok(name)
    }) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    rows.filter_map(|r| r.ok()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Create a minimal OpenCode SQLite fixture
    fn create_opencode_fixture(dir: &TempDir) -> PathBuf {
        let db_path = dir.path().join("opencode.db");
        let conn = rusqlite::Connection::open(&db_path).expect("Failed to create DB");

        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT,
                createdAt INTEGER,
                updatedAt INTEGER,
                projectPath TEXT
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                sessionId TEXT,
                role TEXT,
                content TEXT,
                createdAt INTEGER,
                seq INTEGER
            );
            INSERT INTO sessions (id, title, createdAt, updatedAt, projectPath)
            VALUES ('oc-session-001', 'Fix UI bug', 1736935200000, 1736938800000, '/projects/test');
            INSERT INTO messages (id, sessionId, role, content, createdAt, seq)
            VALUES ('m1', 'oc-session-001', 'user', 'The button is not rendering correctly', 1736935201000, 1);
            INSERT INTO messages (id, sessionId, role, content, createdAt, seq)
            VALUES ('m2', 'oc-session-001', 'assistant', 'Let me check the CSS. It seems like there is a z-index conflict.', 1736935202000, 2);
            INSERT INTO messages (id, sessionId, role, content, createdAt, seq)
            VALUES ('m3', 'oc-session-001', 'user', 'How do I fix the z-index?', 1736935203000, 3);
            "
        ).expect("Failed to insert fixture data");

        db_path
    }

    #[test]
    fn should_parse_meta() {
        let dir = TempDir::new().unwrap();
        let db_path = create_opencode_fixture(&dir);

        let adapter = OpenCodeAdapter;
        let meta = adapter.parse_meta(&db_path).unwrap();
        assert_eq!(meta.native_session_id, "oc-session-001");
        assert_eq!(meta.title.as_deref(), Some("Fix UI bug"));
        assert_eq!(meta.message_count, 3);
        assert!(meta.recent_messages.iter().any(|(_, t)| t.contains("button")));
        assert_eq!(meta.project_path.as_deref(), Some("/projects/test"));
    }

    #[test]
    fn should_parse_messages() {
        let dir = TempDir::new().unwrap();
        let db_path = create_opencode_fixture(&dir);

        let adapter = OpenCodeAdapter;
        let messages = adapter.parse_messages(&db_path).unwrap();
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "The button is not rendering correctly");
        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[1].content, "Let me check the CSS. It seems like there is a z-index conflict.");
        assert_eq!(messages[2].role, "user");
        assert_eq!(messages[2].content, "How do I fix the z-index?");
        assert_eq!(messages[2].seq, 3);
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
    fn should_handle_missing_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("nonexistent.db");

        let result = OpenCodeAdapter.parse_meta(&path);
        assert!(result.is_err());
    }

    #[test]
    fn should_extract_session_id() {
        let path = Path::new("opencode.db");
        let id = OpenCodeAdapter.extract_session_id(path);
        assert_eq!(id, Some("opencode".to_string()));

        let path = Path::new("other.db");
        let id = OpenCodeAdapter.extract_session_id(path);
        assert!(id.is_none());
    }
}
