//! Database path resolution and legacy database migration.
//!
//! The library database was historically named `skills.db`. It has been
//! renamed to `neeko.db` to reflect its broader scope (skills + MCP +
//! prompts + actions). On first launch, if `neeko.db` does not exist but
//! `skills.db` exists, the old file is renamed in-place.

use std::path::PathBuf;

/// Base directory for the skills central repo: `~/.neeko/`.
///
/// **不是**库目录 —— 版本化 SQLite 库可能被 `NEEKO_DB_DIR` 指向别处，见
/// [`crate::common::paths::db_dir`]。这个函数服务于 skills git 仓库等无版本门禁的状态。
#[must_use]
pub fn base_dir() -> PathBuf {
    crate::common::paths::app_dir()
}

/// Current database path（默认 `~/.neeko/neeko.db`，可被 `NEEKO_DB_DIR` 覆写）。
#[must_use]
pub fn db_path() -> PathBuf {
    crate::common::paths::library_db_path()
}

/// Legacy database path（与 [`db_path`] 同目录：`skills.db`）。
#[must_use]
pub fn legacy_db_path() -> PathBuf {
    crate::common::paths::db_dir().join("skills.db")
}

/// Ensure the库目录 exists, and migrate `skills.db` → `neeko.db` if needed.
/// Idempotent: safe to call on every startup.
pub fn ensure_db_ready() -> anyhow::Result<()> {
    std::fs::create_dir_all(crate::common::paths::db_dir())?;

    let new = db_path();
    let old = legacy_db_path();

    if !new.exists() && old.exists() {
        std::fs::rename(&old, new)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn library_db_lives_in_the_resolved_db_dir() {
        let db_dir = crate::common::paths::db_dir();
        assert_eq!(db_path(), db_dir.join("neeko.db"));
        assert_eq!(legacy_db_path(), db_dir.join("skills.db"));
        // 默认（无 `NEEKO_DB_DIR`）时库目录就是 app 数据根
        assert!(base_dir().ends_with(".neeko"));
    }
}
