//! Sync engine for deploying skills to agent tool directories via symlink or copy.

use anyhow::{Context, Result};
use std::path::Path;

/// How a skill directory is deployed to a tool's skills directory.
#[derive(Debug, Clone, Copy)]
pub enum SyncMode {
    /// Create a symbolic link to the skill directory.
    Symlink,
    /// Copy the skill directory to the target.
    Copy,
}

impl SyncMode {
    /// Return the string representation of this sync mode.
    pub fn as_str(&self) -> &'static str {
        match self {
            SyncMode::Symlink => "symlink",
            SyncMode::Copy => "copy",
        }
    }
}

/// Determine the sync mode for a tool based on configuration and defaults.
pub fn sync_mode_for_tool(tool_key: &str, configured_mode: Option<&str>) -> SyncMode {
    match configured_mode {
        Some("copy") => SyncMode::Copy,
        Some("symlink") => SyncMode::Symlink,
        _ => match tool_key {
            "cursor" => SyncMode::Copy,
            _ => SyncMode::Symlink,
        },
    }
}

/// Deploy a skill to a target directory using the specified sync mode.
pub fn sync_skill(source: &Path, target: &Path, mode: SyncMode) -> Result<SyncMode> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create parent dir {:?}", parent))?;
    }

    remove_target(target).ok();

    match mode {
        SyncMode::Symlink => {
            #[cfg(unix)]
            {
                std::os::unix::fs::symlink(source, target).with_context(|| {
                    format!("Failed to create symlink {:?} -> {:?}", target, source)
                })?;
                Ok(SyncMode::Symlink)
            }
            #[cfg(not(unix))]
            {
                copy_dir_recursive(source, target)?;
                Ok(SyncMode::Copy)
            }
        }
        SyncMode::Copy => {
            copy_dir_recursive(source, target)?;
            Ok(SyncMode::Copy)
        }
    }
}

/// Remove a deployed skill target (symlink or directory).
pub fn remove_target(target: &Path) -> Result<()> {
    if target.is_symlink() {
        std::fs::remove_file(target)?;
    } else if target.is_dir() {
        std::fs::remove_dir_all(target)?;
    } else if target.exists() {
        std::fs::remove_file(target)?;
    }
    Ok(())
}

pub(super) fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let dest_path = dst.join(entry.file_name());
        if ft.is_dir() {
            let name = entry.file_name();
            if name == ".git" {
                continue;
            }
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            std::fs::copy(entry.path(), &dest_path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn sync_mode_defaults_to_symlink() {
        assert!(matches!(
            sync_mode_for_tool("claude-code", None),
            SyncMode::Symlink
        ));
    }

    #[test]
    fn sync_mode_cursor_defaults_to_copy() {
        assert!(matches!(sync_mode_for_tool("cursor", None), SyncMode::Copy));
    }

    #[test]
    fn sync_mode_explicit_overrides() {
        assert!(matches!(
            sync_mode_for_tool("claude-code", Some("copy")),
            SyncMode::Copy
        ));
        assert!(matches!(
            sync_mode_for_tool("cursor", Some("symlink")),
            SyncMode::Symlink
        ));
    }

    #[test]
    fn sync_skill_copy_creates_target() {
        let tmp = tempdir().unwrap();
        let src = tmp.path().join("source");
        let tgt = tmp.path().join("target");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("SKILL.md"), "# hello").unwrap();
        let mode = sync_skill(&src, &tgt, SyncMode::Copy).unwrap();
        assert!(matches!(mode, SyncMode::Copy));
        assert!(tgt.join("SKILL.md").exists());
    }

    #[cfg(not(unix))]
    #[test]
    fn sync_skill_symlink_falls_back_to_copy_on_windows() {
        let tmp = tempdir().unwrap();
        let src = tmp.path().join("source");
        let tgt = tmp.path().join("target");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("SKILL.md"), "# hello").unwrap();
        let mode = sync_skill(&src, &tgt, SyncMode::Symlink).unwrap();
        assert!(matches!(mode, SyncMode::Copy));
    }

    #[test]
    fn sync_skill_replaces_existing() {
        let tmp = tempdir().unwrap();
        let src = tmp.path().join("source");
        let tgt = tmp.path().join("target");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("new.md"), "new").unwrap();
        fs::create_dir_all(&tgt).unwrap();
        fs::write(tgt.join("old.md"), "old").unwrap();
        sync_skill(&src, &tgt, SyncMode::Copy).unwrap();
        assert!(tgt.join("new.md").exists());
        assert!(!tgt.join("old.md").exists());
    }

    #[test]
    fn remove_target_removes_dir() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("rm");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("f.txt"), "d").unwrap();
        remove_target(&dir).unwrap();
        assert!(!dir.exists());
    }

    #[test]
    fn copy_dir_recursive_skips_git() {
        let tmp = tempdir().unwrap();
        let src = tmp.path().join("src");
        fs::create_dir_all(src.join(".git")).unwrap();
        fs::write(src.join(".git/config"), "g").unwrap();
        fs::write(src.join("file.md"), "c").unwrap();
        let dst = tmp.path().join("dst");
        copy_dir_recursive(&src, &dst).unwrap();
        assert!(!dst.join(".git").exists());
        assert!(dst.join("file.md").exists());
    }

    #[test]
    fn remove_target_nonexistent_is_ok() {
        let tmp = tempdir().unwrap();
        assert!(remove_target(&tmp.path().join("x")).is_ok());
    }
}
