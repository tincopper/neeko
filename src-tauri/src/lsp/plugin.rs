use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// When to spawn a language server process.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum LspAutoStart {
    /// Spawn only when a matching file is opened (default).
    #[default]
    OnFirstFile,
    /// Spawn when the project becomes active (if detected as primary / marker hit).
    OnProjectSelect,
    /// Never auto-spawn; user must start manually.
    Manual,
}

impl LspAutoStart {
    pub fn parse(s: &str) -> Self {
        match s {
            "onProjectSelect" | "on_project_select" => Self::OnProjectSelect,
            "manual" => Self::Manual,
            _ => Self::OnFirstFile,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::OnFirstFile => "onFirstFile",
            Self::OnProjectSelect => "onProjectSelect",
            Self::Manual => "manual",
        }
    }
}

/// Installation method for an LSP server (built-in only).
#[derive(Debug, Clone)]
pub struct LspInstallMethod {
    pub prerequisite: &'static str,
    pub command: &'static [&'static str],
}

/// Descriptor for a language server plugin (built-in or custom).
#[derive(Debug, Clone)]
pub struct LspPlugin {
    pub language_id: String,
    pub extensions: Vec<String>,
    pub server_binary: String,
    pub server_command: Vec<String>,
    pub install: Option<LspInstallMethod>,
    /// Optional root markers for project detection (custom servers).
    pub root_markers: Vec<String>,
    pub auto_start: LspAutoStart,
    pub is_custom: bool,
    /// Optional `InitializeParams.initializationOptions` for the server.
    pub initialization_options: Option<serde_json::Value>,
}

impl LspPlugin {
    fn builtin(
        language_id: &str,
        extensions: &[&str],
        server_binary: &str,
        server_command: &[&str],
        install: Option<LspInstallMethod>,
    ) -> Self {
        Self {
            language_id: language_id.to_string(),
            extensions: extensions.iter().map(|s| (*s).to_string()).collect(),
            server_binary: server_binary.to_string(),
            server_command: server_command.iter().map(|s| (*s).to_string()).collect(),
            install,
            root_markers: Vec::new(),
            auto_start: LspAutoStart::OnFirstFile,
            is_custom: false,
            initialization_options: None,
        }
    }

    /// Build a plugin from a user-defined custom server config.
    pub fn from_custom(cfg: &CustomLspServerConfig) -> Self {
        let binary = cfg
            .command
            .first()
            .cloned()
            .unwrap_or_else(|| cfg.language_id.clone());
        let exts: Vec<String> = cfg
            .file_extensions
            .iter()
            .map(|e| e.trim_start_matches('.').to_lowercase())
            .filter(|e| !e.is_empty())
            .collect();
        Self {
            language_id: cfg.language_id.clone(),
            extensions: exts,
            server_binary: binary,
            server_command: cfg.command.clone(),
            install: None,
            root_markers: cfg.root_markers.clone(),
            auto_start: cfg
                .auto_start
                .as_deref()
                .map(LspAutoStart::parse)
                .unwrap_or(LspAutoStart::OnFirstFile),
            is_custom: true,
            initialization_options: cfg.initialization_options.clone(),
        }
    }
}

/// User-defined language server (stored in config.json under `lsp.customServers`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomLspServerConfig {
    pub id: String,
    pub language_id: String,
    #[serde(default)]
    pub display_name: Option<String>,
    /// argv, e.g. ["foo-lsp", "--stdio"]
    pub command: Vec<String>,
    /// File extensions without leading dots, e.g. ["proto", "foo"].
    /// JSON key is `file_extensions` (also accepts camelCase `fileExtensions`).
    #[serde(
        default,
        rename = "file_extensions",
        alias = "fileExtensions"
    )]
    pub file_extensions: Vec<String>,
    #[serde(default)]
    pub root_markers: Vec<String>,
    /// "onFirstFile" | "onProjectSelect" | "manual"
    #[serde(default)]
    pub auto_start: Option<String>,
    /// Passed as LSP `InitializeParams.initializationOptions` (any JSON object/array).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initialization_options: Option<serde_json::Value>,
}

