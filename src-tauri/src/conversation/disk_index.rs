//! Cold-start conversation meta index under `~/.neeko/`.
//!
//! Layering:
//! - **Disk index** (this module): cold start for list page 0 before scan.
//! - **Process scan_cache**: hot fingerprint reuse during scan parse.
//! - **Manager memory cache**: authoritative in-process list/search source.
//!
//! Agent native files remain Source of Truth. This index is a best-effort
//! acceleration layer and may be stale until the next scan.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::conversation::types::ConversationMeta;

const INDEX_VERSION: u32 = 1;
const INDEX_FILE_NAME: &str = "conversation-index.json";

/// On-disk envelope for the conversation meta index.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationDiskIndex {
    /// Schema version for forward migrations.
    pub version: u32,
    /// Unix ms when the index was last written.
    pub updated_at: i64,
    /// Flattened conversation metas (same shape as memory cache values).
    pub conversations: Vec<ConversationMeta>,
}

impl ConversationDiskIndex {
    /// Build a new index envelope with the current schema version and timestamp.
    pub fn new(conversations: Vec<ConversationMeta>) -> Self {
        Self {
            version: INDEX_VERSION,
            updated_at: chrono::Utc::now().timestamp_millis(),
            conversations,
        }
    }
}

/// Default index path: `~/.neeko/conversation-index.json`.
pub fn default_index_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".neeko")
        .join(INDEX_FILE_NAME)
}

/// Load index from disk. Missing file → empty `Ok(None)`.
pub fn load_index(path: &Path) -> Result<Option<ConversationDiskIndex>> {
    if !path.is_file() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path)
        .with_context(|| format!("read conversation index {}", path.display()))?;
    let index: ConversationDiskIndex = serde_json::from_str(&raw)
        .with_context(|| format!("parse conversation index {}", path.display()))?;
    if index.version > INDEX_VERSION {
        log::warn!(
            "conversation index version {} newer than supported {}; ignoring",
            index.version,
            INDEX_VERSION
        );
        return Ok(None);
    }
    Ok(Some(index))
}

/// Atomically-ish write index (write temp then rename).
pub fn save_index(path: &Path, index: &ConversationDiskIndex) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("create index dir {}", parent.display()))?;
    }
    let tmp = path.with_extension("json.tmp");
    let raw = serde_json::to_string(index).context("serialize conversation index")?;
    fs::write(&tmp, raw).with_context(|| format!("write temp index {}", tmp.display()))?;
    fs::rename(&tmp, path)
        .with_context(|| format!("rename temp index onto {}", path.display()))?;
    Ok(())
}

/// Convenience: load default path.
pub fn load_default_index() -> Result<Option<ConversationDiskIndex>> {
    load_index(&default_index_path())
}

/// Convenience: save to default path.
pub fn save_default_index(conversations: Vec<ConversationMeta>) -> Result<()> {
    let index = ConversationDiskIndex::new(conversations);
    save_index(&default_index_path(), &index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn sample_meta(id: &str) -> ConversationMeta {
        ConversationMeta {
            id: id.to_string(),
            native_session_id: "n1".into(),
            agent_id: "claude-code".into(),
            title: "t".into(),
            model: None,
            started_at: 1,
            updated_at: 2,
            message_count: 1,
            preview: "p".into(),
            file_path: PathBuf::from("/tmp/a.jsonl"),
            project_path: Some("/proj".into()),
            user_title: None,
            tags: vec![],
            supports_resume: false,
        }
    }

    #[test]
    fn save_and_load_roundtrip() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(INDEX_FILE_NAME);
        let index = ConversationDiskIndex::new(vec![sample_meta("claude-code:n1")]);
        save_index(&path, &index).unwrap();
        let loaded = load_index(&path).unwrap().expect("index exists");
        assert_eq!(loaded.version, INDEX_VERSION);
        assert_eq!(loaded.conversations.len(), 1);
        assert_eq!(loaded.conversations[0].id, "claude-code:n1");
    }

    #[test]
    fn missing_file_returns_none() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("nope.json");
        assert!(load_index(&path).unwrap().is_none());
    }
}
