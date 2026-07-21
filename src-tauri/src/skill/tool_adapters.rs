//! Tool adapter definitions for agent platforms (Cursor, Claude Code, etc.).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Describes an agent tool's skills directory layout and detection paths.
#[derive(Debug, Clone, Serialize)]
pub struct ToolAdapter {
    /// Unique tool key (e.g. "cursor", "claude_code").
    pub key: String,
    /// Human-readable display name.
    pub display_name: String,
    /// Relative path to the skills directory within the home dir.
    pub relative_skills_dir: String,
    /// Relative path used to detect if the tool is installed.
    pub relative_detect_dir: String,
    /// Additional directories to scan for unmanaged skills.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub additional_scan_dirs: Vec<String>,
    /// Override path for the skills directory.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub override_skills_dir: Option<String>,
    /// Whether this is a user-defined custom tool.
    #[serde(default)]
    pub is_custom: bool,
}

/// Serializable custom tool definition stored in settings.
/// Serializable custom tool definition stored in settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomToolDef {
    /// Unique tool key.
    pub key: String,
    /// Human-readable display name.
    pub display_name: String,
    /// Absolute path to the custom skills directory.
    pub skills_dir: String,
}

impl ToolAdapter {
    fn home() -> PathBuf {
        dirs::home_dir().expect("Cannot determine home directory")
    }

    fn candidate_paths(relative: &str) -> Vec<PathBuf> {
        let mut candidates = vec![Self::home().join(relative)];

        if let Some(suffix) = relative.strip_prefix(".config/") {
            if let Some(config_dir) = dirs::config_dir() {
                let config_path = config_dir.join(suffix);
                if !candidates.contains(&config_path) {
                    candidates.push(config_path);
                }
            }
        }

        candidates
    }

    fn select_existing_or_default(paths: &[PathBuf]) -> PathBuf {
        paths
            .iter()
            .find(|path| path.exists())
            .cloned()
            .unwrap_or_else(|| paths[0].clone())
    }

    /// Get the skills directory for this adapter.
    /// Uses override if set, otherwise checks `~/.xxx` and `~/.config/xxx` candidates.
    pub fn skills_dir(&self) -> PathBuf {
        if let Some(ref abs) = self.override_skills_dir {
            return PathBuf::from(abs);
        }
        let candidates = Self::candidate_paths(&self.relative_skills_dir);
        Self::select_existing_or_default(&candidates)
    }

    /// Returns all directories to scan for skills.
    pub fn all_scan_dirs(&self) -> Vec<PathBuf> {
        let mut dirs = vec![self.skills_dir()];
        for rel in &self.additional_scan_dirs {
            let candidates = Self::candidate_paths(rel);
            for c in candidates {
                if c.exists() && !dirs.contains(&c) {
                    dirs.push(c);
                }
            }
        }
        dirs
    }

    /// Check if this tool is installed (has a detect directory).
    pub fn is_installed(&self) -> bool {
        if self.is_custom || self.override_skills_dir.is_some() {
            return true;
        }
        Self::candidate_paths(&self.relative_detect_dir)
            .iter()
            .any(|path| path.exists())
    }

    /// Check if this adapter has a path override set.
    pub fn has_path_override(&self) -> bool {
        self.override_skills_dir.is_some()
    }
}

/// Expand `~/…` paths to absolute paths under the user home directory.
pub fn expand_skill_path(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if trimmed == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        return dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(rest);
    }
    if let Some(rest) = trimmed.strip_prefix("~\\") {
        return dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(rest);
    }
    PathBuf::from(trimmed)
}

/// A sync/scan target: agent (or tool) key + absolute skills directory.
#[derive(Debug, Clone)]
pub struct SkillTargetDir {
    /// Agent / tool key (e.g. "claude-code", "cursor").
    pub key: String,
    /// Absolute path to the skills directory.
    pub dir: PathBuf,
}

/// Resolve skill directories from agent configs (`skill_path`).
///
/// Only enabled agents with a non-empty skill path are included.
pub fn skill_targets_from_agents(
    agents: &[(String, bool, Option<String>)],
) -> Vec<SkillTargetDir> {
    let mut out = Vec::new();
    for (id, enabled, skill_path) in agents {
        if !enabled {
            continue;
        }
        let Some(path) = skill_path.as_ref() else {
            continue;
        };
        if path.trim().is_empty() {
            continue;
        }
        out.push(SkillTargetDir {
            key: id.clone(),
            dir: expand_skill_path(path),
        });
    }
    out
}

