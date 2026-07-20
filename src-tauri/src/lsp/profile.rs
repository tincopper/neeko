//! Project language profile detection from plugin root markers.
//!
//! Detection markers come from the plugin registry (built-ins + customs) —
//! this module has **no** hard-coded language table.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// A language detected (or registered) for a project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedLanguage {
    pub language_id: String,
    pub server_name: String,
    /// Root marker files that caused this detection (e.g. "go.mod").
    pub markers: Vec<String>,
}

/// Result of scanning a project root for language servers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLanguageProfile {
    pub project_path: String,
    /// Single primary language to soft-warm (monorepo: only one).
    pub primary: Option<DetectedLanguage>,
    /// All languages detected from root markers.
    pub candidates: Vec<DetectedLanguage>,
}

/// Detect languages for a project using built-in registry markers only.
///
/// Prefer [`detect_project_profile_with_markers`] with
/// `LspPluginRegistry::detection_markers()` so customs participate.
pub fn detect_project_profile(project_path: &str) -> ProjectLanguageProfile {
    use super::plugin::LspPluginRegistry;
    let markers = LspPluginRegistry::with_defaults().detection_markers();
    detect_project_profile_with_markers(project_path, &markers, None)
}

/// Detect using an explicit ordered marker list
/// `(marker_filename, language_id, server_name)`.
///
/// Marker order implies detection preference for primary selection when no
/// override is set (first detected language wins after special-case rules).
///
/// `primary_override` wins when it matches a candidate; if not among markers
/// but non-empty, a synthetic primary is created when server_name is provided
/// via the first matching marker entry for that language id in `markers`.
pub fn detect_project_profile_with_markers(
    project_path: &str,
    markers: &[(String, String, String)],
    primary_override: Option<&str>,
) -> ProjectLanguageProfile {
    let root = Path::new(project_path);

    let mut found: Vec<(String, String, String)> = Vec::new();
    for (marker, lang, server) in markers {
        if root.join(marker).is_file() {
            found.push((marker.clone(), lang.clone(), server.clone()));
        }
    }

    // Special case: package.json + tsconfig → prefer typescript over javascript
    let has_tsconfig = found.iter().any(|(m, _, _)| m == "tsconfig.json");

    let mut by_lang: HashMap<String, DetectedLanguage> = HashMap::new();
    let mut order: Vec<String> = Vec::new();

    for (marker, lang, server) in &found {
        if marker == "package.json" && has_tsconfig && lang == "javascript" {
            continue;
        }
        // go.sum alone is weak if go already present — still attach marker
        if let Some(existing) = by_lang.get_mut(lang) {
            if !existing.markers.iter().any(|m| m == marker) {
                existing.markers.push(marker.clone());
            }
            continue;
        }
        order.push(lang.clone());
        by_lang.insert(
            lang.clone(),
            DetectedLanguage {
                language_id: lang.clone(),
                server_name: server.clone(),
                markers: vec![marker.clone()],
            },
        );
    }

    let candidates: Vec<DetectedLanguage> = order
        .iter()
        .filter_map(|id| by_lang.get(id).cloned())
        .collect();

    let primary = select_primary(&candidates, markers, primary_override);

    ProjectLanguageProfile {
        project_path: project_path.to_string(),
        primary,
        candidates,
    }
}

/// Backward-compatible name used by manager.
pub fn detect_project_profile_with_extras(
    project_path: &str,
    extra_markers: &[(String, String, String)],
    primary_override: Option<&str>,
) -> ProjectLanguageProfile {
    use super::plugin::LspPluginRegistry;
    let mut markers = LspPluginRegistry::with_defaults().detection_markers();
    markers.extend(extra_markers.iter().cloned());
    detect_project_profile_with_markers(project_path, &markers, primary_override)
}

