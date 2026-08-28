#![allow(unused_imports, missing_docs)]
use crate::common::git::types::{DiffHunk, DiffLine, DiffResult};

/// 全量 diff 的上下文行数（git2 `context_lines` 使用，u32 与 git2 API 对齐）。
pub const DIFF_FULL_CONTEXT_LINES: u32 = 100_000;
/// 全量 diff 允许的单文件字节上限：超过该值后上下文被限制，
/// 防止 `-U100000` 对超大文件产生超过 IPC 2MB 红线的 JSON 输出。
pub const DIFF_FULL_MAX_FILE_BYTES: u64 = 400_000;
/// 超大文件全量模式回退的上下文行数（仍远大于折叠模式的 3 行）。
pub const DIFF_FULL_FALLBACK_CONTEXT_LINES: u32 = 500;

/// 根据单文件字节数决定全量上下文行数：小文件完整上下文，超大文件受限上下文。
#[must_use]
pub const fn full_diff_context_lines(file_bytes: u64) -> u32 {
    if file_bytes <= DIFF_FULL_MAX_FILE_BYTES {
        DIFF_FULL_CONTEXT_LINES
    } else {
        DIFF_FULL_FALLBACK_CONTEXT_LINES
    }
}

/// 根据单文件字节数生成全量 diff 的 `-U` 参数（shell 路径使用）。
#[must_use]
pub fn full_diff_context_arg(file_bytes: u64) -> String {
    format!("-U{}", full_diff_context_lines(file_bytes))
}

/// Parse git diff --unified=3 text output into DiffResult
#[must_use]
pub fn parse_unified_diff(output: &str) -> DiffResult {
    let mut hunks: Vec<DiffHunk> = Vec::new();

    for line in output.lines() {
        if line.starts_with("@@") {
            if let Some((hunk_header, _)) = parse_hunk_header(line) {
                hunks.push(hunk_header);
            }
        } else if let Some(last) = hunks.last_mut() {
            if line.starts_with('+') && !line.starts_with("+++") {
                last.lines.push(DiffLine::Added(line[1..].to_string()));
            } else if line.starts_with('-') && !line.starts_with("---") {
                last.lines.push(DiffLine::Removed(line[1..].to_string()));
            } else if let Some(stripped) = line.strip_prefix(' ') {
                last.lines.push(DiffLine::Context(stripped.to_string()));
            }
        }
    }

    DiffResult {
        hunks,
        truncated: false,
    }
}

fn parse_hunk_header(line: &str) -> Option<(DiffHunk, &str)> {
    let rest = line.strip_prefix("@@ ")?;
    let rest = rest.strip_prefix('-')?;

    let (old_part, rest) = rest.split_once(' ')?;
    let (old_start, old_lines) = if let Some((s, l)) = old_part.split_once(',') {
        (s.parse::<u32>().ok()?, l.parse::<u32>().ok()?)
    } else {
        (old_part.parse::<u32>().ok()?, 1)
    };

    let rest = rest.strip_prefix('+')?;

    let pos = rest.find(" @@")?;
    let (new_part, _rest) = (&rest[..pos], &rest[pos..]);

    let (new_start, new_lines) = if let Some((s, l)) = new_part.split_once(',') {
        (s.parse::<u32>().ok()?, l.parse::<u32>().ok()?)
    } else {
        (new_part.parse::<u32>().ok()?, 1)
    };

    Some((
        DiffHunk {
            old_start,
            old_lines,
            new_start,
            new_lines,
            lines: Vec::new(),
        },
        _rest,
    ))
}

fn flush_context_buffer(
    collapsed_lines: &mut Vec<DiffLine>,
    buffer: &mut Vec<DiffLine>,
    threshold: usize,
    keep_edges: usize,
) {
    let count = buffer.len();
    let min_keep = keep_edges * 2;
    if count > threshold && count > min_keep {
        let middle = count - min_keep;
        collapsed_lines.extend(buffer.drain(..keep_edges));
        collapsed_lines.push(DiffLine::Collapsed(format!("{} unmodified lines", middle)));
        buffer.drain(..middle);
        collapsed_lines.append(buffer);
    } else {
        collapsed_lines.append(buffer);
    }
}

/// Collapse consecutive context lines, keeping <keep_edges> lines before/after
pub fn collapse_diff_context(hunks: &mut [DiffHunk], threshold: usize) {
    for hunk in hunks.iter_mut() {
        let mut collapsed_lines: Vec<DiffLine> = Vec::new();
        let mut context_buffer: Vec<DiffLine> = Vec::new();
        for line in hunk.lines.drain(..) {
            match &line {
                DiffLine::Context(_) => context_buffer.push(line),
                _ => {
                    flush_context_buffer(&mut collapsed_lines, &mut context_buffer, threshold, 3);
                    collapsed_lines.push(line);
                }
            }
        }
        flush_context_buffer(&mut collapsed_lines, &mut context_buffer, threshold, 3);
        hunk.lines = collapsed_lines;
    }
}

