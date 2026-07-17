//! Project language profile detection from root markers.
//!
//! Lightweight, root-only scan — no deep walk. Used when a project becomes
//! active so the UI can show "detected" languages and soft-warm the primary
//! language without spawning language servers (default autoStart=onFirstFile).

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

/// Marker file → (language_id, server binary name).
/// Order matters for primary selection when multiple markers exist:
/// earlier entries win as primary if present.
const ROOT_MARKERS: &[(&str, &str, &str)] = &[
    // (marker_filename, language_id, server_name)
    ("go.mod", "go", "gopls"),
    ("go.work", "go", "gopls"),
    ("Cargo.toml", "rust", "rust-analyzer"),
    ("tsconfig.json", "typescript", "typescript-language-server"),
    ("jsconfig.json", "javascript", "typescript-language-server"),
    ("package.json", "javascript", "typescript-language-server"), // demoted if tsconfig present
    ("pyproject.toml", "python", "pyright-langserver"),
    ("requirements.txt", "python", "pyright-langserver"),
    ("setup.py", "python", "pyright-langserver"),
    ("pom.xml", "java", "jdtls"),
    ("build.gradle", "java", "jdtls"),
    ("build.gradle.kts", "java", "jdtls"),
    ("CMakeLists.txt", "cpp", "clangd"),
    ("compile_commands.json", "cpp", "clangd"),
    ("go.sum", "go", "gopls"), // auxiliary; primary prefers go.mod
];

/// Detect languages for a project by inspecting root marker files only.
pub fn detect_project_profile(project_path: &str) -> ProjectLanguageProfile {
    detect_project_profile_with_extras(project_path, &[], None)
}

/// Like [`detect_project_profile`], but also checks custom root markers
/// `(marker_filename, language_id, server_name)`.
///
/// `primary_override` (project-level preference) wins over marker order when it
/// matches a candidate. If the override is not among detected markers, a synthetic
/// primary is still selected when the language is known (server name resolvable).
pub fn detect_project_profile_with_extras(
    project_path: &str,
    extra_markers: &[(String, String, String)],
    primary_override: Option<&str>,
) -> ProjectLanguageProfile {
    let root = Path::new(project_path);
    let mut by_lang: Vec<DetectedLanguage> = Vec::new();

    // Collect markers present
    let mut found: Vec<(String, String, String)> = Vec::new();
    for &(marker, lang, server) in ROOT_MARKERS {
        if root.join(marker).is_file() {
            found.push((marker.to_string(), lang.to_string(), server.to_string()));
        }
    }
    for (marker, lang, server) in extra_markers {
        if root.join(marker).is_file() {
            found.push((marker.clone(), lang.clone(), server.clone()));
        }
    }

    // Special case: package.json + tsconfig → prefer typescript over javascript
    let has_tsconfig = found.iter().any(|(m, _, _)| m == "tsconfig.json");
    let has_package = found.iter().any(|(m, _, _)| m == "package.json");

    for (marker, lang, server) in &found {
        // Skip bare package.json javascript entry when tsconfig elevates to typescript
        if marker == "package.json" && has_tsconfig {
            continue;
        }
        // go.sum alone is weak; if go.mod/go.work already added go, just attach marker
        if marker == "go.sum" {
            if let Some(existing) = by_lang.iter_mut().find(|d| d.language_id == "go") {
                if !existing.markers.iter().any(|m| m == marker) {
                    existing.markers.push(marker.clone());
                }
                continue;
            }
        }

        if let Some(existing) = by_lang.iter_mut().find(|d| d.language_id == *lang) {
            if !existing.markers.iter().any(|m| m == marker) {
                existing.markers.push(marker.clone());
            }
        } else {
            by_lang.push(DetectedLanguage {
                language_id: lang.clone(),
                server_name: server.clone(),
                markers: vec![marker.clone()],
            });
        }
    }

    // If tsconfig + package.json, ensure typescript has both markers
    if has_tsconfig {
        if let Some(ts) = by_lang.iter_mut().find(|d| d.language_id == "typescript") {
            if has_package && !ts.markers.iter().any(|m| m == "package.json") {
                ts.markers.push("package.json".to_string());
            }
        }
    }

    // Priority: project override > root-marker order > first candidate
    let primary = pick_primary(&by_lang, primary_override);

    ProjectLanguageProfile {
        project_path: project_path.to_string(),
        primary,
        candidates: by_lang,
    }
}

