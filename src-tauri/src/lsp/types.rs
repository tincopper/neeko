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

/// Runtime metadata for a language server (submenu footer).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LspServerInfo {
    /// Parsed version string (e.g. "1.97.1").
    pub version: String,
    /// Short commit hash when available.
    pub commit: String,
    /// Build / release date when available (YYYY-MM-DD).
    pub build_date: String,
    /// Process RSS in megabytes (snapshot at request time).
    pub memory_mb: f64,
}

/// One stderr / log line captured from an LSP server process.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LspServerLogEntry {
    /// ISO-8601 timestamp.
    pub timestamp: String,
    /// Log level: debug | info | warn | error.
    pub level: String,
    /// Raw log message line.
    pub message: String,
}

impl LspServerInfo {
    /// Empty / unknown metadata used when version parse or process lookup fails.
    #[must_use]
    pub const fn unknown() -> Self {
        Self {
            version: String::new(),
            commit: String::new(),
            build_date: String::new(),
            memory_mb: 0.0,
        }
    }
}

/// Best-effort parse of language-server `--version` stdout/stderr.
///
/// Handles common shapes:
/// - `rust-analyzer 1.97.1 (8bab26f4 2026-07-14)`
/// - `golang.org/x/tools/gopls v0.16.1`
/// - `Version 5.4.2`
#[must_use]
pub fn parse_server_version_output(output: &str) -> LspServerInfo {
    let line = output
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .to_string();

    if line.is_empty() {
        return LspServerInfo::unknown();
    }

    let mut version = String::new();
    let mut commit = String::new();
    let mut build_date = String::new();

    // Prefer parenthetical: (commit date) or (commit)
    if let Some(open) = line.rfind('(') {
        if let Some(close) = line[open..].find(')') {
            let inner = line[open + 1..open + close].trim();
            let parts: Vec<&str> = inner.split_whitespace().collect();
            if let Some(first) = parts.first() {
                // The parenthetical opens with the short commit hash (when present).
                if !first.is_empty() {
                    commit = (*first).to_string();
                }
            }
            if parts.len() >= 2 {
                let maybe_date = parts[1];
                if maybe_date.len() >= 8 && maybe_date.contains('-') {
                    build_date = maybe_date.to_string();
                }
            }
            // version is last token before '('
            let before = line[..open].trim();
            version = extract_version_token(before).unwrap_or_else(|| before.to_string());
        }
    }

    if version.is_empty() {
        version = extract_version_token(&line).unwrap_or_else(|| line.clone());
    }

    // Strip leading 'v'
    if version.starts_with('v') || version.starts_with('V') {
        let rest = &version[1..];
        if rest.starts_with(|c: char| c.is_ascii_digit()) {
            version = rest.to_string();
        }
    }

    LspServerInfo {
        version,
        commit,
        build_date,
        memory_mb: 0.0,
    }
}

fn extract_version_token(s: &str) -> Option<String> {
    // Find a token that looks like a semver (optionally prefixed with v)
    for token in s.split_whitespace().rev() {
        let t = token.trim_matches(|c: char| c == ',' || c == ';');
        let bare = t
            .strip_prefix('v')
            .or_else(|| t.strip_prefix('V'))
            .unwrap_or(t);
        if bare.chars().next().is_some_and(|c| c.is_ascii_digit()) && bare.contains('.') {
            return Some(bare.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_rust_analyzer_version() {
        let info = parse_server_version_output("rust-analyzer 1.97.1 (8bab26f4 2026-07-14)\n");
        assert_eq!(info.version, "1.97.1");
        assert_eq!(info.commit, "8bab26f4");
        assert_eq!(info.build_date, "2026-07-14");
    }

    #[test]
    fn parse_gopls_version() {
        let info = parse_server_version_output("golang.org/x/tools/gopls v0.16.1\n");
        assert_eq!(info.version, "0.16.1");
        assert!(info.commit.is_empty());
    }

    #[test]
    fn parse_version_keyword() {
        let info = parse_server_version_output("Version 5.4.2\n");
        assert_eq!(info.version, "5.4.2");
    }

    #[test]
    fn server_info_serializes_camel_case() {
        let info = LspServerInfo {
            version: "1.0.0".into(),
            commit: "abc".into(),
            build_date: "2026-01-01".into(),
            memory_mb: 12.5,
        };
        let v = serde_json::to_value(&info).unwrap();
        assert_eq!(v["version"], "1.0.0");
        assert_eq!(v["buildDate"], "2026-01-01");
        assert_eq!(v["memoryMb"], 12.5);
        assert_eq!(v["commit"], "abc");
    }

    #[test]
    fn log_entry_serializes_camel_case() {
        let entry = LspServerLogEntry {
            timestamp: "2026-07-29T00:00:00Z".into(),
            level: "warn".into(),
            message: "hello".into(),
        };
        let v = serde_json::to_value(&entry).unwrap();
        assert_eq!(v["timestamp"], "2026-07-29T00:00:00Z");
        assert_eq!(v["level"], "warn");
        assert_eq!(v["message"], "hello");
    }
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
