//! Scan agent tool directories for unmanaged skill directories.

use anyhow::Result;

use crate::agent::path_resolver::PathResolver;
use crate::agent::plugin::AgentPlugin;

use super::content_hash;
use super::skill_metadata;

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

/// Scan given plugins' home-level skills directories for unmanaged skill directories.
pub fn scan_local_skills(
    managed_paths: &[String],
    plugins: &[AgentPlugin],
) -> Result<Vec<DiscoveredSkill>> {
    let mut discovered = Vec::new();
    let resolver = PathResolver::new(None);

    for plugin in plugins {
        if !resolver.is_installed(plugin) {
            continue;
        }
        let skills_dir = resolver.resolve_home_skills_dir(plugin);
        if !skills_dir.exists() {
            continue;
        }
        scan_skill_dir(&skills_dir, &mut discovered, managed_paths, &plugin.id);
    }
    Ok(discovered)
}

fn scan_skill_dir(
    dir: &std::path::Path,
    discovered: &mut Vec<DiscoveredSkill>,
    managed_paths: &[String],
    tool_key: &str,
) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
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
            tool: tool_key.to_string(),
            found_path: path_str,
            name_guess: Some(name),
            fingerprint,
        });
    }
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

    #[test]
    fn scan_local_skills_finds_unmanaged() {
        let tmp = tempdir().unwrap();
        let skills_dir = tmp.path().join("skills");
        let managed_dir = skills_dir.join("managed-skill");
        let unmanaged_dir = skills_dir.join("unmanaged-skill");

        fs::create_dir_all(&managed_dir).unwrap();
        fs::create_dir_all(&unmanaged_dir).unwrap();
        fs::write(managed_dir.join("SKILL.md"), "# Managed").unwrap();
        fs::write(unmanaged_dir.join("SKILL.md"), "# Unmanaged").unwrap();

        // Build a minimal plugin pointing at our temp skills dir
        let plugin = crate::agent::plugin::AgentPlugin {
            id: "test-agent".into(),
            name: "Test Agent".into(),
            icon: None,
            description: None,
            version: "1.0".into(),
            is_builtin: false,
            enabled: true,
            execution: crate::agent::plugin::AgentExecution {
                command: "test".into(),
                args: vec![],
                env: std::collections::HashMap::new(),
                prompt_args: None,
                post_prompt_args: None,
                detection: None,
            },
            configuration: crate::agent::plugin::AgentConfiguration::default(),
            capabilities: crate::agent::plugin::AgentCapabilities::default(),
            paths: crate::agent::plugin::AgentResourcePaths {
                config: crate::agent::plugin::PathTemplate {
                    relative: skills_dir.to_string_lossy().to_string(),
                    format: "directory".into(),
                    description: None,
                    project_level: false,
                },
                skills: crate::agent::plugin::PathTemplate {
                    relative: skills_dir.to_string_lossy().to_string(),
                    format: "directory".into(),
                    description: None,
                    project_level: false,
                },
                commands: crate::agent::plugin::PathTemplate {
                    relative: skills_dir.to_string_lossy().to_string(),
                    format: "markdown".into(),
                    description: None,
                    project_level: false,
                },
                mcp: crate::agent::plugin::PathTemplate {
                    relative: skills_dir.to_string_lossy().to_string(),
                    format: "json".into(),
                    description: None,
                    project_level: false,
                },
                hooks: crate::agent::plugin::PathTemplate {
                    relative: skills_dir.to_string_lossy().to_string(),
                    format: "script".into(),
                    description: None,
                    project_level: false,
                },
                plugins: crate::agent::plugin::PathTemplate {
                    relative: skills_dir.to_string_lossy().to_string(),
                    format: "directory".into(),
                    description: None,
                    project_level: false,
                },
                secrets: None,
            },
            lifecycle: None,
        };

        let managed_paths = vec![managed_dir.to_string_lossy().to_string()];
        let discovered = scan_local_skills(&managed_paths, &[plugin]).unwrap();
        assert_eq!(discovered.len(), 1);
        assert_eq!(discovered[0].tool, "test-agent");
        assert!(discovered[0].found_path.contains("unmanaged-skill"));
    }
}