#[cfg(test)]
mod unified_diff_tests {
    use super::*;

    #[test]
    fn should_parse_empty_diff() {
        let result = parse_unified_diff("");
        assert!(result.hunks.is_empty());
    }

    #[test]
    fn should_parse_single_hunk() {
        let diff = r#"@@ -1,3 +1,4 @@
 line1
+added line
 line2
 line3"#;
        let result = parse_unified_diff(diff);
        assert_eq!(result.hunks.len(), 1);
        let hunk = &result.hunks[0];
        assert_eq!(hunk.old_start, 1);
        assert_eq!(hunk.old_lines, 3);
        assert_eq!(hunk.new_start, 1);
        assert_eq!(hunk.new_lines, 4);
        assert_eq!(hunk.lines.len(), 4);
    }

    #[test]
    fn should_parse_added_lines() {
        let diff = r#"@@ -1,1 +1,2 @@
 existing
+new line"#;
        let result = parse_unified_diff(diff);
        let hunk = &result.hunks[0];
        assert!(matches!(hunk.lines[0], DiffLine::Context(_)));
        assert!(matches!(hunk.lines[1], DiffLine::Added(_)));
    }

    #[test]
    fn should_parse_removed_lines() {
        let diff = r#"@@ -1,2 +1,1 @@
-removed line
-removed line2"#;
        let result = parse_unified_diff(diff);
        let hunk = &result.hunks[0];
        assert_eq!(hunk.lines.len(), 2);
        assert!(matches!(hunk.lines[0], DiffLine::Removed(_)));
        assert!(matches!(hunk.lines[1], DiffLine::Removed(_)));
    }

    #[test]
    fn should_parse_multiple_hunks() {
        let diff = r#"@@ -1,3 +1,3 @@
 context1
-old1
+new1
 context2
@@ -10,2 +10,3 @@
 context10
+added
 context11"#;
        let result = parse_unified_diff(diff);
        assert_eq!(result.hunks.len(), 2);
        assert_eq!(result.hunks[0].old_start, 1);
        assert_eq!(result.hunks[1].old_start, 10);
    }

    #[test]
    fn should_skip_diff_headers() {
        let diff = r#"--- a/file.rs
+++ b/file.rs
@@ -1,1 +1,2 @@
 line1
+added"#;
        let result = parse_unified_diff(diff);
        let hunk = &result.hunks[0];
        assert_eq!(hunk.lines.len(), 2);
        assert!(matches!(hunk.lines[0], DiffLine::Context(_)));
        assert!(matches!(hunk.lines[1], DiffLine::Added(_)));
    }

    #[test]
    fn should_parse_hunk_without_line_counts() {
        let diff = "@@ -1 +1 @@\n-old\n+new";
        let result = parse_unified_diff(diff);
        let hunk = &result.hunks[0];
        assert_eq!(hunk.old_start, 1);
        assert_eq!(hunk.old_lines, 1);
        assert_eq!(hunk.new_start, 1);
        assert_eq!(hunk.new_lines, 1);
    }

    #[test]
    fn should_strip_prefix_from_lines() {
        let diff = r#"@@ -1,3 +1,3 @@
 unchanged
-removed
+added"#;
        let result = parse_unified_diff(diff);
        let hunk = &result.hunks[0];

        match &hunk.lines[0] {
            DiffLine::Context(s) => assert_eq!(s, "unchanged"),
            _ => panic!("Expected Context"),
        }
        match &hunk.lines[1] {
            DiffLine::Removed(s) => assert_eq!(s, "removed"),
            _ => panic!("Expected Removed"),
        }
        match &hunk.lines[2] {
            DiffLine::Added(s) => assert_eq!(s, "added"),
            _ => panic!("Expected Added"),
        }
    }
}

#[cfg(test)]
mod diff_context_guard_tests {
    use super::*;

    #[test]
    fn small_file_gets_full_context() {
        assert_eq!(full_diff_context_lines(0), DIFF_FULL_CONTEXT_LINES);
        assert_eq!(
            full_diff_context_lines(DIFF_FULL_MAX_FILE_BYTES),
            DIFF_FULL_CONTEXT_LINES
        );
        assert_eq!(full_diff_context_arg(100_000), "-U100000");
    }

    #[test]
    fn oversized_file_gets_fallback_context() {
        assert_eq!(
            full_diff_context_lines(DIFF_FULL_MAX_FILE_BYTES + 1),
            DIFF_FULL_FALLBACK_CONTEXT_LINES
        );
        assert_eq!(
            full_diff_context_arg(DIFF_FULL_MAX_FILE_BYTES + 1),
            format!("-U{DIFF_FULL_FALLBACK_CONTEXT_LINES}")
        );
        // 回退上下文仍远大于折叠模式的 3 行
        assert!(DIFF_FULL_FALLBACK_CONTEXT_LINES > 3);
    }
}
