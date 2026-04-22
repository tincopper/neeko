use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
pub struct ToolAdapter {
    pub key: String,
    pub display_name: String,
    pub relative_skills_dir: String,
    pub relative_detect_dir: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub additional_scan_dirs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub override_skills_dir: Option<String>,
    #[serde(default)]
    pub is_custom: bool,
}

/// Serializable custom tool definition stored in settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomToolDef {
    pub key: String,
    pub display_name: String,
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

    pub fn has_path_override(&self) -> bool {
        self.override_skills_dir.is_some()
    }
}

/// Built-in tool adapters (aligned with skills-manager).
pub fn default_tool_adapters() -> Vec<ToolAdapter> {
    vec![
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
            key: "claude_code".into(),
            display_name: "Claude Code".into(),
            relative_skills_dir: ".claude/skills".into(),
            relative_detect_dir: ".claude".into(),
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
            key: "opencode".into(),
            display_name: "OpenCode".into(),
            relative_skills_dir: ".config/opencode/skills".into(),
            relative_detect_dir: ".config/opencode".into(),
            additional_scan_dirs: vec![],
            override_skills_dir: None,
            is_custom: false,
        },
        ToolAdapter {
            key: "gemini_cli".into(),
            display_name: "Gemini CLI".into(),
            relative_skills_dir: ".gemini/skills".into(),
            relative_detect_dir: ".gemini".into(),
            additional_scan_dirs: vec![],
            override_skills_dir: None,
            is_custom: false,
        },
        ToolAdapter {
            key: "kilo_code".into(),
            display_name: "Kilo Code".into(),
            relative_skills_dir: ".kilocode/skills".into(),
            relative_detect_dir: ".kilocode".into(),
            additional_scan_dirs: vec![],
            override_skills_dir: None,
            is_custom: false,
        },
        ToolAdapter {
            key: "roo_code".into(),
            display_name: "Roo Code".into(),
            relative_skills_dir: ".roo/skills".into(),
            relative_detect_dir: ".roo".into(),
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

/// Read custom tool path overrides from settings store.
pub fn custom_tool_paths(custom_tool_paths_json: &str) -> HashMap<String, String> {
    serde_json::from_str(custom_tool_paths_json).unwrap_or_default()
}

/// Build all adapters: built-in + custom.
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