/// An extension claimed by more than one language server (later registration wins).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspExtensionConflict {
    pub extension: String,
    /// Language currently winning the route (last registration).
    pub winner_language_id: String,
    /// Other language ids that also declared this extension.
    pub displaced_language_ids: Vec<String>,
}

/// Global LSP settings stored in config.json under `lsp`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspSettings {
    /// Default auto-start policy for built-in servers.
    #[serde(default = "default_auto_start")]
    pub auto_start: String,
    /// Minutes after project deactivation before closing LSP sessions.
    #[serde(default = "default_deactivate_minutes")]
    pub deactivate_stop_minutes: u64,
    #[serde(default)]
    pub custom_servers: Vec<CustomLspServerConfig>,
}

fn default_auto_start() -> String {
    "onFirstFile".into()
}

fn default_deactivate_minutes() -> u64 {
    30
}

impl Default for LspSettings {
    fn default() -> Self {
        Self {
            auto_start: default_auto_start(),
            deactivate_stop_minutes: default_deactivate_minutes(),
            custom_servers: Vec::new(),
        }
    }
}

/// Extension → languageId map entry for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspExtensionMapEntry {
    pub extension: String,
    pub language_id: String,
    pub server_name: String,
    pub is_custom: bool,
}

/// Registry of all available LSP language plugins.
pub struct LspPluginRegistry {
    plugins: HashMap<String, LspPlugin>,
    ext_index: HashMap<String, String>,
    /// ext → language ids that have claimed it (order = registration order; last wins).
    ext_claimants: HashMap<String, Vec<String>>,
}

