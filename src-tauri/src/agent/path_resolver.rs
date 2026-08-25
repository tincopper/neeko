//! Path resolution engine for Agent path templates（纯模板解析，无 AgentPlugin 依赖）。
//!
//! Resolves template variables ({{home}}, {{projectPath}}) to absolute paths，
//! plus `~` / 全角波浪线展开。`AgentProvider` 与部署体系统一经此解析
//! `AgentConfig.deploy` 模板。

use std::path::{Path, PathBuf};

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

    /// Resolve a raw template string（`resolve_template` 的兼容别名）。
    #[must_use]
    pub fn resolve_str(&self, template: &str) -> PathBuf {
        self.resolve_template(template)
    }

    /// Resolve a raw template string.
    #[must_use]
    pub fn resolve_template(&self, template: &str) -> PathBuf {
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

    /// 解析一个 override 路径（用户全局 skills override，如 `~/.claude/skills`）。
    /// override 优先于模板，直接按字符串解析（含 ~ / 全角波浪线展开）。
    #[must_use]
    pub fn resolve_override(&self, _template: &str, override_path: &str) -> PathBuf {
        self.resolve_template(override_path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_template_expands_home_and_project() {
        let resolver = PathResolver::new(Some(Path::new("/tmp/proj")));
        assert_eq!(
            resolver.resolve_template("{{home}}/.claude/skills"),
            dirs::home_dir().unwrap().join(".claude/skills")
        );
        assert_eq!(
            resolver.resolve_template("{{projectPath}}/.claude/skills"),
            PathBuf::from("/tmp/proj/.claude/skills")
        );
    }

    #[test]
    fn resolve_template_expands_tilde_and_fullwidth() {
        let resolver = PathResolver::new(None);
        let home = dirs::home_dir().unwrap();
        assert_eq!(
            resolver.resolve_template("~/.config/test"),
            home.join(".config/test")
        );
        assert_eq!(
            resolver.resolve_template("～/.config/test"),
            home.join(".config/test")
        );
    }

    #[test]
    fn resolve_override_ignores_template() {
        let resolver = PathResolver::new(Some(Path::new("/tmp/proj")));
        assert_eq!(
            resolver.resolve_override("{{projectPath}}/.x/skills", "~/.my-skills"),
            dirs::home_dir().unwrap().join(".my-skills")
        );
    }
}
