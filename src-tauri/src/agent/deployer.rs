//! Unified deployment engine for deploying resources to Agent skill directories.
//!
//! Provides a single `ResourceDeployer` trait that handles all resource types
//! (skills, prompts, actions, mcp, commands). Replaces the ad-hoc deployment
//! logic that was spread across `skill/commands.rs` and `skill/sync_engine.rs`.

use std::path::Path;

use super::path_resolver::PathResolver;
use super::plugin::AgentPlugin;
use crate::common::agent::types::AgentConfig;

/// Scope of a deployment target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeployScope {
    /// Global agent skill directory (~/.agent/skills).
    Global,
    /// Project-local agent skill directory (.agent/skills).
    Project,
}

/// A deployment target: where to deploy a resource.
#[derive(Debug, Clone)]
pub struct DeployTarget {
    /// Project path (required for project-level deployment).
    pub project_path: std::path::PathBuf,
    /// Agent ID.
    pub agent_id: String,
    /// Deployment scope.
    pub scope: DeployScope,
}

/// Result of a deploy operation.
#[derive(Debug, Clone)]
pub struct DeployResult {
    /// Whether the operation succeeded.
    pub success: bool,
    /// The target path that was created/modified.
    pub target_path: String,
    /// Actual sync mode used (symlink or copy).
    pub mode: String,
    /// Error message if failed.
    pub error: Option<String>,
}

/// Unified resource deployment interface.
///
/// Implementations handle the actual file system operations (symlink / copy)
/// for deploying a resource to an Agent's skills directory.
pub trait ResourceDeployer: Send + Sync {
    /// Deploy a resource to the target Agent directory.
    fn deploy(
        &self,
        source: &Path,
        plugin: &AgentPlugin,
        target: &DeployTarget,
    ) -> Result<DeployResult, crate::AppError>;

    /// Remove a deployed resource from the target Agent directory.
    fn remove(
        &self,
        resource_name: &str,
        plugin: &AgentPlugin,
        target: &DeployTarget,
    ) -> Result<(), crate::AppError>;
}

/// Default deployer that uses the sync engine (symlink or copy).
pub struct DefaultDeployer {
    /// Override path templates per agent (from AgentConfig.skill_path overrides).
    overrides: std::collections::HashMap<String, String>,
}

impl DefaultDeployer {
    /// Create a new DefaultDeployer.
    #[must_use]
    pub fn new() -> Self {
        Self {
            overrides: std::collections::HashMap::new(),
        }
    }

    /// Set a path override for a specific agent.
    #[must_use]
    pub fn with_override(mut self, agent_id: &str, path: &str) -> Self {
        self.overrides
            .insert(agent_id.to_string(), path.to_string());
        self
    }

    /// Build a deployer from the current AgentManager state.
    #[must_use]
    pub fn from_agent_configs(agent_configs: &[AgentConfig]) -> Self {
        let mut deployer = Self::new();
        for agent in agent_configs {
            if let Some(ref sp) = agent.skill_path {
                if !sp.trim().is_empty() {
                    deployer = deployer.with_override(&agent.id, sp);
                }
            }
        }
        deployer
    }
}

impl Default for DefaultDeployer {
    fn default() -> Self {
        Self::new()
    }
}

