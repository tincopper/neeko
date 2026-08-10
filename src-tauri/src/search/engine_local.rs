//! Local content-search engine powered by ripgrep's libraries.
//!
//! Uses `ignore::WalkBuilder` (respects `.gitignore`) to enumerate files and
//! `grep_searcher` to match contents efficiently. Runs inside a blocking task
//! to keep the async runtime responsive.

use std::collections::BTreeMap;
use std::path::Path;

use grep_searcher::Sink;
use grep_searcher::{Searcher, SinkMatch};
use ignore::WalkBuilder;

use crate::common::error::AppError;
use crate::search::matcher::{build_matcher, PathFilter};
use crate::search::types::{
    SearchCursor, SearchFileGroup, SearchMatch, SearchOptions, SearchPage, LINE_TEXT_CAP,
    PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX, TOTAL_CAP,
};

/// Collect up to `TOTAL_CAP` matches from `root`, then paginate.
///
/// Blocking I/O — callers must run this inside `spawn_blocking`.
#[allow(clippy::cast_possible_truncation)] // counts are bounded by TOTAL_CAP (u32-safe)
pub fn search_local(
    root: &Path,
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
    let matcher = build_matcher(query, opts)?;
    let filter = PathFilter::new(opts.include.clone(), opts.exclude.clone());
    let page_limit = clamp_limit(limit);

    let mut searcher = Searcher::new();
    // Use BTreeMap for stable file ordering.
    let mut by_file: BTreeMap<String, Vec<SearchMatch>> = BTreeMap::new();
    let mut truncated = false;

    // `require_git(false)` mirrors ripgrep's `--no-require-git` (as VS Code
    // uses): `.gitignore` is respected even when the project is not a git repo.
    let walker = WalkBuilder::new(root)
        .standard_filters(true)
        .require_git(false)
        .build();
    for entry in walker.flatten() {
        if by_file.values().map(|v| v.len()).sum::<usize>() >= TOTAL_CAP {
            truncated = true;
            break;
        }
        let path = entry.path();
        if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            continue;
        }
        let rel_path = relative_path(root, path);
        if !filter.accepts(&rel_path) {
            continue;
        }

        let mut sink = MatchSink {
            file_path: rel_path.clone(),
            matches: by_file.entry(rel_path).or_default(),
        };
        let _ = searcher.search_path(matcher.clone(), path, &mut sink);
    }

    let total: u32 = by_file.values().map(|v| v.len() as u32).sum();
    if total as usize >= TOTAL_CAP {
        truncated = true;
    }

    // Paginate: flatten groups in order, then slice.
    let all_matches: Vec<SearchMatch> = by_file.values().flat_map(|v| v.iter().cloned()).collect();
    let start = (offset as usize).min(all_matches.len());
    let end = (start + page_limit as usize).min(all_matches.len());
    let page_matches = &all_matches[start..end];
    let has_more = (end as u32) < total;

    // Re-group the page's matches by file.
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

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// A sink that appends every match line into a per-file buffer.
struct MatchSink<'a> {
    file_path: String,
    matches: &'a mut Vec<SearchMatch>,
}

