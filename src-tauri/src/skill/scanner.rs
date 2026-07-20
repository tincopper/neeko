//! Scan agent tool directories for unmanaged skill directories.

use anyhow::Result;

use super::content_hash;
use super::skill_metadata;
use super::tool_adapters;

/// An unmanaged skill directory found outside the central repository.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DiscoveredSkill {
    /// Unique identifier for this discovery.
    pub id: String,
    /// Source tool key.
    pub tool: String,
    /// Absolute path where the skill was found.
    pub found_path: String,
    /// Inferred name from the directory.
    pub name_guess: Option<String>,
    /// Optional content hash fingerprint.
    pub fingerprint: Option<String>,
}

/// Scan all tool directories for unmanaged skill directories.
pub fn scan_local_skills(managed_paths: &[String]) -> Result<Vec<DiscoveredSkill>> {
    let adapters = tool_adapters::default_tool_adapters();
    let mut discovered = Vec::new();

    for adapter in &adapters {
        if !adapter.is_installed() {
            continue;
        }
        for scan_dir in adapter.all_scan_dirs() {
            if !scan_dir.exists() {
                continue;
            }
            let entries = match std::fs::read_dir(&scan_dir) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                if is_symlink_to_central(&path) {
                    continue;
                }
                let path_str = path.to_string_lossy().to_string();
                if managed_paths.contains(&path_str) {
                    continue;
                }
                if !skill_metadata::is_valid_skill_dir(&path) {
                    continue;
                }

                let name = skill_metadata::infer_skill_name(&path);
                let fingerprint = content_hash::hash_directory(&path).ok();

                discovered.push(DiscoveredSkill {
                    id: uuid::Uuid::new_v4().to_string(),
                    tool: adapter.key.clone(),
                    found_path: path_str,
                    name_guess: Some(name),
                    fingerprint,
                });
            }
        }
    }
    Ok(discovered)
}

fn is_symlink_to_central(path: &std::path::Path) -> bool {
    if let Ok(target) = std::fs::read_link(path) {
        let central = super::central_repo::skills_dir();
        return target.starts_with(&central);
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn scan_finds_skill_dirs() {
        let tmp = tempdir().unwrap();
        let skill_dir = tmp.path().join("my-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "content").unwrap();
        assert!(skill_metadata::is_valid_skill_dir(&skill_dir));
    }

    #[test]
    fn scan_ignores_non_skill_dirs() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("not-a-skill");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("random.txt"), "hello").unwrap();
        assert!(!skill_metadata::is_valid_skill_dir(&dir));
    }
}
