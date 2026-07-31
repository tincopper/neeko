//! Path resolution engine for AgentPlugin path templates.
//!
//! Resolves template variables ({{home}}, {{projectPath}}, {{agentId}}, {{configDir}})
//! to absolute paths. This is the single source of truth for all path resolution.

use std::path::{Path, PathBuf};

use super::plugin::{AgentPlugin, PathTemplate};

/// Context for resolving path templates.
pub struct PathResolver {
    home_dir: PathBuf,
    project_path: Option<PathBuf>,
    agent_id: Option<String>,
}

impl PathResolver {
    /// Create a new PathResolver.
    #[must_use]
    pub fn new(project_path: Option<&Path>) -> Self {
        Self {
            home_dir: dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
            project_path: project_path.map(|p| p.to_path_buf()),
            agent_id: None,
        }
    }

    /// Set the agent ID for {{agentId}} substitution.
    #[must_use]
    pub fn with_agent_id(mut self, agent_id: &str) -> Self {
        self.agent_id = Some(agent_id.to_string());
        self
    }

    /// Set the project path.
    #[must_use]
    pub fn with_project_path(mut self, project_path: &Path) -> Self {
        self.project_path = Some(project_path.to_path_buf());
        self
    }

    /// Resolve a path template to an absolute path.
    #[must_use]
    pub fn resolve(&self, template: &PathTemplate) -> PathBuf {
        self.resolve_str(&template.relative)
    }

    /// Resolve a raw template string.
    #[must_use]
    pub fn resolve_str(&self, template: &str) -> PathBuf {
        let mut result = template.to_string();

        // Replace {{home}}
        result = result.replace("{{home}}", &self.home_dir.to_string_lossy());

        // Replace {{projectPath}}
        if let Some(ref pp) = self.project_path {
            result = result.replace("{{projectPath}}", &pp.to_string_lossy());
        }

        // Replace {{agentId}}
        if let Some(ref aid) = self.agent_id {
            result = result.replace("{{agentId}}", aid);
        }

        // Replace {{configDir}}
        if let Some(config_dir) = dirs::config_dir() {
            result = result.replace("{{configDir}}", &config_dir.to_string_lossy());
        }

        // Expand leading ~ if still present (fallback)
        if result.starts_with("~/") {
            let rest = result.trim_start_matches("~/");
            return self.home_dir.join(rest);
        }
        if result == "~" {
            return self.home_dir.clone();
        }

        // Handle fullwidth tilde / wave dash (IME-friendly)
        if let Some(rest) = result.strip_prefix('\u{FF5E}') {
            if rest.starts_with('/') || rest.is_empty() {
                let rest = rest.trim_start_matches('/');
                if rest.is_empty() {
                    return self.home_dir.clone();
                }
                return self.home_dir.join(rest);
            }
        }
        if let Some(rest) = result.strip_prefix('\u{301C}') {
            if rest.starts_with('/') || rest.is_empty() {
                let rest = rest.trim_start_matches('/');
                if rest.is_empty() {
                    return self.home_dir.clone();
                }
                return self.home_dir.join(rest);
            }
        }

        PathBuf::from(result)
    }

    /// Get the skills directory for a plugin.
    #[must_use]
    pub fn resolve_skills_dir(&self, plugin: &AgentPlugin, override_path: Option<&str>) -> PathBuf {
        let template = plugin.skills_path_template(override_path);
        self.resolve(&template)
    }

    /// Resolve a plugin's skills directory at the **home** level (no project path).
    ///
    /// Used for scanning/syncing unmanaged skills in the global agent directory.
    /// If the plugin's skills path is `{{projectPath}}/.claude/skills`, this returns
    /// `~/.claude/skills` (by stripping the `{{projectPath}}/` prefix and joining with `{{home}}`).
    #[must_use]
    pub fn resolve_home_skills_dir(&self, plugin: &AgentPlugin) -> PathBuf {
        self.resolve_home_dir(&plugin.paths.skills.relative)
    }