impl Sink for MatchSink<'_> {
    type Error = std::io::Error;

    #[allow(clippy::cast_possible_truncation)] // line/column are bounded by file size (u32-safe)
    fn matched(&mut self, _searcher: &Searcher, mat: &SinkMatch<'_>) -> Result<bool, Self::Error> {
        if self.matches.len() >= TOTAL_CAP {
            return Ok(false);
        }
        let Some(line_number) = mat.line_number() else {
            return Ok(true);
        };
        // Raw bytes of the matched line, truncated to a safe cap, lossy-decoded.
        let bytes = mat.lines().next().unwrap_or_default();
        let capped: Vec<u8> = bytes.iter().copied().take(LINE_TEXT_CAP).collect();
        let line_text = String::from_utf8_lossy(&capped).into_owned();

        // Column of the first match on the line (0-based byte offset).
        let column = mat.bytes_range_in_buffer().start;

        self.matches.push(SearchMatch {
            file_path: self.file_path.clone(),
            line: line_number as u32,
            column: (column as u32).saturating_add(1),
            line_text,
        });
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use tempfile::tempdir;

    use super::*;
    use crate::search::types::SearchMode;

    fn write(root: &Path, rel: &str, content: &str) {
        let p = root.join(rel);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(p, content).unwrap();
    }

    fn default_opts() -> SearchOptions {
        SearchOptions::default()
    }

    #[test]
    fn finds_matches_with_line_numbers() {
        let dir = tempdir().unwrap();
        write(
            dir.path(),
            "src/main.rs",
            "fn main() {\n    println!(\"hello neeko\");\n}\n",
        );
        let page = search_local(dir.path(), "neeko", &default_opts(), 0, None).unwrap();
        assert_eq!(page.matches.len(), 1);
        assert_eq!(page.matches[0].path, "src/main.rs");
        assert_eq!(page.matches[0].matches[0].line, 2);
        assert!(page.matches[0].matches[0].line_text.contains("hello neeko"));
        assert!(!page.truncated);
    }

    #[test]
    fn respects_gitignore_and_skips_hidden() {
        let dir = tempdir().unwrap();
        write(dir.path(), ".gitignore", "ignored_dir/\n");
        write(dir.path(), "keep.txt", "needle here");
        write(dir.path(), "ignored_dir/skip.txt", "needle here");
        write(dir.path(), ".hidden.txt", "needle here");
        let page = search_local(dir.path(), "needle", &default_opts(), 0, None).unwrap();
        assert_eq!(page.matches.len(), 1);
        assert_eq!(page.matches[0].path, "keep.txt");
    }

    #[test]
    fn include_glob_filters_files() {
        let dir = tempdir().unwrap();
        write(dir.path(), "a.rs", "token here");
        write(dir.path(), "b.go", "token here");
        let mut opts = default_opts();
        opts.include = Some(vec!["*.rs".into()]);
        let page = search_local(dir.path(), "token", &opts, 0, None).unwrap();
        assert_eq!(page.matches.len(), 1);
        assert_eq!(page.matches[0].path, "a.rs");
    }

    #[test]
    fn whole_word_and_case_sensitive_apply() {
        let dir = tempdir().unwrap();
        write(dir.path(), "x.txt", "foo\nfoobar\nFOO\n");
        let mut opts = default_opts();
        opts.whole_word = true;
        let page = search_local(dir.path(), "foo", &opts, 0, None).unwrap();
        // whole-word + case-insensitive matches "foo" (line 1) and "FOO" (line 3).
        let total: usize = page.matches.iter().map(|g| g.matches.len()).sum();
        assert_eq!(total, 2);
        assert_eq!(page.matches[0].matches[0].line, 1);
        assert_eq!(page.matches[0].matches[1].line, 3);
        opts.case_sensitive = true;
        let page = search_local(dir.path(), "foo", &opts, 0, None).unwrap();
        let total: usize = page.matches.iter().map(|g| g.matches.len()).sum();
        assert_eq!(total, 1);
        assert_eq!(page.matches[0].matches[0].line, 1);
    }

    #[test]
    fn multi_byte_content_matches() {
        let dir = tempdir().unwrap();
        write(dir.path(), "zh.txt", "你好，Neeko 搜索\n");
        let page = search_local(dir.path(), "Neeko", &default_opts(), 0, None).unwrap();
        assert_eq!(page.matches.len(), 1);
        assert!(page.matches[0].matches[0].line_text.contains("Neeko"));
    }

    #[test]
    fn pagination_slices_stable() {
        let dir = tempdir().unwrap();
        let mut content = String::new();
        for i in 0..10 {
            content.push_str(&format!("line {i} has needle\n"));
        }
        write(dir.path(), "f.txt", &content);
        let page = search_local(dir.path(), "needle", &default_opts(), 0, Some(4)).unwrap();
        let page_len: usize = page.matches.iter().map(|g| g.matches.len()).sum();
        assert_eq!(page_len, 4);
        assert_eq!(page.cursor.offset, 4);
        let page2 = search_local(dir.path(), "needle", &default_opts(), 4, Some(4)).unwrap();
        let page2_len: usize = page2.matches.iter().map(|g| g.matches.len()).sum();
        assert_eq!(page2_len, 4);
        assert_eq!(page2.cursor.offset, 8);
        let page3 = search_local(dir.path(), "needle", &default_opts(), 8, Some(4)).unwrap();
        let page3_len: usize = page3.matches.iter().map(|g| g.matches.len()).sum();
        assert_eq!(page3_len, 2);
        assert_eq!(page3.cursor.offset, 10);
    }

    #[test]
    fn empty_query_yields_no_matches() {
        let dir = tempdir().unwrap();
        write(dir.path(), "a.txt", "anything");
        let page = search_local(dir.path(), "", &default_opts(), 0, None).unwrap();
        assert!(page.matches.is_empty());
    }

    #[test]
    fn filename_mode_is_not_backend_executed() {
        // FileName mode is a frontend concern; backend treats it as content
        // but callers should route FileName queries client-side. Guard that
        // mode never silently changes matching semantics.
        let dir = tempdir().unwrap();
        write(dir.path(), "a.txt", "needle");
        let mut opts = default_opts();
        opts.mode = SearchMode::FileName;
        let page = search_local(dir.path(), "needle", &opts, 0, None).unwrap();
        assert_eq!(page.matches.len(), 1);
    }
}
