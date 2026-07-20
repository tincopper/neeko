//! Core plugin types and user-facing settings (no language table).

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

/// Installation recipe for an LSP server (typically built-in).
#[derive(Debug, Clone)]
pub struct LspInstallMethod {
    pub prerequisite: &'static str,
    pub command: &'static [&'static str],
}

/// Descriptor for a language server plugin (built-in or custom).
///
/// Built-ins are produced by modules under [`super::builtins`]; customs via
/// [`LspPlugin::from_custom`]. The registry never hard-codes languages itself.
#[derive(Debug, Clone)]
pub struct LspPlugin {
    pub language_id: String,
    pub extensions: Vec<String>,
    pub server_binary: String,
    pub server_command: Vec<String>,
    pub install: Option<LspInstallMethod>,
    /// Root marker files for project profile detection (e.g. `Cargo.toml`).
    pub root_markers: Vec<String>,
    /// Lower = preferred when multiple languages are detected (primary selection).
    pub detect_priority: u32,
    pub auto_start: LspAutoStart,
    pub is_custom: bool,
    /// Optional `InitializeParams.initializationOptions` for the server.
    pub initialization_options: Option<serde_json::Value>,
}

impl LspPlugin {
    /// Construct a built-in language descriptor (used by `builtins/*` modules).
    pub fn builtin(
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
            detect_priority: 100,
            auto_start: LspAutoStart::OnFirstFile,
            is_custom: false,
            initialization_options: None,
        }
    }

    pub fn with_root_markers(mut self, markers: &[&str]) -> Self {
        self.root_markers = markers.iter().map(|s| (*s).to_string()).collect();
        self
    }

    pub fn with_detect_priority(mut self, priority: u32) -> Self {
        self.detect_priority = priority;
        self
    }

    pub fn with_auto_start(mut self, auto_start: LspAutoStart) -> Self {
        self.auto_start = auto_start;
        self
    }

    pub fn with_initialization_options(mut self, opts: serde_json::Value) -> Self {
        self.initialization_options = Some(opts);
        self
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
            // Customs rank after built-ins for primary selection unless markers-only.
            detect_priority: 200,
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
    /// Passed as LSP `InitializeParams.initializationOptions`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initialization_options: Option<serde_json::Value>,
}

/// An extension claimed by more than one language server (later registration wins).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspExtensionConflict {
    pub extension: String,
    pub winner_language_id: String,
    pub displaced_language_ids: Vec<String>,
}

/// Global LSP settings stored in config.json under `lsp`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspSettings {
    #[serde(default = "default_auto_start")]
    pub auto_start: String,
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
