//! OpenCode 会话适配器（`~/.local/share/opencode/opencode*.db`）。
//!
//! **两套布局共存**：v1 = `session` / `message` / `part`（升级后的迁移快照），
//! v2 = `session_v2` / `session_message`（升级后唯一被写入的）。判据在 `store.rs`，
//! 读取实现分别是 `v1.rs`（保持历史行为）与 `v2.rs`（新布局）；本文件只做 trait 实现与分派。
//!
//! 会话标识是合成路径 `<dbPath>#<sessionId>`，不是真实文件。判据与事故背景见
//! `.trellis/spec/backend/conversation-adapter.md` §4.3.3。

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use self::common::{matches_db_pattern, split_synthetic_path, SYNTHETIC_SEP};
use self::store::Store;
use self::v1::{parse_messages_v1, parse_opencode_db, parse_opencode_session};
use crate::conversation::adapter::{
    AgentSessionAdapter, ParsedMessage, ParsedMeta, SessionDeleteSupport,
};

mod common;
mod store;
mod v1;
mod v2;

#[cfg(test)]
mod tests;

/// Pattern for OpenCode SQLite database filenames
const DB_PATTERN: &str = "opencode*.db";

/// SQLite 侧文件：WAL 模式下的提交先落在这里（参与扫描指纹）。
const SQLITE_SIDECARS: &[&str] = &["-wal"];

/// OpenCode 会话适配器
///
/// 会话格式：`~/.local/share/opencode/opencode*.db`
/// - 单 SQLite 文件存储所有会话
/// - **两套布局共存**：v1 = `session` / `message` / `part`（迁移快照），
///   v2 = `session_v2` / `session_message`（升级后唯一写入的）。由 `store::detect` 判定，
///   v1 的读取逻辑保持原样（判据见 `conversation-adapter.md` §4.3.3）。
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
        self.parse_all_metas_for_project(None)
    }

    fn parse_all_metas_for_project(
        &self,
        project_path: Option<&str>,
    ) -> Option<Result<Vec<(ParsedMeta, PathBuf)>>> {
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

            // Full-DB fingerprint only applies when no project filter (filter changes result set).
            if project_path.is_none() {
                // SQLite 的 WAL 侧文件也参与指纹：新提交先落 `-wal`，只盯主文件会命中旧快照。
                if let Some(sig) = crate::conversation::scan_cache::source_signature_with_sidecars(
                    path,
                    SQLITE_SIDECARS,
                ) {
                    if let Some(cached) =
                        crate::conversation::scan_cache::get_cached_bulk_metas(path, &sig)
                    {
                        results.extend(cached);
                        continue;
                    }

                    match read_db(path, None) {
                        Ok(sessions) => {
                            crate::conversation::scan_cache::put_cached_bulk_metas(
                                path.to_path_buf(),
                                sig,
                                sessions.clone(),
                            );
                            results.extend(sessions);
                        }
                        Err(e) => {
                            log::error!("Failed to parse OpenCode DB {}: {e}", path.display());
                        }
                    }
                    continue;
                }
            }

            match read_db(path, project_path) {
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
            let (conn, store) = store::open_detected(&db_path)?;
            return match store {
                Store::V1 => parse_opencode_session(&conn, &session_id),
                Store::V2 => v2::parse_session_meta(&conn, &session_id),
            };
        }
        anyhow::bail!(
            "OpenCode adapter requires parse_all_metas; parse_meta called with: {}",
            file_path.display()
        );
    }

    fn parse_messages(&self, file_path: &Path) -> Result<Vec<ParsedMessage>> {
        let (db_path, session_id) = split_synthetic_path(file_path)
            .context("Invalid synthetic path; expected <dbPath>#<sessionId>")?;
        let (conn, store) = store::open_detected(&db_path)?;
        match store {
            Store::V1 => parse_messages_v1(&conn, &session_id),
            Store::V2 => v2::parse_messages(&conn, &session_id),
        }
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

    /// 委派 `opencode session delete <id>`：SQLite 行 + 子会话级联由 opencode 自己处理。
    ///
    /// Neeko 读的就是同一个 `opencode*.db`（同一处存储）—— 这是可以委派的前提
    /// （qoder 就是反例：CLI 用 `~/.qoder/`，Neeko 读 `~/.qodercli/projects/`）。
    fn delete_support(&self) -> SessionDeleteSupport {
        SessionDeleteSupport::Native
    }

    fn delete_command(
        &self,
        native_session_id: &str,
        _project_path: Option<&str>,
        _file_path: &Path,
    ) -> Option<Vec<String>> {
        Some(vec![
            "opencode".to_string(),
            "session".to_string(),
            "delete".to_string(),
            native_session_id.to_string(),
        ])
    }
}

/// 打开 DB 并按存储布局分派。判据见 `store.rs`，分派点全仓仅此一处。
pub(super) fn read_db(
    db_path: &Path,
    project_path: Option<&str>,
) -> Result<Vec<(ParsedMeta, PathBuf)>> {
    let (conn, store) = store::open_detected(db_path)?;
    match store {
        Store::V1 => parse_opencode_db(&conn, db_path, project_path),
        Store::V2 => v2::parse_db(&conn, db_path, project_path),
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
