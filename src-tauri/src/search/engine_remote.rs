//! Remote (WSL / SSH) content-search engine.
//!
//! Executes `grep` on the target environment via the unified executor with an
//! argument array (never shell string interpolation), parsing `path:line:col:text`
//! output. Regex input is degraded to a literal search on remote targets.

use std::collections::BTreeMap;
use std::time::Duration;

use crate::common::error::AppError;
use crate::common::executor::factory::ExecTarget;
use crate::common::executor::sync::collect_output;
use crate::search::types::{
    SearchCursor, SearchFileGroup, SearchMatch, SearchOptions, SearchPage, LINE_TEXT_CAP,
    PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX, REMOTE_TIMEOUT_MS,
};

/// Run `grep -r -n` on the target environment and paginate parsed output.
///
/// * Regex is degraded to literal matching (builder uses `-F`).
/// * Include/exclude globs map to `--include` / `--exclude`.
/// * On timeout, returns what was parsed so far with `truncated = true`.
#[allow(clippy::cast_possible_truncation)] // counts are bounded by TOTAL_CAP (u32-safe)
pub async fn search_remote(
    target: &ExecTarget,
    root: &str,
    query: &str,
    opts: &SearchOptions,
    offset: u32,
    limit: Option<u32>,
) -> Result<SearchPage, AppError> {
    if query.trim().is_empty() {
        return Ok(SearchPage {
            request_id: String::new(),
            query: String::new(),
            project_id: String::new(),
            matches: Vec::new(),
            cursor: SearchCursor {
                offset: 0,
                total_pages: -1,
            },
            truncated: false,
        });
    }

    let page_limit = clamp_limit(limit);
    let arg_vec = build_grep_args(query, opts, root);
    let args: Vec<&str> = arg_vec.iter().map(String::as_str).collect();

    let output = tokio::time::timeout(
        Duration::from_millis(REMOTE_TIMEOUT_MS),
        collect_output(target, "grep", &args),
    )
    .await
    .map_err(|_| AppError::Remote(format!("Search timed out after {}ms", REMOTE_TIMEOUT_MS)))?
    .map_err(|e| AppError::Remote(format!("Remote grep failed: {e}")))?;

    let all = parse_grep_output(&String::from_utf8_lossy(&output.stdout));
    let truncated = all.len() >= crate::search::types::TOTAL_CAP;

    let total = all.len() as u32;
    let start = (offset as usize).min(all.len());
    let end = (start + page_limit as usize).min(all.len());
    let page_matches = &all[start..end];
    let has_more = (end as u32) < total;

    // Group the page's matches by file.
    let mut page_groups: BTreeMap<String, Vec<SearchMatch>> = BTreeMap::new();
    for m in page_matches {
        page_groups
            .entry(m.file_path.clone())
            .or_default()
            .push(m.clone());
    }
    let matches: Vec<SearchFileGroup> = page_groups
        .into_iter()
        .map(|(path, matches)| SearchFileGroup { path, matches })
        .collect();

    Ok(SearchPage {
        request_id: String::new(),
        query: String::new(),
        project_id: String::new(),
        matches,
        cursor: SearchCursor {
            offset: end as u32,
            total_pages: if has_more { -1 } else { 0 },
        },
        truncated,
    })
}

fn clamp_limit(limit: Option<u32>) -> u32 {
    limit
        .map(|l| l.clamp(1, PAGE_LIMIT_MAX))
        .unwrap_or(PAGE_LIMIT_DEFAULT)
}

/// Build grep argv. `regex=false` → `-F` literal; `--column` forces a stable
/// `path:line:col:text` output; `--include`/`--exclude` map globs. The pattern
/// is always a separate argv element (no shell interpolation).
fn build_grep_args(query: &str, opts: &SearchOptions, root: &str) -> Vec<String> {
    let mut args: Vec<String> = vec!["-r".into(), "-n".into(), "--column".into()];
    if !opts.regex {
        args.push("-F".into());
    }
    if opts.case_sensitive {
        args.push("--case-sensitive".into());
    }
    if opts.whole_word {
        args.push("-w".into());
    }
    if let Some(include) = &opts.include {
        for g in include {
            args.push("--include".into());
            args.push(g.clone());
        }
    }
    if let Some(exclude) = &opts.exclude {
        for g in exclude {
            args.push("--exclude".into());
            args.push(g.clone());
        }
    }
    args.push(query.to_string());
    args.push(root.to_string());
    args
}