impl LspPluginRegistry {
    pub fn with_defaults() -> Self {
        let mut registry = Self {
            plugins: HashMap::new(),
            ext_index: HashMap::new(),
            ext_claimants: HashMap::new(),
        };

        registry.register(LspPlugin::builtin(
            "rust",
            &["rs"],
            "rust-analyzer",
            &["rust-analyzer"],
            Some(LspInstallMethod {
                prerequisite: "rustup",
                command: &["rustup", "component", "add", "rust-analyzer"],
            }),
        ));
        registry.register(LspPlugin::builtin(
            "python",
            &["py"],
            "pyright-langserver",
            &["pyright-langserver", "--stdio"],
            Some(LspInstallMethod {
                prerequisite: "npm",
                command: &["npm", "install", "-g", "pyright"],
            }),
        ));
        registry.register(LspPlugin::builtin(
            "typescript",
            &["ts"],
            "typescript-language-server",
            &["typescript-language-server", "--stdio"],
            Some(LspInstallMethod {
                prerequisite: "npm",
                command: &["npm", "install", "-g", "typescript-language-server"],
            }),
        ));
        registry.register(LspPlugin::builtin(
            "typescriptreact",
            &["tsx"],
            "typescript-language-server",
            &["typescript-language-server", "--stdio"],
            Some(LspInstallMethod {
                prerequisite: "npm",
                command: &["npm", "install", "-g", "typescript-language-server"],
            }),
        ));
        registry.register(LspPlugin::builtin(
            "javascript",
            &["js"],
            "typescript-language-server",
            &["typescript-language-server", "--stdio"],
            Some(LspInstallMethod {
                prerequisite: "npm",
                command: &["npm", "install", "-g", "typescript-language-server"],
            }),
        ));
        registry.register(LspPlugin::builtin(
            "javascriptreact",
            &["jsx"],
            "typescript-language-server",
            &["typescript-language-server", "--stdio"],
            Some(LspInstallMethod {
                prerequisite: "npm",
                command: &["npm", "install", "-g", "typescript-language-server"],
            }),
        ));
        registry.register(LspPlugin::builtin(
            "go",
            &["go"],
            "gopls",
            &["gopls"],
            Some(LspInstallMethod {
                prerequisite: "go",
                command: &["go", "install", "golang.org/x/tools/gopls@latest"],
            }),
        ));
        registry.register(LspPlugin::builtin(
            "java",
            &["java"],
            "jdtls",
            &["jdtls"],
            Some(LspInstallMethod {
                prerequisite: "npm",
                command: &["npm", "install", "-g", "@eclipse-wtp/jdtls"],
            }),
        ));
        registry.register(LspPlugin::builtin(
            "c",
            &["c", "h"],
            "clangd",
            &["clangd"],
            None,
        ));
        registry.register(LspPlugin::builtin(
            "cpp",
            &["cpp", "hpp", "cc", "cxx"],
            "clangd",
            &["clangd"],
            None,
        ));
        registry.register(LspPlugin::builtin(
            "csharp",
            &["cs"],
            "omnisharp",
            &["omnisharp", "-lsp"],
            None,
        ));
        registry.register(LspPlugin::builtin(
            "ruby",
            &["rb"],
            "solargraph",
            &["solargraph", "stdio"],
            Some(LspInstallMethod {
                prerequisite: "gem",
                command: &["gem", "install", "solargraph"],
            }),
        ));
        registry.register(LspPlugin::builtin(
            "php",
            &["php"],
            "intelephense",
            &["intelephense", "--stdio"],
            Some(LspInstallMethod {
                prerequisite: "npm",
                command: &["npm", "install", "-g", "intelephense"],
            }),
        ));
        registry.register(LspPlugin::builtin(
            "swift",
            &["swift"],
            "sourcekit-lsp",
            &["sourcekit-lsp"],
            None,
        ));
        registry.register(LspPlugin::builtin(
            "kotlin",
            &["kt", "kts"],
            "kotlin-language-server",
            &["kotlin-language-server"],
            None,
        ));
        registry.register(LspPlugin::builtin(
            "lua",
            &["lua"],
            "lua-language-server",
            &["lua-language-server"],
            None,
        ));
        registry.register(LspPlugin::builtin(
            "elixir",
            &["ex", "exs"],
            "elixir-ls",
            &["elixir-ls"],
            None,
        ));
        registry.register(LspPlugin::builtin(
            "r",
            &["r"],
            "R",
            &["R", "--slave", "-e", "languageserver::run()"],
            None,
        ));
        registry.register(LspPlugin::builtin(
            "sql",
            &["sql"],
            "sql-language-server",
            &["sql-language-server", "up", "--method", "stdio"],
            Some(LspInstallMethod {
                prerequisite: "npm",
                command: &["npm", "install", "-g", "sql-language-server"],
            }),
        ));

        registry
    }

    /// Register (or overwrite) a language plugin. Later registrations win on extension conflicts.
    pub fn register(&mut self, plugin: LspPlugin) {
        // If re-registering the same language, drop its previous extension claims first.
        if self.plugins.contains_key(&plugin.language_id) {
            self.drop_language_claims(&plugin.language_id);
        }

        for ext in &plugin.extensions {
            let key = ext.to_lowercase();
            let claimants = self.ext_claimants.entry(key.clone()).or_default();
            if !claimants.iter().any(|id| id == &plugin.language_id) {
                claimants.push(plugin.language_id.clone());
            }
            // Last registration wins the live route.
            self.ext_index
                .insert(key, plugin.language_id.clone());
        }
        self.plugins.insert(plugin.language_id.clone(), plugin);
    }

    /// Remove a plugin by language_id and rebuild extension routing from remaining claimants.
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

    /// Drop all custom plugins and re-apply built-ins (then caller can re-register customs).
    pub fn reset_to_defaults(&mut self) {
        *self = Self::with_defaults();
    }

    pub fn resolve_by_extension(&self, ext: &str) -> Option<&LspPlugin> {
        let language_id = self.ext_index.get(&ext.to_lowercase())?;
        self.plugins.get(language_id)
    }

    pub fn resolve_by_language(&self, language_id: &str) -> Option<&LspPlugin> {
        self.plugins.get(language_id)
    }