/// Built-in tool adapters aligned with Neeko agents + common IDE tools.
///
/// Keys for Neeko agents match `AgentConfig.id` / `skill_path`.
pub fn default_tool_adapters() -> Vec<ToolAdapter> {
    vec![
        // ── Neeko built-in agents (paths match AgentManager) ──
        ToolAdapter {
            key: "opencode".into(),
            display_name: "OpenCode".into(),
            relative_skills_dir: ".agents/skills".into(),
            relative_detect_dir: ".agents".into(),
            additional_scan_dirs: vec![".config/opencode/skills".into()],
            override_skills_dir: None,
            is_custom: false,
        },
        ToolAdapter {
            key: "claude-code".into(),
            display_name: "Claude Code".into(),
            relative_skills_dir: ".claude/skills".into(),
            relative_detect_dir: ".claude".into(),
            additional_scan_dirs: vec![],
            override_skills_dir: None,
            is_custom: false,
        },
        ToolAdapter {
            key: "gemini".into(),
            display_name: "Gemini".into(),
            relative_skills_dir: ".gemini/skills".into(),
            relative_detect_dir: ".gemini".into(),
            additional_scan_dirs: vec![],
            override_skills_dir: None,
            is_custom: false,
        },
        ToolAdapter {
            key: "codex".into(),
            display_name: "Codex".into(),
            relative_skills_dir: ".codex/skills".into(),
            relative_detect_dir: ".codex".into(),
            additional_scan_dirs: vec![],
            override_skills_dir: None,
            is_custom: false,
        },
        ToolAdapter {
            key: "qoder".into(),
            display_name: "Qoder".into(),
            relative_skills_dir: ".qoder/skills".into(),
            relative_detect_dir: ".qoder".into(),
            additional_scan_dirs: vec![],
            override_skills_dir: None,
            is_custom: false,
        },
        ToolAdapter {
            key: "codebuddy".into(),
            display_name: "Codebuddy".into(),
            relative_skills_dir: ".codebuddy/skills".into(),
            relative_detect_dir: ".codebuddy".into(),
            additional_scan_dirs: vec![],
            override_skills_dir: None,
            is_custom: false,
        },
        ToolAdapter {
            key: "pi".into(),
            display_name: "Pi".into(),
            relative_skills_dir: ".pi/skills".into(),
            relative_detect_dir: ".pi".into(),
            additional_scan_dirs: vec![],
            override_skills_dir: None,
            is_custom: false,
        },
        ToolAdapter {
            key: "omp".into(),
            display_name: "OMP".into(),
            relative_skills_dir: ".omp/skills".into(),
            relative_detect_dir: ".omp".into(),
            additional_scan_dirs: vec![],
            override_skills_dir: None,
            is_custom: false,
        },
        ToolAdapter {
            key: "reasonix".into(),
            display_name: "Reasonix".into(),
            relative_skills_dir: ".reasonix/skills".into(),
            relative_detect_dir: ".reasonix".into(),
            additional_scan_dirs: vec![],
            override_skills_dir: None,
            is_custom: false,
        },
        // ── Extra IDE / agent tools (scan + optional sync via adapters) ──
        ToolAdapter {
            key: "cursor".into(),
            display_name: "Cursor".into(),
            relative_skills_dir: ".cursor/skills".into(),
            relative_detect_dir: ".cursor".into(),
            additional_scan_dirs: vec![],
            override_skills_dir: None,
            is_custom: false,
        },
        ToolAdapter {
            key: "windsurf".into(),
            display_name: "Windsurf".into(),
            relative_skills_dir: ".codeium/windsurf/skills".into(),
            relative_detect_dir: ".codeium/windsurf".into(),
            additional_scan_dirs: vec![],
            override_skills_dir: None,
            is_custom: false,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_skill_path_tilde() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(expand_skill_path("~/foo/bar"), home.join("foo/bar"));
        assert_eq!(expand_skill_path("~"), home);
        assert_eq!(
            expand_skill_path("/abs/path"),
            PathBuf::from("/abs/path")
        );
    }

    #[test]
    fn skill_targets_from_agents_filters_disabled_and_empty() {
        let agents = vec![
            ("claude-code".into(), true, Some("~/.claude/skills".into())),
            ("disabled".into(), false, Some("~/.x/skills".into())),
            ("no-path".into(), true, None),
            ("empty".into(), true, Some("  ".into())),
        ];
        let targets = skill_targets_from_agents(&agents);
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].key, "claude-code");
        assert!(targets[0].dir.ends_with("skills") || targets[0].dir.to_string_lossy().contains("claude"));
    }

    #[test]
    fn default_adapters_include_neeko_agent_ids() {
        let keys: Vec<_> = default_tool_adapters()
            .into_iter()
            .map(|a| a.key)
            .collect();
        for expected in [
            "opencode",
            "claude-code",
            "gemini",
            "codex",
            "qoder",
            "codebuddy",
            "pi",
        ] {
            assert!(keys.contains(&expected.to_string()), "missing {expected}");
        }
        assert!(!keys.contains(&"claude_code".to_string()));
        assert!(!keys.contains(&"gemini_cli".to_string()));
    }
}

/// Deserialize custom tool path overrides from a JSON string.
pub fn custom_tool_paths(custom_tool_paths_json: &str) -> HashMap<String, String> {
    serde_json::from_str(custom_tool_paths_json).unwrap_or_default()
}

/// Build all adapters: built-in + custom, with path overrides applied.
pub fn all_tool_adapters(
    custom_tool_paths_json: &str,
    custom_tools_json: &str,
) -> Vec<ToolAdapter> {
    let overrides: HashMap<String, String> = custom_tool_paths(custom_tool_paths_json);
    let customs: Vec<CustomToolDef> = serde_json::from_str(custom_tools_json).unwrap_or_default();

    let mut adapters: Vec<ToolAdapter> = default_tool_adapters()
        .into_iter()
        .map(|mut a| {
            if let Some(path) = overrides.get(&a.key) {
                a.override_skills_dir = Some(path.clone());
            }
            a
        })
        .collect();

    for ct in customs {
        adapters.push(ToolAdapter {
            key: ct.key,
            display_name: ct.display_name,
            relative_skills_dir: String::new(),
            relative_detect_dir: String::new(),
            additional_scan_dirs: vec![],
            override_skills_dir: Some(ct.skills_dir),
            is_custom: true,
        });
    }

    adapters
}
