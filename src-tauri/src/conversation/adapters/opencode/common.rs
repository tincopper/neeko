//! opencode 适配器内部共享的常量与小工具（v1 / v2 两条读取路径都用）。
//!
//! 这里只放「两种布局都一样」的事实：会话标识是合成路径、预览条数、时间戳单位、
//! `session.model` 的 JSON 形态。

use std::path::{Path, PathBuf};

/// Maximum number of preview messages to load from the database.
pub(super) const PREVIEW_LIMIT: u32 = 5;

/// Only the N most recently updated sessions get COUNT + preview joins.
/// Older sessions stay light (title/time only) so list scan stays responsive
/// even when `opencode.db` is multi-GB.
pub(super) const PREVIEW_ENRICH_LIMIT: usize = 80;

/// Separator between DB path and session ID in synthetic file paths
pub(super) const SYNTHETIC_SEP: char = '#';

pub(super) fn matches_db_pattern(filename: &str) -> bool {
    filename.starts_with("opencode") && filename.ends_with(".db")
}

/// Split a synthetic path `<dbPath>#<sessionId>` into its components.
pub(super) fn split_synthetic_path(path: &Path) -> Option<(PathBuf, String)> {
    let path_str = path.to_string_lossy();
    let (db_part, session_id) = path_str.rsplit_once(SYNTHETIC_SEP)?;
    if db_part.is_empty() || session_id.is_empty() {
        return None;
    }
    Some((PathBuf::from(db_part), session_id.to_string()))
}

/// Extract model ID from OpenCode's JSON model column.
///
/// Supports two formats:
/// - `{"id": "glm-5.2", "providerID": "zai-coding-plan"}`
/// - `{"modelID": "claude-sonnet-4-5"}`
pub(super) fn extract_model_id_from_json(json_str: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(json_str).ok()?;
    value
        .get("id")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("modelID").and_then(|v| v.as_str()))
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Normalize timestamp to milliseconds.
pub(super) const fn normalize_timestamp(ts: i64) -> i64 {
    if ts > 1_000_000_000_000 {
        ts
    } else {
        ts * 1000
    }
}