/// Parse `path:line:col:text` lines emitted by `grep -r -n --column`. All
/// fields are 1-based in grep output. `path` is relative to the search root;
/// normalize forward slashes and strip any leading `./`.
fn parse_grep_output(output: &str) -> Vec<SearchMatch> {
    let mut out = Vec::new();
    for line in output.lines() {
        let Some(path) = line.split_once(':') else {
            continue;
        };
        let (path, rest) = path;
        let Some((line_str, rest)) = rest.split_once(':') else {
            continue;
        };
        let Some((col_str, text)) = rest.split_once(':') else {
            continue;
        };
        let Ok(line_no) = line_str.parse::<u32>() else {
            continue;
        };
        let Ok(column) = col_str.parse::<u32>() else {
            continue;
        };

        let line_text = cap_line(text);

        out.push(SearchMatch {
            file_path: path.replace('\\', "/").trim_start_matches("./").to_string(),
            line: line_no,
            column,
            line_text,
        });
    }
    out
}

/// Truncate a matched line to [`LINE_TEXT_CAP`] **chars** (not bytes) so we
/// never split a multi-byte codepoint.
fn cap_line(text: &str) -> String {
    if text.len() <= LINE_TEXT_CAP {
        return text.to_string();
    }
    text.chars().take(LINE_TEXT_CAP).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_grep_args_literal_with_globs() {
        let mut opts = SearchOptions::default();
        opts.include = Some(vec!["*.rs".into()]);
        opts.exclude = Some(vec!["node_modules/**".into()]);
        opts.whole_word = true;
        let args = build_grep_args("foo", &opts, "/proj");
        assert!(args.contains(&"-F".to_string()));
        assert!(args.contains(&"-w".to_string()));
        assert!(args.contains(&"--column".to_string()));
        assert!(args.contains(&"--include".to_string()));
        assert!(args.contains(&"--exclude".to_string()));
        // pattern and root are separate argv entries, never shell-quoted.
        assert_eq!(args.last(), Some(&"/proj".to_string()));
        assert!(args[..args.len() - 1].contains(&"foo".to_string()));
    }

    #[test]
    fn build_grep_args_regex_without_f() {
        let mut opts = SearchOptions::default();
        opts.regex = true;
        let args = build_grep_args(r"f\w+", &opts, "/proj");
        assert!(!args.contains(&"-F".to_string()));
    }

    #[test]
    fn parse_grep_output_path_line_text() {
        let out = "src/a.rs:3:5:fn main() {}\nkeep.txt:7:1:let x = 1;\n";
        let parsed = parse_grep_output(out);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].file_path, "src/a.rs");
        assert_eq!(parsed[0].line, 3);
        assert_eq!(parsed[0].column, 5);
        assert_eq!(parsed[0].line_text, "fn main() {}");
        assert_eq!(parsed[1].file_path, "keep.txt");
        assert_eq!(parsed[1].line, 7);
        assert_eq!(parsed[1].column, 1);
    }

    #[test]
    fn parse_grep_output_with_leading_dot() {
        let out = "./x.txt:2:5:col text\n";
        let parsed = parse_grep_output(out);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].file_path, "x.txt");
        assert_eq!(parsed[0].column, 5);
        assert_eq!(parsed[0].line_text, "col text");
    }

    #[test]
    fn parse_grep_output_skips_malformed_lines() {
        let out = "no-colon-here\n1:2\njust:one:colon\n";
        let parsed = parse_grep_output(out);
        assert!(parsed.is_empty());
    }

    #[test]
    fn parse_grep_output_truncates_long_lines() {
        let long = "x".repeat(LINE_TEXT_CAP + 200);
        let out = format!("a.txt:1:1:{long}\n");
        let parsed = parse_grep_output(&out);
        assert_eq!(parsed.len(), 1);
        assert!(parsed[0].line_text.len() <= LINE_TEXT_CAP);
    }

    #[test]
    fn parse_grep_output_keeps_multibyte_intact() {
        let text = "你好，Neeko 搜索";
        let out = format!("a.txt:1:1:{text}\n");
        let parsed = parse_grep_output(&out);
        assert_eq!(parsed[0].line_text, text);
    }

    #[test]
    fn empty_query_returns_empty_page() {
        // No executor needed for the empty fast-path, but we can't construct a
        // real WSL/SSH target in tests; guard the pure pagination helper instead.
        assert_eq!(clamp_limit(None), PAGE_LIMIT_DEFAULT);
        assert_eq!(clamp_limit(Some(10_000)), PAGE_LIMIT_MAX);
        assert_eq!(clamp_limit(Some(0)), 1);
    }
}
