use serde::{Deserialize, Serialize};

/// Serializable LSP session info for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspSessionInfo {
    /// Language identifier (e.g. "rust", "go").
    pub language_id: String,
    /// Project filesystem path.
    pub project_path: String,
    /// Server binary name (e.g. "rust-analyzer").
    pub server_name: String,
    /// Session status string (starting, ready, error).
    pub status: String,
    /// Optional human-readable status message.
    pub status_message: Option<String>,
    /// Optional progress percentage.
    pub progress_pct: Option<u32>,
}

/// A single diagnostic item, serializable for Tauri IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspDiagnostic {
    /// Range of the diagnostic.
    pub range: LspRange,
    /// Severity level (1=error, 2=warning, 3=info, 4=hint).
    pub severity: Option<i64>,
    /// Diagnostic message.
    pub message: String,
    /// Source of the diagnostic (e.g. "rustc").
    pub source: Option<String>,
}

/// A range in a text document (0-based).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspRange {
    /// Start position (inclusive).
    pub start: LspPosition,
    /// End position (inclusive).
    pub end: LspPosition,
}

/// A position in a text document (0-based line and character).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspPosition {
    /// Line number (0-based).
    pub line: u32,
    /// Character offset (0-based).
    pub character: u32,
}

/// A location result (go-to-definition, references, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspLocation {
    /// Document URI.
    pub uri: String,
    /// Range in the document.
    pub range: LspRange,
}

/// Hover result content.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspHoverResult {
    /// Hover content items (plain text or markup).
    pub contents: Vec<LspMarkupContent>,
    /// Optional range for the hover.
    pub range: Option<LspRange>,
}

/// Markup content from an LSP hover response (plain text or structured markup).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LspMarkupContent {
    /// Plain text content.
    Plain(String),
    /// Structured markup content with a kind (e.g. "markdown").
    Markup {
        /// Content format kind (e.g. "markdown").
        kind: String,
        /// The markup value string.
        value: String,
    },
}

/// Completion item from LSP.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspCompletionItem {
    /// Completion label displayed to the user.
    pub label: String,
    /// Completion kind (method, function, variable, etc.).
    pub kind: Option<i64>,
    /// Additional detail text.
    pub detail: Option<String>,
    /// Text to insert when selected.
    pub insert_text: Option<String>,
}
