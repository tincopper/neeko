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

/// Parse SKILL.md (or fallback markers) for name/description metadata.
pub fn parse_skill_md(dir: &Path) -> SkillMetadata {
    let candidates = [
        "SKILL.md",
        "skill.md",
        "CLAUDE.md",
        "README.md",
        "readme.md",
    ];
    for candidate in &candidates {
        let path = dir.join(candidate);
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                return parse_skill_document(&content);
            }
        }
    }
    SkillMetadata {
        name: None,
        description: None,
    }
}

/// Parse skill markdown: YAML frontmatter first, then body fallback for description.
pub fn parse_skill_document(content: &str) -> SkillMetadata {
    let mut meta = parse_frontmatter(content);
    if meta
        .description
        .as_ref()
        .map(|s| s.trim().is_empty())
        .unwrap_or(true)
    {
        if let Some(body_desc) = extract_description_from_body(content) {
            meta.description = Some(body_desc);
        }
    }
    // Normalize whitespace in description
    if let Some(ref mut d) = meta.description {
        let collapsed: String = d.split_whitespace().collect::<Vec<_>>().join(" ");
        *d = collapsed;
        if d.is_empty() {
            meta.description = None;
        }
    }
    meta
}

/// Convert a YAML value to a display string (handles plain, folded, multi-line).
fn yaml_value_to_string(v: &serde_yaml::Value) -> Option<String> {
    match v {
        serde_yaml::Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        serde_yaml::Value::Number(n) => Some(n.to_string()),
        serde_yaml::Value::Bool(b) => Some(b.to_string()),
        serde_yaml::Value::Sequence(seq) => {
            let parts: Vec<String> = seq.iter().filter_map(yaml_value_to_string).collect();
            if parts.is_empty() {
                None
            } else {
                Some(parts.join(" "))
            }
        }
        _ => None,
    }
}

/// Parse YAML frontmatter from markdown content.
fn parse_frontmatter(content: &str) -> SkillMetadata {
    let trimmed = content.trim_start_matches('\u{feff}').trim();
    if !trimmed.starts_with("---") {
        return SkillMetadata {
            name: None,
            description: None,
        };
    }
    // Skip opening ---
    let after_open = trimmed[3..].trim_start_matches(['\r', '\n']);
    // Find closing --- on its own line (or at least after a newline)
    let end = after_open
        .find("\n---")
        .or_else(|| after_open.find("\r\n---"))
        .map(|i| {
            // Include up to before \n---
            if after_open.as_bytes().get(i) == Some(&b'\r') {
                i
            } else {
                i
            }
        });
    let Some(end_idx) = end else {
        // Try simple find for --- after start
        if let Some(e) = after_open.find("---") {
            return parse_yaml_block(&after_open[..e]);
        }
        return SkillMetadata {
            name: None,
            description: None,
        };
    };
    let yaml_str = &after_open[..end_idx];
    let mut meta = parse_yaml_block(yaml_str);
    // Manual fallback for common `key: value` lines when YAML parse fails partially
    if meta.name.is_none() || meta.description.is_none() {
        let manual = parse_frontmatter_manual(yaml_str);
        if meta.name.is_none() {
            meta.name = manual.name;
        }
        if meta.description.is_none() {
            meta.description = manual.description;
        }
    }
    meta
}

fn parse_yaml_block(yaml_str: &str) -> SkillMetadata {
    if let Ok(yaml) = serde_yaml::from_str::<serde_yaml::Value>(yaml_str) {
        let name = yaml.get("name").and_then(yaml_value_to_string);
        let description = yaml.get("description").and_then(yaml_value_to_string);
        return SkillMetadata { name, description };
    }
    SkillMetadata {
        name: None,
        description: None,
    }
}