impl ResourceDeployer for DefaultDeployer {
    fn deploy(
        &self,
        source: &Path,
        plugin: &AgentPlugin,
        target: &DeployTarget,
    ) -> Result<DeployResult, crate::AppError> {
        if !source.exists() {
            return Err(crate::AppError::NotFound(format!(
                "Source path not found: {}",
                source.display()
            )));
        }

        let resolver =
            PathResolver::new(Some(&target.project_path)).with_agent_id(&target.agent_id);

        let skills_dir = match target.scope {
            DeployScope::Project => resolver.resolve_skills_dir(
                plugin,
                self.overrides.get(&target.agent_id).map(String::as_str),
            ),
            DeployScope::Global => {
                // Global: use home-relative path without project substitution
                let home_resolver = PathResolver::new(None).with_agent_id(&target.agent_id);
                home_resolver.resolve_skills_dir(
                    plugin,
                    self.overrides.get(&target.agent_id).map(String::as_str),
                )
            }
        };

        let dest = skills_dir.join(
            source
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .as_ref(),
        );

        // Determine sync mode (Cursor defaults to copy, others symlink).
        let mode = crate::library::skill::sync_engine::sync_mode_for_tool(&plugin.id, None);

        // Ensure parent dir exists
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                crate::AppError::Io(format!("Failed to create parent dir {:?}: {}", parent, e))
            })?;
        }

        let actual_mode = crate::library::skill::sync_engine::sync_skill(source, &dest, mode)
            .map_err(|e| crate::AppError::Skill(format!("Deploy failed: {e}")))?;

        Ok(DeployResult {
            success: true,
            target_path: dest.to_string_lossy().to_string(),
            mode: actual_mode.as_str().to_string(),
            error: None,
        })
    }

    fn remove(
        &self,
        resource_name: &str,
        plugin: &AgentPlugin,
        target: &DeployTarget,
    ) -> Result<(), crate::AppError> {
        let resolver =
            PathResolver::new(Some(&target.project_path)).with_agent_id(&target.agent_id);

        let skills_dir = match target.scope {
            DeployScope::Project => resolver.resolve_skills_dir(
                plugin,
                self.overrides.get(&target.agent_id).map(String::as_str),
            ),
            DeployScope::Global => {
                let home_resolver = PathResolver::new(None).with_agent_id(&target.agent_id);
                home_resolver.resolve_skills_dir(
                    plugin,
                    self.overrides.get(&target.agent_id).map(String::as_str),
                )
            }
        };

        let target_path = skills_dir.join(resource_name);
        crate::library::skill::sync_engine::remove_target(&target_path)
            .map_err(|e| crate::AppError::Skill(format!("Remove failed: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::registry::default_agent_plugins;
    use crate::library::skill::sync_engine::SyncMode;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn deploy_creates_symlink_or_copy() {
        let tmp = tempdir().unwrap();
        let source = tmp.path().join("my-skill");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("SKILL.md"), "# Test skill").unwrap();

        let project = tmp.path().join("project");
        fs::create_dir_all(&project).unwrap();

        let plugin = default_agent_plugins()
            .into_iter()
            .find(|p| p.id == "claude-code")
            .unwrap();

        let deployer = DefaultDeployer::new();
        let target = DeployTarget {
            project_path: project.clone(),
            agent_id: "claude-code".to_string(),
            scope: DeployScope::Project,
        };

        let result = deployer.deploy(&source, &plugin, &target).unwrap();
        assert!(result.success);
        let deployed_path = std::path::PathBuf::from(&result.target_path);
        assert!(deployed_path.exists());
        assert!(deployed_path.join("SKILL.md").exists());
    }

    #[test]
    fn deploy_fails_for_missing_source() {
        let tmp = tempdir().unwrap();
        let project = tmp.path().join("project");
        fs::create_dir_all(&project).unwrap();

        let plugin = default_agent_plugins()
            .into_iter()
            .find(|p| p.id == "claude-code")
            .unwrap();

        let deployer = DefaultDeployer::new();
        let target = DeployTarget {
            project_path: project.clone(),
            agent_id: "claude-code".to_string(),
            scope: DeployScope::Project,
        };

        let result = deployer.deploy(&tmp.path().join("nonexistent"), &plugin, &target);
        assert!(result.is_err());
    }

    #[test]
    fn remove_deletes_deployed_resource() {
        let tmp = tempdir().unwrap();
        let source = tmp.path().join("my-skill");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("SKILL.md"), "# Test skill").unwrap();

        let project = tmp.path().join("project");
        fs::create_dir_all(&project).unwrap();

        let plugin = default_agent_plugins()
            .into_iter()
            .find(|p| p.id == "claude-code")
            .unwrap();

        let deployer = DefaultDeployer::new();
        let target = DeployTarget {
            project_path: project.clone(),
            agent_id: "claude-code".to_string(),
            scope: DeployScope::Project,
        };

        deployer.deploy(&source, &plugin, &target).unwrap();
        let skills_dir = project.join(".claude/skills");
        assert!(skills_dir.join("my-skill").exists());

        deployer.remove("my-skill", &plugin, &target).unwrap();
        assert!(!skills_dir.join("my-skill").exists());
    }

    #[test]
    fn deploy_with_override_path() {
        let tmp = tempdir().unwrap();
        let source = tmp.path().join("my-skill");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("SKILL.md"), "# Test skill").unwrap();

        let project = tmp.path().join("project");
        fs::create_dir_all(&project).unwrap();

        let custom_dir = tmp.path().join("custom-skills");
        fs::create_dir_all(&custom_dir).unwrap();

        let plugin = default_agent_plugins()
            .into_iter()
            .find(|p| p.id == "claude-code")
            .unwrap();

        let deployer = DefaultDeployer::new();
        // Test that override path is stored
        let deployer = deployer.with_override("claude-code", custom_dir.to_str().unwrap());

        let target = DeployTarget {
            project_path: project.clone(),
            agent_id: "claude-code".to_string(),
            scope: DeployScope::Global,
        };

        let result = deployer.deploy(&source, &plugin, &target).unwrap();
        assert!(result.success);
        assert!(custom_dir.join("my-skill").exists());
    }

    #[test]
    fn sync_mode_for_cursor_is_copy() {
        let mode = crate::library::skill::sync_engine::sync_mode_for_tool("cursor", None);
        assert!(matches!(mode, SyncMode::Copy));
    }

    #[test]
    fn sync_mode_for_claude_is_symlink() {
        let mode = crate::library::skill::sync_engine::sync_mode_for_tool("claude-code", None);
        assert!(matches!(mode, SyncMode::Symlink));
    }
}