    pub fn list_all(&self) -> Vec<&LspPlugin> {
        self.plugins.values().collect()
    }

    pub fn is_registered(&self, language_id: &str) -> bool {
        self.plugins.contains_key(language_id)
    }

    /// Full extension map for the frontend (custom entries override built-ins).
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

    /// Custom root markers for project profile detection.
    pub fn custom_root_markers(&self) -> Vec<(String, String, String)> {
        // (marker, language_id, server_name)
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

    #[test]
    fn test_resolve_by_extension() {
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
    fn test_custom_plugin_file_extensions_override() {
        let mut registry = LspPluginRegistry::with_defaults();
        registry.register(LspPlugin::from_custom(&CustomLspServerConfig {
            id: "proto".into(),
            language_id: "protobuf".into(),
            display_name: Some("Buf".into()),
            command: vec!["buf".into(), "beta".into(), "lsp".into()],
            file_extensions: vec!["proto".into(), ".PROTO".into()],
            root_markers: vec!["buf.yaml".into()],
            auto_start: Some("onFirstFile".into()),
            initialization_options: None,
        }));

        let p = registry.resolve_by_extension("proto").unwrap();
        assert_eq!(p.language_id, "protobuf");
        assert!(p.is_custom);
        assert_eq!(p.server_command[0], "buf");
        // normalized lowercase without dot
        assert!(registry.resolve_by_extension("PROTO").is_some());
    }

    #[test]
    fn test_extension_map_includes_custom() {
        let mut registry = LspPluginRegistry::with_defaults();
        registry.register(LspPlugin::from_custom(&CustomLspServerConfig {
            id: "x".into(),
            language_id: "foo".into(),
            display_name: None,
            command: vec!["foo-lsp".into()],
            file_extensions: vec!["foo".into()],
            root_markers: vec![],
            auto_start: None,
            initialization_options: None,
        }));
        let map = registry.extension_map();
        assert!(map.iter().any(|e| e.extension == "foo" && e.is_custom));
    }

    #[test]
    fn test_resolve_by_language() {
        let registry = LspPluginRegistry::with_defaults();
        assert_eq!(
            registry.resolve_by_language("rust").unwrap().server_command[0],
            "rust-analyzer"
        );
    }

    #[test]
    fn test_list_all() {
        let registry = LspPluginRegistry::with_defaults();
        let all = registry.list_all();
        assert!(all.iter().any(|p| p.language_id == "go"));
    }

    #[test]
    fn should_report_extension_conflict_when_custom_overrides_builtin() {
        let mut registry = LspPluginRegistry::with_defaults();
        assert!(registry.extension_conflicts().is_empty());

        // Steal "go" from gopls with a custom server.
        registry.register(LspPlugin::from_custom(&CustomLspServerConfig {
            id: "alt-go".into(),
            language_id: "go-alt".into(),
            display_name: Some("Alt Go".into()),
            command: vec!["alt-gopls".into()],
            file_extensions: vec!["go".into()],
            root_markers: vec![],
            auto_start: None,
            initialization_options: None,
        }));

        let conflicts = registry.extension_conflicts();
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].extension, "go");
        assert_eq!(conflicts[0].winner_language_id, "go-alt");
        assert!(conflicts[0]
            .displaced_language_ids
            .iter()
            .any(|id| id == "go"));
        assert_eq!(
            registry.resolve_by_extension("go").unwrap().language_id,
            "go-alt"
        );
    }

    #[test]
    fn should_carry_initialization_options_from_custom_config() {
        let opts = serde_json::json!({ "hoverKind": "FullDocumentation" });
        let plugin = LspPlugin::from_custom(&CustomLspServerConfig {
            id: "gopls-custom".into(),
            language_id: "go".into(),
            display_name: None,
            command: vec!["gopls".into()],
            file_extensions: vec!["go".into()],
            root_markers: vec![],
            auto_start: None,
            initialization_options: Some(opts.clone()),
        });
        assert_eq!(plugin.initialization_options, Some(opts));
    }
}
