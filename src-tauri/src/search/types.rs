//! Search domain DTOs and shared constants.
//!
//! These types cross the Tauri IPC boundary: command args are deserialized from
//! the frontend, results are serialized back.

use serde::{Deserialize, Serialize};

/// Search mode. Content searches file contents; FileName filters the project
/// file index locally on the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum SearchMode {
    /// Full-text content search (backend executed).
    #[default]
    Content,
    /// File-name fuzzy search (frontend local filter).
    FileName,
}

/// Options that shape how a content search runs.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SearchOptions {
    /// Content vs file-name mode.
    #[serde(default)]
    pub mode: SearchMode,
    /// Case-sensitive matching. Default: case-insensitive.
    #[serde(default)]
    pub case_sensitive: bool,
    /// Whole-word matching (`\b` anchors).
    #[serde(default)]
    pub whole_word: bool,
    /// Treat `query` as a regex. When running remotely this is degraded to a
    /// literal search and `SearchPage::degraded` is set.
    #[serde(default)]
    pub regex: bool,
    /// Optional globs the file path must match (e.g. `["*.ts", "src/**"]`).
    #[serde(default)]
    pub include: Option<Vec<String>>,
    /// Optional globs the file path must not match (e.g. `["node_modules/**"]`).
    #[serde(default)]
    pub exclude: Option<Vec<String>>,
}

/// A single content hit within a file.
#[derive(Debug, Clone, Serialize)]
pub struct SearchMatch {
    /// Project-relative file path (forward slashes).
    #[serde(rename = "path")]
    pub file_path: String,
    /// 1-based line number.
    pub line: u32,
    /// 1-based column of the match.
    pub column: u32,
    /// The matched line text (truncated to [`LINE_TEXT_CAP`] bytes).
    #[serde(rename = "lineText")]
    pub line_text: String,
}

/// A group of matches within a single file.
#[derive(Debug, Clone, Serialize)]
pub struct SearchFileGroup {
    /// Project-relative file path (forward slashes).
    pub path: String,
    /// Matches within this file.
    pub matches: Vec<SearchMatch>,
}

/// Pagination cursor for resuming a search.
#[derive(Debug, Clone, Serialize)]
pub struct SearchCursor {
    /// Current offset (matches already returned).
    pub offset: u32,
    /// Total pages expected; -1 when unknown.
    #[serde(rename = "totalPages")]
    pub total_pages: i32,
}

/// One page of content search results.
#[derive(Debug, Clone, Serialize)]
pub struct SearchPage {
    /// Active request id (for cancellation).
    #[serde(rename = "requestId")]
    pub request_id: String,
    /// The query that produced these results.
    pub query: String,
    /// The project that was searched.
    #[serde(rename = "projectId")]
    pub project_id: String,
    /// Matches grouped by file.
    pub matches: Vec<SearchFileGroup>,
    /// Pagination cursor.
    pub cursor: SearchCursor,
    /// Search was truncated (remote timeout / local total cap).
    pub truncated: bool,
}

/// Default page size used when the caller omits `limit`.
pub const PAGE_LIMIT_DEFAULT: u32 = 100;
/// Hard upper bound for a single page.
pub const PAGE_LIMIT_MAX: u32 = 500;
/// Soft cap on total matches collected locally before pagination.
pub const TOTAL_CAP: usize = 50_000;
/// Remote search timeout: return what was collected when exceeded.
pub const REMOTE_TIMEOUT_MS: u64 = 15_000;
/// Maximum bytes kept for a single matched line (prevents IPC bloat).
pub const LINE_TEXT_CAP: usize = 500;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_default_is_case_insensitive_literal_content_search() {
        let opts = SearchOptions::default();
        assert_eq!(opts.mode, SearchMode::Content);
        assert!(!opts.case_sensitive);
        assert!(!opts.whole_word);
        assert!(!opts.regex);
        assert!(opts.include.is_none());
        assert!(opts.exclude.is_none());
    }

    #[test]
    fn options_deserialize_from_snake_case_json() {
        let json = r#"{"mode":"Content","case_sensitive":true,"regex":true,"include":["*.rs"]}"#;
        let opts: SearchOptions = serde_json::from_str(json).expect("deserialize");
        assert_eq!(opts.mode, SearchMode::Content);
        assert!(opts.case_sensitive);
        assert!(opts.regex);
        assert_eq!(opts.include, Some(vec!["*.rs".to_string()]));
        assert!(opts.exclude.is_none());
    }

    #[test]
    fn options_deserialize_without_mode_defaults_to_content() {
        // The frontend may omit `mode`; it must degrade to Content (not error).
        let json = r#"{"case_sensitive":true,"include":["*.rs"]}"#;
        let opts: SearchOptions = serde_json::from_str(json).expect("deserialize");
        assert_eq!(opts.mode, SearchMode::Content);
        assert!(opts.case_sensitive);
        assert_eq!(opts.include, Some(vec!["*.rs".to_string()]));
    }

    #[test]
    fn options_deserialize_without_any_field_uses_defaults() {
        let json = r#"{}"#;
        let opts: SearchOptions = serde_json::from_str(json).expect("deserialize");
        assert_eq!(opts, SearchOptions::default());
    }

    #[test]
    fn page_serializes_all_fields() {
        let page = SearchPage {
            request_id: "req-1".into(),
            query: "foo".into(),
            project_id: "p-1".into(),
            matches: Vec::new(),
            cursor: SearchCursor {
                offset: 0,
                total_pages: -1,
            },
            truncated: true,
        };
        let json = serde_json::to_string(&page).expect("serialize");
        assert!(json.contains("\"requestId\":\"req-1\""));
        assert!(json.contains("\"query\":\"foo\""));
        assert!(json.contains("\"projectId\":\"p-1\""));
        assert!(json.contains("\"truncated\":true"));
        assert!(json.contains("\"offset\":0"));
        assert!(json.contains("\"totalPages\":-1"));
    }
}
