//! Database path resolution and legacy database migration.
//!
//! The library database was historically named `skills.db`. It has been
//! renamed to `neeko.db` to reflect its broader scope (skills + MCP +
//! prompts + actions). On first launch, if `neeko.db` does not exist but
//! `skills.db` exists, the old file is renamed in-place.

use std::path::PathBuf;

/// Base directory for the library system: `~/.neeko/`.
#[must_use]
pub fn base_dir() -> PathBuf {
    dirs::home_dir()
        .expect("Cannot determine home directory")
        .join(".neeko")
}

/// Current database path: `~/.neeko/neeko.db`.
#[must_use]
pub fn db_path() -> PathBuf {
    base_dir().join("neeko.db")
}

/// Legacy database path: `~/.neeko/skills.db`.
#[must_use]
pub fn legacy_db_path() -> PathBuf {
    base_dir().join("skills.db")
}

/// Ensure the `~/.neeko/` directory exists, and migrate `skills.db` → `neeko.db`
/// if needed. Idempotent: safe to call on every startup.
pub fn ensure_db_ready() -> anyhow::Result<()> {
    std::fs::create_dir_all(base_dir())?;

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
    fn paths_are_under_neeko_dir() {
        assert!(base_dir().ends_with(".neeko"));
        assert!(db_path().ends_with(".neeko/neeko.db"));
        assert!(legacy_db_path().ends_with(".neeko/skills.db"));
    }
}
