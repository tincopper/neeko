use std::path::Path;

use super::types::SkillMetadata;

/// Skill directory marker files used across the application.
const SKILL_DIR_MARKERS: &[&str] = &[
    "SKILL.md",
    "skill.md",
    "CLAUDE.md",
    "README.md",
    "readme.md",
];

/// Parse SKILL.md frontmatter from a directory.
pub fn parse_skill_md(dir: &Path) -> SkillMetadata {
    let candidates = ["SKILL.md", "skill.md", "CLAUDE.md"];
    for candidate in &candidates {
        let path = dir.join(candidate);
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                return parse_frontmatter(&content);
            }
        }
    }
    SkillMetadata {
        name: None,
        description: None,
    }
}

/// Parse YAML frontmatter from markdown content.
fn parse_frontmatter(content: &str) -> SkillMetadata {
    let trimmed = content.trim();
    if !trimmed.starts_with("---") {
        return SkillMetadata {
            name: None,
            description: None,
        };
    }
    let rest = &trimmed[3..];
    if let Some(end) = rest.find("---") {
        let yaml_str = &rest[..end];
        if let Ok(yaml) = serde_yaml::from_str::<serde_yaml::Value>(yaml_str) {
            let name = yaml
                .get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let description = yaml
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            return SkillMetadata { name, description };
        }
    }
    SkillMetadata {
        name: None,
        description: None,
    }
}

/// Check whether a directory looks like a valid skill directory.
pub fn is_valid_skill_dir(dir: &Path) -> bool {
    dir.is_dir() && SKILL_DIR_MARKERS.iter().any(|name| dir.join(name).exists())
}

// -- sanitize_skill_name --

/// Characters that are invalid in Windows file/directory names.
const WINDOWS_RESERVED: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// Reserved Windows device names.
const WINDOWS_RESERVED_BASENAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Sanitize a skill name for safe use as a directory component on all platforms.
pub fn sanitize_skill_name(name: &str) -> Option<String> {
    let last = std::path::Path::new(name)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())?;
    if last == ".." || last == "." {
        return None;
    }
    let clean: String = last
        .chars()
        .map(|c| {
            if c.is_control() || WINDOWS_RESERVED.contains(&c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = clean.trim().trim_end_matches('.');
    if trimmed.is_empty() {
        None
    } else {
        let reserved = trimmed
            .split('.')
            .next()
            .map(|base| base.to_ascii_uppercase())
            .map(|upper| WINDOWS_RESERVED_BASENAMES.contains(&upper.as_str()))
            .unwrap_or(false);
        if reserved {
            Some(format!("_{}", trimmed))
        } else {
            Some(trimmed.to_string())
        }
    }
}

/// Infer a skill name from a directory.
pub fn infer_skill_name(dir: &Path) -> String {
    let meta = parse_skill_md(dir);
    if let Some(name) = meta.name {
        if let Some(sanitized) = sanitize_skill_name(&name) {
            return sanitized;
        }
    }
    dir.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown-skill".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn parse_frontmatter_full() {
        let content = "---\nname: my-skill\ndescription: A great skill\n---\n# Content";
        let meta = parse_frontmatter(content);
        assert_eq!(meta.name.as_deref(), Some("my-skill"));
        assert_eq!(meta.description.as_deref(), Some("A great skill"));
    }

    #[test]
    fn parse_frontmatter_no_frontmatter() {
        let content = "# Just markdown\nNo frontmatter here.";
        let meta = parse_frontmatter(content);
        assert_eq!(meta.name, None);
    }

    #[test]
    fn parse_frontmatter_invalid_yaml() {
        let content = "---\n: : broken yaml\n---\n";
        let meta = parse_frontmatter(content);
        assert_eq!(meta.name, None);
    }

    #[test]
    fn parse_skill_md_reads_skill_md() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("SKILL.md"), "---\nname: from-skill\n---\n").unwrap();
        let meta = parse_skill_md(tmp.path());
        assert_eq!(meta.name.as_deref(), Some("from-skill"));
    }

    #[test]
    fn is_valid_skill_dir_with_skill_md() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("SKILL.md"), "content").unwrap();
        assert!(is_valid_skill_dir(tmp.path()));
    }

    #[test]
    fn is_valid_skill_dir_empty() {
        let tmp = tempdir().unwrap();
        assert!(!is_valid_skill_dir(tmp.path()));
    }

    #[test]
    fn sanitize_normal_name() {
        assert_eq!(sanitize_skill_name("my-skill"), Some("my-skill".into()));
    }

    #[test]
    fn sanitize_strips_path_traversal() {
        assert_eq!(
            sanitize_skill_name("../../../../.bashrc"),
            Some(".bashrc".into())
        );
    }

    #[test]
    fn sanitize_rejects_dotdot() {
        assert_eq!(sanitize_skill_name(".."), None);
        assert_eq!(sanitize_skill_name("."), None);
    }

    #[test]
    fn sanitize_replaces_control_chars_with_underscore() {
        assert_eq!(sanitize_skill_name("a\x00b\x07c"), Some("a_b_c".into()));
    }

    #[test]
    fn sanitize_replaces_windows_reserved_chars() {
        assert_eq!(
            sanitize_skill_name("foo:bar*baz"),
            Some("foo_bar_baz".into())
        );
        assert_eq!(sanitize_skill_name("a<b>c"), Some("a_b_c".into()));
    }

    #[test]
    fn sanitize_trims_whitespace_and_trailing_dots() {
        assert_eq!(sanitize_skill_name("  foo  "), Some("foo".into()));
        assert_eq!(sanitize_skill_name("bar..."), Some("bar".into()));
    }

    #[test]
    fn sanitize_rejects_empty_after_cleaning() {
        assert_eq!(sanitize_skill_name("   "), None);
        assert_eq!(sanitize_skill_name("..."), None);
    }

    #[test]
    fn sanitize_avoids_windows_reserved_device_names() {
        assert_eq!(sanitize_skill_name("CON"), Some("_CON".into()));
        assert_eq!(sanitize_skill_name("nul.txt"), Some("_nul.txt".into()));
        assert_eq!(sanitize_skill_name("Com1"), Some("_Com1".into()));
    }

    #[test]
    fn is_valid_skill_dir_with_readme() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("README.md"), "content").unwrap();
        assert!(is_valid_skill_dir(tmp.path()));
    }

    #[test]
    fn infer_skill_name_from_metadata() {
        let tmp = tempdir().unwrap();
        let skill_dir = tmp.path().join("directory-name");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: metadata-name\n---\n",
        )
        .unwrap();
        assert_eq!(infer_skill_name(&skill_dir), "metadata-name");
    }
}