    /// Resolve a plugin's resource directory at the **home** level for a given resource type.
    #[must_use]
    pub fn resolve_home_dir(&self, template: &str) -> PathBuf {
        // Strip {{projectPath}}/ prefix to get the relative portion
        let relative = template
            .strip_prefix("{{projectPath}}/")
            .or_else(|| template.strip_prefix("{{projectPath}}\\"))
            .unwrap_or(template);

        // Now resolve the relative portion against {{home}}
        if relative.starts_with("~/") {
            let rest = relative.trim_start_matches("~/");
            return self.home_dir.join(rest);
        }
        if let Some(rest) = relative.strip_prefix("{{home}}/") {
            return self.home_dir.join(rest);
        }
        if relative == "{{home}}" {
            return self.home_dir.clone();
        }

        // For relative paths like ".claude/skills", join with home
        // (handles the case where skills path is relative without ~ or {{home}})
        if !relative.starts_with('/') && !relative.starts_with("~") {
            return self.home_dir.join(relative);
        }

        PathBuf::from(relative)
    }

    /// Build a scan target from a plugin at the home level.
    ///
    /// Returns `None` if the plugin has no detectable skills directory.
    #[must_use]
    pub fn home_scan_target(&self, plugin: &AgentPlugin) -> Option<super::plugin::PathTemplate> {
        let home_dir = self.resolve_home_skills_dir(plugin);
        Some(super::plugin::PathTemplate {
            relative: home_dir.to_string_lossy().to_string(),
            format: plugin.paths.skills.format.clone(),
            description: plugin.paths.skills.description.clone(),
            project_level: false,
        })
    }

    /// Get all resource paths for a plugin (global + project-level).
    #[must_use]
    pub fn resolve_all_paths(&self, plugin: &AgentPlugin) -> Vec<(String, PathBuf, bool)> {
        let mut results = vec![
            (
                "config".to_string(),
                self.resolve(&plugin.paths.config),
                false,
            ),
            (
                "skills".to_string(),
                self.resolve(&plugin.paths.skills),
                plugin.paths.skills.project_level,
            ),
            (
                "commands".to_string(),
                self.resolve(&plugin.paths.commands),
                plugin.paths.commands.project_level,
            ),
            ("mcp".to_string(), self.resolve(&plugin.paths.mcp), false),
            (
                "hooks".to_string(),
                self.resolve(&plugin.paths.hooks),
                plugin.paths.hooks.project_level,
            ),
            (
                "plugins".to_string(),
                self.resolve(&plugin.paths.plugins),
                plugin.paths.plugins.project_level,
            ),
        ];
        if let Some(ref secrets) = plugin.paths.secrets {
            results.push(("secrets".to_string(), self.resolve(secrets), false));
        }
        results
    }

    /// Check whether a plugin is installed based on its detection strategy.
    #[must_use]
    pub fn is_installed(&self, plugin: &AgentPlugin) -> bool {
        let Some(ref detection) = plugin.execution.detection else {
            // No detection strategy → assume installed
            return true;
        };

        match detection.detection_type.as_str() {
            "command" => {
                let target = &detection.target;
                // For command detection, check if the command exists in PATH
                // (async check is done in commands.rs; this is the sync approximation)
                which::which(target).is_ok()
            }
            "directory" => {
                let path = self.resolve_str(&detection.target);
                path.exists() && path.is_dir()
            }
            "file" => {
                let path = self.resolve_str(&detection.target);
                path.exists() && path.is_file()
            }
            _ => true,
        }
    }

