//! Project language profile detection from plugin root markers.
//!
//! Detection markers come from the plugin registry (built-ins + customs) —
//! this module has **no** hard-coded language table.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::plugin::DetectionMarker;

/// A language detected (or registered) for a project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedLanguage {
    /// Language identifier (e.g. "rust", "go").
    pub language_id: String,
    /// LSP server binary name for this language.
    pub server_name: String,
    /// Root marker files that caused this detection (e.g. "go.mod").
    pub markers: Vec<String>,
}

/// Result of scanning a project root for language servers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLanguageProfile {
    /// Filesystem path of the scanned project.
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
#[must_use]
pub fn detect_project_profile(project_path: &str) -> ProjectLanguageProfile {
    use super::plugin::LspPluginRegistry;
    let markers = LspPluginRegistry::with_defaults().detection_markers();
    detect_project_profile_with_markers(project_path, &markers, None)
}

/// Detect using an explicit ordered marker list
/// `(marker_filename, language_id, server_name)`.
///
/// Marker order implies detection preference for primary selection when no
/// override is set (first detected language wins after the declarative
/// suppression rules carried by each [`DetectionMarker`]).
///
/// `primary_override` wins when it matches a candidate; if not among markers
/// but non-empty, a synthetic primary is created when server_name is provided
/// via the first matching marker entry for that language id in `markers`.
#[must_use]
pub fn detect_project_profile_with_markers(
    project_path: &str,
    markers: &[DetectionMarker],
    primary_override: Option<&str>,
) -> ProjectLanguageProfile {
    let root = Path::new(project_path);

    let present: Vec<&str> = markers
        .iter()
        .filter(|m| root.join(&m.marker).is_file())
        .map(|m| m.marker.as_str())
        .collect();

    // 声明式压制（取代原先 `marker == "package.json" && has_tsconfig &&
    // lang == "javascript"` 的语言特例）：更特定的同族语言存在时，本条目退出候选。
    // 规则来自插件数据（`LspPlugin::detect_suppressed_by`），本模块不含任何语言名。
    let effective: Vec<&DetectionMarker> = markers
        .iter()
        .filter(|m| present.contains(&m.marker.as_str()))
        .filter(|m| {
            !m.suppressed_by
                .iter()
                .any(|s| present.contains(&s.as_str()))
        })
        .collect();

    let mut by_lang: HashMap<String, DetectedLanguage> = HashMap::new();
    let mut order: Vec<String> = Vec::new();

    for m in &effective {
        // go.sum alone is weak if go already present — still attach marker
        if let Some(existing) = by_lang.get_mut(&m.language_id) {
            if !existing.markers.iter().any(|x| x == &m.marker) {
                existing.markers.push(m.marker.clone());
            }
            continue;
        }
        order.push(m.language_id.clone());
        by_lang.insert(
            m.language_id.clone(),
            DetectedLanguage {
                language_id: m.language_id.clone(),
                server_name: m.server_name.clone(),
                markers: vec![m.marker.clone()],
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

fn select_primary(
    candidates: &[DetectedLanguage],
    all_markers: &[DetectionMarker],
    primary_override: Option<&str>,
) -> Option<DetectedLanguage> {
    if let Some(override_id) = primary_override {
        if let Some(found) = candidates.iter().find(|c| c.language_id == override_id) {
            return Some(found.clone());
        }
        // Synthetic primary when override language is known to the marker catalog
        if let Some(m) = all_markers.iter().find(|m| m.language_id == override_id) {
            return Some(DetectedLanguage {
                language_id: override_id.to_string(),
                server_name: m.server_name.clone(),
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
    use crate::lsp::plugin::registry::DetectionMarker;
    use crate::lsp::plugin::LspPluginRegistry;
    use std::fs;
    use tempfile::tempdir;

    /// 造一条检测标记记录（压制规则默认空）。
    fn marker(marker: &str, language_id: &str, suppressed_by: &[&str]) -> DetectionMarker {
        DetectionMarker {
            marker: marker.to_string(),
            language_id: language_id.to_string(),
            server_name: format!("{language_id}-ls"),
            suppressed_by: suppressed_by.iter().map(|s| (*s).to_string()).collect(),
        }
    }

    fn markers() -> Vec<DetectionMarker> {
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

    /// 数据化证明：压制规则来自插件数据 —— **自定义插件**声明 `suppressed_by` 即生效。
    /// 语言特例（`language_id == "javascript"`）写死在代码里时，这条不可能通过。
    #[test]
    fn custom_plugin_suppression_is_data_not_code() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("tsconfig.json"), "{}\n").unwrap();
        fs::write(dir.path().join("mylang.toml"), "x = 1\n").unwrap();
        let markers = vec![
            marker("tsconfig.json", "typescript", &[]),
            marker("mylang.toml", "mylang", &["tsconfig.json"]),
        ];

        let profile =
            detect_project_profile_with_markers(&dir.path().to_string_lossy(), &markers, None);

        assert!(
            !profile.candidates.iter().any(|c| c.language_id == "mylang"),
            "声明了 suppressed_by 的插件在压制标记存在时必须退出候选: {:?}",
            profile.candidates
        );
        assert_eq!(
            profile.primary.as_ref().map(|p| p.language_id.as_str()),
            Some("typescript")
        );
    }

    /// 反向钉：压制标记**不存在**时，声明了 suppressed_by 的插件必须照常参与候选。
    #[test]
    fn suppression_only_applies_when_the_marker_is_present() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("mylang.toml"), "x = 1\n").unwrap();
        let markers = vec![
            marker("tsconfig.json", "typescript", &[]),
            marker("mylang.toml", "mylang", &["tsconfig.json"]),
        ];

        let profile =
            detect_project_profile_with_markers(&dir.path().to_string_lossy(), &markers, None);

        assert_eq!(
            profile.primary.as_ref().map(|p| p.language_id.as_str()),
            Some("mylang")
        );
    }

    /// `jsconfig.json` 是 **JS 工程配置**，不得压制 javascript（数据契约钉，
    /// 防止后人"顺手补全"压制表）。
    #[test]
    fn jsconfig_does_not_suppress_javascript() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("jsconfig.json"), "{}\n").unwrap();
        fs::write(dir.path().join("package.json"), "{}\n").unwrap();
        let markers = vec![
            marker("jsconfig.json", "javascript", &["tsconfig.json"]),
            marker("package.json", "javascript", &["tsconfig.json"]),
        ];

        let profile =
            detect_project_profile_with_markers(&dir.path().to_string_lossy(), &markers, None);

        assert_eq!(
            profile.primary.as_ref().map(|p| p.language_id.as_str()),
            Some("javascript")
        );
    }

    /// 三 marker 共存（`tsconfig.json` + `jsconfig.json` + `package.json`）：
    /// 数据化后 javascript **不**入候选。
    ///
    /// 这是"压制规则从 **marker 级** 变 **plugin 级**"带来的唯一行为增量 —— 旧实现
    /// 只跳过 `package.json` 那一条（`if marker == "package.json" && has_tsconfig ...`），
    /// `jsconfig.json` 条目仍在 → javascript 仍候选。此处显式钉住新语义：
    /// **有 tsconfig 即视为 TS 工程**，jsconfig 不得让 javascript 复活。
    #[test]
    fn tsconfig_suppresses_javascript_even_with_jsconfig_present() {
        let dir = tempdir().unwrap();
        for f in ["tsconfig.json", "jsconfig.json", "package.json"] {
            fs::write(dir.path().join(f), "{}\n").unwrap();
        }

        let profile =
            detect_project_profile_with_markers(&dir.path().to_string_lossy(), &markers(), None);

        assert_eq!(
            profile.primary.as_ref().map(|p| p.language_id.as_str()),
            Some("typescript")
        );
        assert!(
            !profile
                .candidates
                .iter()
                .any(|c| c.language_id == "javascript"),
            "tsconfig 存在 ⇒ TS 工程，javascript 不得因 jsconfig 复活: {:?}",
            profile.candidates
        );
    }
}