/// Select primary language.
///
/// Order: `primary_override` (if matches a candidate or is a known language) >
/// ROOT_MARKERS order among candidates > first candidate.
pub fn pick_primary(
    candidates: &[DetectedLanguage],
    primary_override: Option<&str>,
) -> Option<DetectedLanguage> {
    if let Some(override_id) = primary_override.map(str::trim).filter(|s| !s.is_empty()) {
        if let Some(d) = candidates.iter().find(|c| c.language_id == override_id) {
            return Some(d.clone());
        }
        // Override not detected via markers — still honor explicit project preference
        // when we know a server for that language (monorepo / forced language).
        if let Some(server) = server_name_for_language(override_id) {
            return Some(DetectedLanguage {
                language_id: override_id.to_string(),
                server_name: server.to_string(),
                markers: vec![],
            });
        }
        // Unknown override with no candidates: synthesize with language id as server name
        if candidates.is_empty() {
            return Some(DetectedLanguage {
                language_id: override_id.to_string(),
                server_name: override_id.to_string(),
                markers: vec![],
            });
        }
        // Unknown override but other candidates exist: ignore invalid override
    }

    if candidates.is_empty() {
        return None;
    }
    // Walk ROOT_MARKERS order for first matching language_id
    for &(_, lang, _) in ROOT_MARKERS {
        if let Some(d) = candidates.iter().find(|c| c.language_id == lang) {
            return Some(d.clone());
        }
    }
    candidates.first().cloned()
}