fn select_primary(
    candidates: &[DetectedLanguage],
    all_markers: &[(String, String, String)],
    primary_override: Option<&str>,
) -> Option<DetectedLanguage> {
    if let Some(override_id) = primary_override {
        if let Some(found) = candidates.iter().find(|c| c.language_id == override_id) {
            return Some(found.clone());
        }
        // Synthetic primary when override language is known to the marker catalog
        if let Some((_, _, server)) = all_markers
            .iter()
            .find(|(_, lang, _)| lang == override_id)
        {
            return Some(DetectedLanguage {
                language_id: override_id.to_string(),
                server_name: server.clone(),
                markers: vec![],
            });
        }
        // Unknown override — fall through to marker order
    }
    candidates.first().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lsp::plugin::LspPluginRegistry;
    use std::fs;
    use tempfile::tempdir;

    fn markers() -> Vec<(String, String, String)> {
        LspPluginRegistry::with_defaults().detection_markers()
    }

    #[test]
    fn should_detect_rust_from_cargo_toml() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("Cargo.toml"), "[package]\nname=\"x\"\n").unwrap();
        let profile =
            detect_project_profile_with_markers(&dir.path().to_string_lossy(), &markers(), None);
        assert_eq!(
            profile.primary.as_ref().map(|p| p.language_id.as_str()),
            Some("rust")
        );
    }

    #[test]
    fn should_detect_go_from_go_mod() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("go.mod"), "module x\n").unwrap();
        let profile =
            detect_project_profile_with_markers(&dir.path().to_string_lossy(), &markers(), None);
        assert_eq!(
            profile.primary.as_ref().map(|p| p.language_id.as_str()),
            Some("go")
        );
    }

    #[test]
    fn should_prefer_typescript_when_tsconfig_and_package_json() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("package.json"), "{}\n").unwrap();
        fs::write(dir.path().join("tsconfig.json"), "{}\n").unwrap();
        let profile =
            detect_project_profile_with_markers(&dir.path().to_string_lossy(), &markers(), None);
        assert_eq!(
            profile.primary.as_ref().map(|p| p.language_id.as_str()),
            Some("typescript")
        );
        assert!(!profile
            .candidates
            .iter()
            .any(|c| c.language_id == "javascript"));
    }

    #[test]
    fn should_detect_javascript_from_package_json_only() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("package.json"), "{}\n").unwrap();
        let profile =
            detect_project_profile_with_markers(&dir.path().to_string_lossy(), &markers(), None);
        assert_eq!(
            profile.primary.as_ref().map(|p| p.language_id.as_str()),
            Some("javascript")
        );
    }

    #[test]
    fn should_prefer_project_override_over_marker_priority() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("go.mod"), "module x\n").unwrap();
        fs::write(dir.path().join("Cargo.toml"), "[package]\nname=\"x\"\n").unwrap();
        let profile = detect_project_profile_with_markers(
            &dir.path().to_string_lossy(),
            &markers(),
            Some("rust"),
        );
        assert_eq!(
            profile.primary.as_ref().map(|p| p.language_id.as_str()),
            Some("rust")
        );
    }

    #[test]
    fn should_use_override_alone_when_no_markers() {
        let dir = tempdir().unwrap();
        let profile = detect_project_profile_with_markers(
            &dir.path().to_string_lossy(),
            &markers(),
            Some("python"),
        );
        assert_eq!(
            profile.primary.as_ref().map(|p| p.language_id.as_str()),
            Some("python")
        );
    }

    #[test]
    fn should_return_empty_when_no_markers() {
        let dir = tempdir().unwrap();
        let profile =
            detect_project_profile_with_markers(&dir.path().to_string_lossy(), &markers(), None);
        assert!(profile.primary.is_none());
        assert!(profile.candidates.is_empty());
    }

    #[test]
    fn should_ignore_unknown_override_when_candidates_exist() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("go.mod"), "module x\n").unwrap();
        let profile = detect_project_profile_with_markers(
            &dir.path().to_string_lossy(),
            &markers(),
            Some("not-a-lang"),
        );
        assert_eq!(
            profile.primary.as_ref().map(|p| p.language_id.as_str()),
            Some("go")
        );
    }

    #[test]
    fn should_pick_primary_from_candidates_matching_override() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("go.mod"), "module x\n").unwrap();
        fs::write(dir.path().join("Cargo.toml"), "[package]\nname=\"x\"\n").unwrap();
        let profile = detect_project_profile_with_markers(
            &dir.path().to_string_lossy(),
            &markers(),
            Some("go"),
        );
        assert_eq!(
            profile.primary.as_ref().map(|p| p.language_id.as_str()),
            Some("go")
        );
    }

    #[test]
    fn should_pick_single_primary_in_monorepo_by_marker_priority() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("go.mod"), "module x\n").unwrap();
        fs::write(dir.path().join("Cargo.toml"), "[package]\nname=\"x\"\n").unwrap();
        let profile =
            detect_project_profile_with_markers(&dir.path().to_string_lossy(), &markers(), None);
        // go priority 5 < rust 10
        assert_eq!(
            profile.primary.as_ref().map(|p| p.language_id.as_str()),
            Some("go")
        );
        assert!(profile.candidates.len() >= 2);
    }
}
