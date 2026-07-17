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
    let root = Path::new(project_path);
    let mut by_lang: Vec<DetectedLanguage> = Vec::new();

    // Collect markers present
    let mut found: Vec<(&str, &str, &str)> = Vec::new();
    for &(marker, lang, server) in ROOT_MARKERS {
        if root.join(marker).is_file() {
            found.push((marker, lang, server));
        }
    }

    // Special case: package.json + tsconfig → prefer typescript over javascript
    let has_tsconfig = found.iter().any(|(m, _, _)| *m == "tsconfig.json");
    let has_package = found.iter().any(|(m, _, _)| *m == "package.json");

    for (marker, lang, server) in &found {
        // Skip bare package.json javascript entry when tsconfig elevates to typescript
        if *marker == "package.json" && has_tsconfig {
            // Still record package.json under typescript if we add typescript from tsconfig
            continue;
        }
        // go.sum alone is weak; if go.mod/go.work already added go, just attach marker
        if *marker == "go.sum" {
            if let Some(existing) = by_lang.iter_mut().find(|d| d.language_id == "go") {
                if !existing.markers.iter().any(|m| m == marker) {
                    existing.markers.push((*marker).to_string());
                }
                continue;
            }
        }

        if let Some(existing) = by_lang.iter_mut().find(|d| d.language_id == *lang) {
            if !existing.markers.iter().any(|m| m == marker) {
                existing.markers.push((*marker).to_string());
            }
        } else {
            by_lang.push(DetectedLanguage {
                language_id: (*lang).to_string(),
                server_name: (*server).to_string(),
                markers: vec![(*marker).to_string()],
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

    // Primary: first in ROOT_MARKERS order among detected languages
    let primary = pick_primary(&by_lang);

    ProjectLanguageProfile {
        project_path: project_path.to_string(),
        primary,
        candidates: by_lang,
    }
}

fn pick_primary(candidates: &[DetectedLanguage]) -> Option<DetectedLanguage> {
    if candidates.is_empty() {
        return None;
    }
    // Walk ROOT_MARKERS order for first matching language_id
    for &(_, lang, _) in ROOT_MARKERS {
        if let Some(d) = candidates.iter().find(|c| c.language_id == lang) {
            // Prefer go from go.mod over go.sum-only already handled
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
}
