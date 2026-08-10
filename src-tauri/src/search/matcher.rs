//! Pattern compilation for content search.
//!
//! A thin, testable layer over `grep_regex::RegexMatcherBuilder` that turns a
//! user query + [`SearchOptions`] into a compiled matcher. This module has no
//! I/O and is fully unit-tested.

use grep_regex::{RegexMatcher, RegexMatcherBuilder};

use crate::common::error::AppError;
use crate::search::types::SearchOptions;

/// Compile a content-search pattern from a query and options.
///
/// * `regex = false` → the query is treated as a literal string.
/// * `regex = true` → the query is compiled with regex syntax; invalid syntax
///   yields `AppError::InvalidInput`.
/// * `whole_word = true` → `\b` anchors are applied by the builder.
/// * `case_sensitive = false` → case-insensitive matching.
pub fn build_matcher(query: &str, opts: &SearchOptions) -> Result<RegexMatcher, AppError> {
    let mut builder = RegexMatcherBuilder::new();
    builder
        .case_insensitive(!opts.case_sensitive)
        .word(opts.whole_word)
        .fixed_strings(!opts.regex);

    builder
        .build(query)
        .map_err(|e| AppError::InvalidInput(format!("Invalid search pattern: {e}")))
}

/// A predicate that tests whether a project-relative path passes the
/// include/exclude glob filters. Empty include list = accept all.
#[derive(Debug, Clone)]
pub struct PathFilter {
    include: Vec<String>,
    exclude: Vec<String>,
}

impl PathFilter {
    /// Build a filter from user-supplied globs.
    #[must_use]
    pub fn new(include: Option<Vec<String>>, exclude: Option<Vec<String>>) -> Self {
        Self {
            include: include.unwrap_or_default(),
            exclude: exclude.unwrap_or_default(),
        }
    }

    /// `true` when the given project-relative path should be searched.
    #[must_use]
    pub fn accepts(&self, path: &str) -> bool {
        if !self.include.is_empty() && !self.include.iter().any(|g| glob_match(g, path)) {
            return false;
        }
        !self.exclude.iter().any(|g| glob_match(g, path))
    }
}

/// Glob matching for include/exclude filters.
///
/// Supports `*` (within a segment), `**` (across segments) and `?`. Matching is
/// anchored to the full path. Patterns without a `/` are additionally matched
/// against the file's basename so `*.rs` works for nested paths.
#[must_use]
pub fn glob_match(pattern: &str, path: &str) -> bool {
    let pat = normalize_pattern(pattern);
    let p = pat.as_bytes();
    let s = path.as_bytes();
    if glob_match_bytes(p, s) {
        return true;
    }
    // Basename fallback: allow bare "*.ext" patterns to match nested paths.
    if !pattern.contains('/') {
        if let Some((_, base)) = path.rsplit_once('/') {
            return glob_match_bytes(p, base.as_bytes());
        }
    }
    false
}

fn normalize_pattern(pattern: &str) -> String {
    pattern.trim().trim_end_matches('/').to_string()
}

fn glob_match_bytes(pat: &[u8], text: &[u8]) -> bool {
    // Convert the simple glob (with `**`) into a regex to get correct segment
    // semantics: `*` matches within a segment, `**` matches across segments.
    let mut re = String::from("^");
    let bytes = pat;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'*' => {
                if i + 1 < bytes.len() && bytes[i + 1] == b'*' {
                    re.push_str(".*");
                    i += 2;
                } else {
                    re.push_str("[^/]*");
                    i += 1;
                }
            }
            b'?' => {
                re.push_str("[^/]");
                i += 1;
            }
            b'.' => {
                re.push_str("\\.");
                i += 1;
            }
            c => {
                let ch = c as char;
                if "\\^$+{}()|[]".contains(ch) {
                    re.push('\\');
                }
                re.push(ch);
                i += 1;
            }
        }
    }
    re.push('$');
    let Ok(r) = regex::Regex::new(&re) else {
        return false;
    };
    r.is_match(std::str::from_utf8(text).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use grep_matcher::Matcher;

    use super::*;

    /// Unwrap the `Result<bool, NoError>` from the `Matcher` trait.
    fn matches(m: &RegexMatcher, text: &str) -> bool {
        m.is_match(text.as_bytes()).unwrap_or(false)
    }

    fn opts() -> SearchOptions {
        SearchOptions::default()
    }

    #[test]
    fn literal_query_matches_substring() {
        let m = build_matcher("foo", &opts()).unwrap();
        assert!(matches(&m, "a foo bar"));
        assert!(matches(&m, "FOO"));
        assert!(!matches(&m, "qux"));
    }

    #[test]
    fn case_sensitive_respects_option() {
        let mut o = opts();
        o.case_sensitive = true;
        let m = build_matcher("Foo", &o).unwrap();
        assert!(matches(&m, "Foo"));
        assert!(!matches(&m, "foo"));
    }

    #[test]
    fn whole_word_requires_boundaries() {
        let mut o = opts();
        o.whole_word = true;
        let m = build_matcher("foo", &o).unwrap();
        assert!(matches(&m, "a foo bar"));
        assert!(!matches(&m, "a foobar baz"));
        assert!(matches(&m, "foo"));
    }

    #[test]
    fn regex_pattern_matches() {
        let mut o = opts();
        o.regex = true;
        let m = build_matcher(r"f\w+", &o).unwrap();
        assert!(matches(&m, "foo"));
        assert!(matches(&m, "faz"));
        assert!(!matches(&m, "bar"));
    }

    #[test]
    fn invalid_regex_returns_invalid_input() {
        let mut o = opts();
        o.regex = true;
        let err = build_matcher("(", &o).unwrap_err();
        assert!(matches!(err, AppError::InvalidInput(_)));
    }

    #[test]
    fn regex_metachars_are_literal_by_default() {
        let m = build_matcher(r"a.b", &opts()).unwrap();
        assert!(matches(&m, "a.b"));
        assert!(!matches(&m, "axb"));
    }

    #[test]
    fn glob_bare_extension_matches_nested_path() {
        assert!(glob_match("*.rs", "src/foo.rs"));
        assert!(glob_match("*.rs", "foo.rs"));
        assert!(!glob_match("*.rs", "foo.txt"));
    }

    #[test]
    fn glob_star_segment_only() {
        assert!(glob_match("src/*.rs", "src/foo.rs"));
        assert!(!glob_match("src/*.rs", "src/a/foo.rs"));
    }

    #[test]
    fn glob_question_mark_matches_single_char() {
        assert!(glob_match("a?.txt", "ab.txt"));
        assert!(!glob_match("a?.txt", "abc.txt"));
    }

    #[test]
    fn glob_trailing_slash_normalized() {
        assert!(glob_match("src/", "src"));
    }

    #[test]
    fn path_filter_include_list_or_semantics() {
        let f = PathFilter::new(Some(vec!["*.rs".into(), "*.ts".into()]), None);
        assert!(f.accepts("main.rs"));
        assert!(f.accepts("src/app.ts"));
        assert!(!f.accepts("main.go"));
    }

    #[test]
    fn path_filter_exclude_wins() {
        let f = PathFilter::new(Some(vec!["*.rs".into()]), Some(vec!["tests/**".into()]));
        assert!(f.accepts("src/main.rs"));
        assert!(!f.accepts("tests/main.rs"));
    }

    #[test]
    fn path_filter_empty_include_accepts_all() {
        let f = PathFilter::new(None, None);
        assert!(f.accepts("anything/at/all.txt"));
    }
}