/// Whether a server binary name is known for soft-warm checks.
pub fn server_name_for_language(language_id: &str) -> Option<&'static str> {
    ROOT_MARKERS
        .iter()
        .find(|(_, lang, _)| *lang == language_id)
        .map(|(_, _, server)| *server)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write(dir: &Path, name: &str, body: &str) {
        fs::write(dir.join(name), body).unwrap();
    }

    #[test]
    fn should_detect_go_from_go_mod() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "go.mod", "module example\n\ngo 1.22\n");
        write(tmp.path(), "go.sum", "");

        let profile = detect_project_profile(tmp.path().to_str().unwrap());
        assert_eq!(profile.candidates.len(), 1);
        assert_eq!(profile.candidates[0].language_id, "go");
        assert_eq!(profile.candidates[0].server_name, "gopls");
        assert!(profile.candidates[0].markers.contains(&"go.mod".into()));
        assert!(profile.candidates[0].markers.contains(&"go.sum".into()));
        assert_eq!(profile.primary.as_ref().unwrap().language_id, "go");
    }

    #[test]
    fn should_detect_rust_from_cargo_toml() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "Cargo.toml", "[package]\nname=\"x\"\n");

        let profile = detect_project_profile(tmp.path().to_str().unwrap());
        assert_eq!(profile.primary.as_ref().unwrap().language_id, "rust");
        assert_eq!(
            profile.primary.as_ref().unwrap().server_name,
            "rust-analyzer"
        );
    }

    #[test]
    fn should_prefer_typescript_when_tsconfig_and_package_json() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "package.json", "{}");
        write(tmp.path(), "tsconfig.json", "{}");

        let profile = detect_project_profile(tmp.path().to_str().unwrap());
        assert_eq!(profile.candidates.len(), 1);
        assert_eq!(profile.candidates[0].language_id, "typescript");
        assert!(profile.candidates[0]
            .markers
            .iter()
            .any(|m| m == "tsconfig.json"));
        assert_eq!(profile.primary.as_ref().unwrap().language_id, "typescript");
    }

    #[test]
    fn should_detect_javascript_from_package_json_only() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "package.json", "{}");

        let profile = detect_project_profile(tmp.path().to_str().unwrap());
        assert_eq!(profile.primary.as_ref().unwrap().language_id, "javascript");
    }

    #[test]
    fn should_pick_single_primary_in_monorepo_by_marker_priority() {
        // go.mod is earlier in ROOT_MARKERS than Cargo.toml... wait Cargo is after go
        // go.mod comes first so go should be primary
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "go.mod", "module x\n");
        write(tmp.path(), "Cargo.toml", "[package]\nname=\"y\"\n");

        let profile = detect_project_profile(tmp.path().to_str().unwrap());
        assert_eq!(profile.candidates.len(), 2);
        assert_eq!(profile.primary.as_ref().unwrap().language_id, "go");
    }

    #[test]
    fn should_return_empty_when_no_markers() {
        let tmp = TempDir::new().unwrap();
        let profile = detect_project_profile(tmp.path().to_str().unwrap());
        assert!(profile.candidates.is_empty());
        assert!(profile.primary.is_none());
    }

    #[test]
    fn should_prefer_project_override_over_marker_priority() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "go.mod", "module x\n");
        write(tmp.path(), "Cargo.toml", "[package]\nname=\"y\"\n");

        // Without override: go wins (earlier in ROOT_MARKERS)
        let auto = detect_project_profile(tmp.path().to_str().unwrap());
        assert_eq!(auto.primary.as_ref().unwrap().language_id, "go");

        // With override: rust wins even though go.mod is higher priority
        let forced = detect_project_profile_with_extras(
            tmp.path().to_str().unwrap(),
            &[],
            Some("rust"),
        );
        assert_eq!(forced.primary.as_ref().unwrap().language_id, "rust");
        assert_eq!(forced.candidates.len(), 2);
    }

    #[test]
    fn should_honor_override_when_language_not_in_root_markers() {
        let tmp = TempDir::new().unwrap();
        write(tmp.path(), "Cargo.toml", "[package]\nname=\"y\"\n");

        let profile = detect_project_profile_with_extras(
            tmp.path().to_str().unwrap(),
            &[],
            Some("python"),
        );
        assert_eq!(profile.primary.as_ref().unwrap().language_id, "python");
        assert_eq!(
            profile.primary.as_ref().unwrap().server_name,
            "pyright-langserver"
        );
        // candidates still only reflect root markers
        assert_eq!(profile.candidates.len(), 1);
        assert_eq!(profile.candidates[0].language_id, "rust");
    }

    #[test]
    fn should_pick_primary_from_candidates_matching_override() {
        let candidates = vec![
            DetectedLanguage {
                language_id: "go".into(),
                server_name: "gopls".into(),
                markers: vec!["go.mod".into()],
            },
            DetectedLanguage {
                language_id: "rust".into(),
                server_name: "rust-analyzer".into(),
                markers: vec!["Cargo.toml".into()],
            },
        ];
        let p = pick_primary(&candidates, Some("rust")).unwrap();
        assert_eq!(p.language_id, "rust");
        assert!(p.markers.contains(&"Cargo.toml".into()));
    }

    #[test]
    fn should_ignore_unknown_override_when_candidates_exist() {
        let candidates = vec![DetectedLanguage {
            language_id: "go".into(),
            server_name: "gopls".into(),
            markers: vec!["go.mod".into()],
        }];
        let p = pick_primary(&candidates, Some("not-a-real-lang")).unwrap();
        assert_eq!(p.language_id, "go");
    }

    #[test]
    fn should_use_override_alone_when_no_markers() {
        let tmp = TempDir::new().unwrap();
        let profile = detect_project_profile_with_extras(
            tmp.path().to_str().unwrap(),
            &[],
            Some("go"),
        );
        assert!(profile.candidates.is_empty());
        assert_eq!(profile.primary.as_ref().unwrap().language_id, "go");
        assert_eq!(profile.primary.as_ref().unwrap().server_name, "gopls");
    }
}