    /// Ensure the parent directory for a resolved path exists.
    pub fn ensure_dir(&self, path: &Path) -> Result<(), crate::AppError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                crate::AppError::Io(format!(
                    "Failed to create parent directory {:?}: {}",
                    parent, e
                ))
            })?;
        }
        Ok(())
    }

    /// Ensure the directory itself exists.
    pub fn ensure_dir_all(&self, path: &Path) -> Result<(), crate::AppError> {
        std::fs::create_dir_all(path).map_err(|e| {
            crate::AppError::Io(format!("Failed to create directory {:?}: {}", path, e))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::plugin::PathTemplate;

    #[test]
    fn resolve_home_variable() {
        let resolver = PathResolver::new(None);
        let tpl = PathTemplate {
            relative: "{{home}}/.claude/skills".into(),
            format: "directory".into(),
            description: None,
            project_level: true,
        };
        let resolved = resolver.resolve(&tpl);
        let home = dirs::home_dir().unwrap();
        assert_eq!(resolved, home.join(".claude/skills"));
    }

    #[test]
    fn resolve_project_path_variable() {
        let resolver = PathResolver::new(Some(Path::new("/tmp/my-project")));
        let tpl = PathTemplate {
            relative: "{{projectPath}}/.claude/skills".into(),
            format: "directory".into(),
            description: None,
            project_level: true,
        };
        let resolved = resolver.resolve(&tpl);
        assert_eq!(resolved, PathBuf::from("/tmp/my-project/.claude/skills"));
    }

    #[test]
    fn resolve_agent_id_variable() {
        let resolver = PathResolver::new(None).with_agent_id("claude-code");
        let tpl = PathTemplate {
            relative: "{{home}}/.{{agentId}}/skills".into(),
            format: "directory".into(),
            description: None,
            project_level: false,
        };
        let resolved = resolver.resolve(&tpl);
        let home = dirs::home_dir().unwrap();
        assert_eq!(resolved, home.join(".claude-code/skills"));
    }

    #[test]
    fn resolve_all_variables_combined() {
        let resolver =
            PathResolver::new(Some(Path::new("/workspace/proj"))).with_agent_id("claude-code");
        let result = resolver.resolve_str("{{projectPath}}/{{agentId}}/skills");
        assert_eq!(result, PathBuf::from("/workspace/proj/claude-code/skills"));
    }

    #[test]
    fn resolve_tilde_fallback() {
        let resolver = PathResolver::new(None);
        let result = resolver.resolve_str("~/.config/test");
        let home = dirs::home_dir().unwrap();
        assert_eq!(result, home.join(".config/test"));
    }

    #[test]
    fn resolve_fullwidth_tilde() {
        let resolver = PathResolver::new(None);
        let result = resolver.resolve_str("～/.config/test");
        let home = dirs::home_dir().unwrap();
        assert_eq!(result, home.join(".config/test"));
    }

    #[test]
    fn resolve_absolute_path_as_is() {
        let resolver = PathResolver::new(None);
        let result = resolver.resolve_str("/absolute/path/skills");
        assert_eq!(result, PathBuf::from("/absolute/path/skills"));
    }

    #[test]
    fn resolve_skills_dir_with_override() {
        let plugin = crate::agent::registry::default_agent_plugins()
            .into_iter()
            .find(|p| p.id == "claude-code")
            .unwrap();
        let resolver = PathResolver::new(None);
        let resolved = resolver.resolve_skills_dir(&plugin, Some("~/.my-custom-skills"));
        let home = dirs::home_dir().unwrap();
        assert_eq!(resolved, home.join(".my-custom-skills"));
    }

    #[test]
    fn resolve_skills_dir_without_override() {
        let plugin = crate::agent::registry::default_agent_plugins()
            .into_iter()
            .find(|p| p.id == "claude-code")
            .unwrap();
        let resolver = PathResolver::new(Some(Path::new("/tmp/proj")));
        let resolved = resolver.resolve_skills_dir(&plugin, None);
        assert_eq!(resolved, PathBuf::from("/tmp/proj/.claude/skills"));
    }

    #[test]
    fn resolve_all_paths_returns_all_keys() {
        let plugin = crate::agent::registry::default_agent_plugins()
            .into_iter()
            .find(|p| p.id == "claude-code")
            .unwrap();
        let resolver = PathResolver::new(Some(Path::new("/tmp/proj")));
        let all = resolver.resolve_all_paths(&plugin);
        let keys: Vec<&str> = all.iter().map(|(k, _, _)| k.as_str()).collect();
        assert!(keys.contains(&"config"));
        assert!(keys.contains(&"skills"));
        assert!(keys.contains(&"commands"));
        assert!(keys.contains(&"mcp"));
        assert!(keys.contains(&"hooks"));
        assert!(keys.contains(&"plugins"));
    }

    #[test]
    fn ensure_dir_creates_parent() {
        let resolver = PathResolver::new(None);
        let dir = std::env::temp_dir().join("neeko-test-dir-resolver");
        let file_path = dir.join("sub").join("file.txt");
        resolver.ensure_dir(&file_path).unwrap();
        assert!(dir.join("sub").exists());
        // Cleanup
        let _ = std::fs::remove_dir_all(&dir);
    }
}
