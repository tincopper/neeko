//! Language plugin registry — extension routing and discovery only.
//!
//! Language tables live in [`super::builtins`]; this type only stores and
//! indexes whatever plugins are registered.

use std::collections::HashMap;

use super::builtins;
use super::types::{
    CustomLspServerConfig, LspExtensionConflict, LspExtensionMapEntry, LspPlugin,
};

/// Registry of all available LSP language plugins.
pub struct LspPluginRegistry {
    plugins: HashMap<String, LspPlugin>,
    ext_index: HashMap<String, String>,
    /// ext → language ids that have claimed it (order = registration order; last wins).
    ext_claimants: HashMap<String, Vec<String>>,
}

impl LspPluginRegistry {
    /// Empty registry (tests / custom-only setups).
    pub fn empty() -> Self {
        Self {
            plugins: HashMap::new(),
            ext_index: HashMap::new(),
            ext_claimants: HashMap::new(),
        }
    }

    /// Register all shipped built-in language plugins.
    pub fn with_defaults() -> Self {
        let mut registry = Self::empty();
        for plugin in builtins::all_builtin_plugins() {
            registry.register(plugin);
        }
        registry
    }

    /// Register (or overwrite) a language plugin. Later registrations win on extension conflicts.
    pub fn register(&mut self, plugin: LspPlugin) {
        if self.plugins.contains_key(&plugin.language_id) {
            self.drop_language_claims(&plugin.language_id);
        }

        for ext in &plugin.extensions {
            let key = ext.to_lowercase();
            let claimants = self.ext_claimants.entry(key.clone()).or_default();
            if !claimants.iter().any(|id| id == &plugin.language_id) {
                claimants.push(plugin.language_id.clone());
            }
            self.ext_index.insert(key, plugin.language_id.clone());
        }
        self.plugins.insert(plugin.language_id.clone(), plugin);
    }

    /// Register a user-defined server.
    pub fn register_custom(&mut self, cfg: &CustomLspServerConfig) {
        self.register(LspPlugin::from_custom(cfg));
    }

    /// Remove a plugin by language_id and rebuild extension routing.
    pub fn unregister(&mut self, language_id: &str) {
        if self.plugins.remove(language_id).is_some() {
            self.drop_language_claims(language_id);
        }
    }

    fn drop_language_claims(&mut self, language_id: &str) {
        let exts: Vec<String> = self.ext_claimants.keys().cloned().collect();
        for ext in exts {
            if let Some(claimants) = self.ext_claimants.get_mut(&ext) {
                claimants.retain(|id| id != language_id);
                if claimants.is_empty() {
                    self.ext_claimants.remove(&ext);
                    self.ext_index.remove(&ext);
                } else if let Some(winner) = claimants.last() {
                    self.ext_index.insert(ext, winner.clone());
                }
            }
        }
    }

    /// Drop customs and re-apply built-ins (caller re-registers customs after).
    pub fn reset_to_defaults(&mut self) {
        *self = Self::with_defaults();
    }

    /// Look up a plugin by file extension.
    pub fn resolve_by_extension(&self, ext: &str) -> Option<&LspPlugin> {
        let language_id = self.ext_index.get(&ext.to_lowercase())?;
        self.plugins.get(language_id)
    }

    /// Look up a plugin by language identifier.
    pub fn resolve_by_language(&self, language_id: &str) -> Option<&LspPlugin> {
        self.plugins.get(language_id)
    }

    /// List all registered plugins.
    pub fn list_all(&self) -> Vec<&LspPlugin> {
        self.plugins.values().collect()
    }

    /// Check if a language is registered.
    pub fn is_registered(&self, language_id: &str) -> bool {
        self.plugins.contains_key(language_id)
    }

    /// Full extension map for the frontend.
    pub fn extension_map(&self) -> Vec<LspExtensionMapEntry> {
        let mut out = Vec::new();
        for (ext, lang) in &self.ext_index {
            if let Some(plugin) = self.plugins.get(lang) {
                out.push(LspExtensionMapEntry {
                    extension: ext.clone(),
                    language_id: lang.clone(),
                    server_name: plugin.server_binary.clone(),
                    is_custom: plugin.is_custom,
                });
            }
        }
        out.sort_by(|a, b| a.extension.cmp(&b.extension));
        out
    }

    /// Extensions claimed by more than one language (winner = last registration).
    pub fn extension_conflicts(&self) -> Vec<LspExtensionConflict> {
        let mut out = Vec::new();
        for (ext, claimants) in &self.ext_claimants {
            if claimants.len() < 2 {
                continue;
            }
            let Some(winner) = claimants.last() else {
                continue;
            };
            let displaced: Vec<String> = claimants
                .iter()
                .filter(|id| *id != winner)
                .cloned()
                .collect();
            if displaced.is_empty() {
                continue;
            }
            out.push(LspExtensionConflict {
                extension: ext.clone(),
                winner_language_id: winner.clone(),
                displaced_language_ids: displaced,
            });
        }
        out.sort_by(|a, b| a.extension.cmp(&b.extension));
        out
    }