/// Line-oriented fallback: `name: ...` / `description: ...` (including multi-line `|` / `>`).
fn parse_frontmatter_manual(yaml_str: &str) -> SkillMetadata {
    let mut name: Option<String> = None;
    let mut description: Option<String> = None;
    let mut collecting_desc = false;
    let mut desc_buf = String::new();

    for line in yaml_str.lines() {
        if collecting_desc {
            // Indented continuation or empty line inside block scalar
            if line.starts_with(' ') || line.starts_with('\t') || line.trim().is_empty() {
                if !desc_buf.is_empty() {
                    desc_buf.push(' ');
                }
                desc_buf.push_str(line.trim());
                continue;
            }
            collecting_desc = false;
            if !desc_buf.trim().is_empty() {
                description = Some(desc_buf.trim().to_string());
            }
            desc_buf.clear();
        }

        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("name:") {
            let v = rest.trim().trim_matches('"').trim_matches('\'').trim();
            if !v.is_empty() {
                name = Some(v.to_string());
            }
        } else if let Some(rest) = trimmed.strip_prefix("description:") {
            let v = rest.trim();
            if v == "|" || v == ">" || v == "|-" || v == ">-" || v.is_empty() {
                collecting_desc = true;
                desc_buf.clear();
            } else {
                let cleaned = v.trim_matches('"').trim_matches('\'').trim();
                if !cleaned.is_empty() {
                    description = Some(cleaned.to_string());
                }
            }
        }
    }
    if collecting_desc && !desc_buf.trim().is_empty() {
        description = Some(desc_buf.trim().to_string());
    }
    SkillMetadata { name, description }
}

/// First meaningful paragraph from markdown body (after frontmatter).
/// Prefers non-heading paragraphs; falls back to first heading text.
fn extract_description_from_body(content: &str) -> Option<String> {
    let body = strip_frontmatter(content);
    let mut heading_fallback: Option<String> = None;
    let mut para = String::new();

    for line in body.lines() {
        let t = line.trim();
        if t.is_empty() {
            if !para.is_empty() {
                break;
            }
            continue;
        }
        if t.starts_with("```") || t.starts_with("<!--") {
            continue;
        }
        if t.starts_with('#') {
            if heading_fallback.is_none() {
                let h = t.trim_start_matches('#').trim();
                if !h.is_empty() {
                    heading_fallback = Some(h.to_string());
                }
            }
            // Don't mix heading into paragraph
            if !para.is_empty() {
                break;
            }
            continue;
        }
        if !para.is_empty() {
            para.push(' ');
        }
        para.push_str(t);
        if para.len() > 280 {
            break;
        }
    }

    let raw = if !para.trim().is_empty() {
        para
    } else {
        heading_fallback.unwrap_or_default()
    };
    let collapsed: String = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        None
    } else if collapsed.len() > 280 {
        Some(format!("{}…", &collapsed[..277]))
    } else {
        Some(collapsed)
    }
}

fn strip_frontmatter(content: &str) -> &str {
    let trimmed = content.trim_start_matches('\u{feff}').trim_start();
    if !trimmed.starts_with("---") {
        return content;
    }
    let after = trimmed[3..].trim_start_matches(['\r', '\n']);
    if let Some(idx) = after.find("\n---") {
        let rest = &after[idx + 4..];
        return rest.trim_start_matches(['\r', '\n']);
    }
    content
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
        let meta = parse_skill_document(content);
        assert_eq!(meta.name.as_deref(), Some("my-skill"));
        assert_eq!(meta.description.as_deref(), Some("A great skill"));
    }

    #[test]
    fn parse_multiline_yaml_description() {
        let content = "---\nname: multi\ndescription: |\n  Line one of the skill.\n  Line two continues.\n---\n# Body\n";
        let meta = parse_skill_document(content);
        assert_eq!(meta.name.as_deref(), Some("multi"));
        let desc = meta.description.unwrap();
        assert!(desc.contains("Line one"));
        assert!(desc.contains("Line two"));
    }

    #[test]
    fn parse_body_fallback_when_no_frontmatter() {
        let content =
            "# Code Review\n\nReviews pull requests for style and correctness.\n\n## Steps\n";
        let meta = parse_skill_document(content);
        assert_eq!(
            meta.description.as_deref(),
            Some("Reviews pull requests for style and correctness.")
        );
    }

    #[test]
    fn parse_body_fallback_heading_only() {
        let content = "# Only Title\n\n## Section\n";
        let meta = parse_skill_document(content);
        assert_eq!(meta.description.as_deref(), Some("Only Title"));
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
