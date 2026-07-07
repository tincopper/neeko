use serde::{Deserialize, Serialize};

/// Serializable LSP session info for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspSessionInfo {
    pub language_id: String,
    pub project_path: String,
    pub server_name: String,
    pub connected: bool,
}

/// A single diagnostic item, serializable for Tauri IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspDiagnostic {
    pub range: LspRange,
    pub severity: Option<i64>,
    pub message: String,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspRange {
    pub start: LspPosition,
    pub end: LspPosition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspPosition {
    pub line: u32,
    pub character: u32,
}

/// A location result (go-to-definition, references, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspLocation {
    pub uri: String,
    pub range: LspRange,
}

/// Hover result content.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspHoverResult {
    pub contents: Vec<LspMarkupContent>,
    pub range: Option<LspRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LspMarkupContent {
    Plain(String),
    Markup { kind: String, value: String },
}

/// Completion item from LSP.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspCompletionItem {
    pub label: String,
    pub kind: Option<i64>,
    pub detail: Option<String>,
    pub insert_text: Option<String>,
}