    /// Root markers for project profile detection from all plugins.
    ///
    /// Returns `(marker_filename, language_id, server_name)` sorted by
    /// plugin `detect_priority` then marker name.
    pub fn detection_markers(&self) -> Vec<(String, String, String)> {
        let mut plugins: Vec<&LspPlugin> = self.plugins.values().collect();
        plugins.sort_by_key(|p| (p.detect_priority, p.language_id.as_str()));

        let mut out = Vec::new();
        for p in plugins {
            for m in &p.root_markers {
                out.push((
                    m.clone(),
                    p.language_id.clone(),
                    p.server_binary.clone(),
                ));
            }
        }
        out
    }

    /// Custom root markers only (compat helper).
    pub fn custom_root_markers(&self) -> Vec<(String, String, String)> {
        let mut out = Vec::new();
        for p in self.plugins.values().filter(|p| p.is_custom) {
            for m in &p.root_markers {
                out.push((
                    m.clone(),
                    p.language_id.clone(),
                    p.server_binary.clone(),
                ));
            }
        }
        out
    }
}

impl Default for LspPluginRegistry {
    fn default() -> Self {
        Self::with_defaults()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lsp::plugin::types::CustomLspServerConfig;

    #[test]
    fn should_resolve_builtin_by_extension() {
        let registry = LspPluginRegistry::with_defaults();
        assert_eq!(
            registry.resolve_by_extension("rs").unwrap().language_id,
            "rust"
        );
        assert_eq!(
            registry.resolve_by_extension("go").unwrap().language_id,
            "go"
        );
        assert!(registry.resolve_by_extension("unknown_ext").is_none());
    }

    #[test]
    fn should_register_custom_and_override_extension() {
        let mut registry = LspPluginRegistry::with_defaults();
        registry.register_custom(&CustomLspServerConfig {
            id: "proto".into(),
            language_id: "protobuf".into(),
            display_name: Some("Buf".into()),
            command: vec!["buf".into(), "beta".into(), "lsp".into()],
            file_extensions: vec!["proto".into(), ".PROTO".into()],
            root_markers: vec!["buf.yaml".into()],
            auto_start: Some("onFirstFile".into()),
            initialization_options: None,
        });

        let p = registry.resolve_by_extension("proto").unwrap();
        assert_eq!(p.language_id, "protobuf");
        assert!(p.is_custom);
        assert!(registry
            .detection_markers()
            .iter()
            .any(|(m, lang, _)| m == "buf.yaml" && lang == "protobuf"));
    }

    #[test]
    fn should_expose_detection_markers_from_builtins() {
        let registry = LspPluginRegistry::with_defaults();
        let markers = registry.detection_markers();
        assert!(markers.iter().any(|(m, lang, _)| m == "Cargo.toml" && lang == "rust"));
        assert!(markers.iter().any(|(m, lang, _)| m == "go.mod" && lang == "go"));
        // Priority: go (5) before rust (10)
        let go_idx = markers.iter().position(|(m, _, _)| m == "go.mod").unwrap();
        let rust_idx = markers
            .iter()
            .position(|(m, _, _)| m == "Cargo.toml")
            .unwrap();
        assert!(go_idx < rust_idx);
    }

    #[test]
    fn should_report_extension_conflict_when_custom_overrides_builtin() {
        let mut registry = LspPluginRegistry::with_defaults();
        assert!(registry.extension_conflicts().is_empty());

        registry.register_custom(&CustomLspServerConfig {
            id: "alt-go".into(),
            language_id: "go-alt".into(),
            display_name: Some("Alt Go".into()),
            command: vec!["alt-gopls".into()],
            file_extensions: vec!["go".into()],
            root_markers: vec![],
            auto_start: None,
            initialization_options: None,
        });

        let conflicts = registry.extension_conflicts();
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].extension, "go");
        assert_eq!(conflicts[0].winner_language_id, "go-alt");
    }

    #[test]
    fn should_reset_to_defaults() {
        let mut registry = LspPluginRegistry::with_defaults();
        registry.register_custom(&CustomLspServerConfig {
            id: "x".into(),
            language_id: "foo".into(),
            display_name: None,
            command: vec!["foo-lsp".into()],
            file_extensions: vec!["foo".into()],
            root_markers: vec![],
            auto_start: None,
            initialization_options: None,
        });
        assert!(registry.is_registered("foo"));
        registry.reset_to_defaults();
        assert!(!registry.is_registered("foo"));
        assert!(registry.is_registered("rust"));
    }
}
