#![allow(unused_imports, missing_docs)]
/// Parse a single line from `git diff --numstat` output.
/// Format: "additions\tdeletions\tpath" or "-\t-\tpath" for binary files.
use super::quoting::unquote_git_path;

pub(crate) fn parse_numstat_line(line: &str) -> Option<(usize, usize, String)> {
    let parts: Vec<&str> = line.splitn(3, '\t').collect();
    if parts.len() < 3 {
        return None;
    }
    let additions = if parts[0] == "-" {
        0
    } else {
        parts[0].parse().unwrap_or(0)
    };
    let deletions = if parts[1] == "-" {
        0
    } else {
        parts[1].parse().unwrap_or(0)
    };
    // git 文本输出的非 ASCII 路径带 C 转义引号（见 parsers::quoting）——
    // 必须在解析入口解码，否则按路径建索引（stats 合并到 FileChange）永远不命中
    Some((additions, deletions, unquote_git_path(parts[2])))
}

#[cfg(test)]
mod quoted_path_tests {
    use super::*;

    #[test]
    fn quoted_non_ascii_path_is_decoded() {
        let (additions, deletions, path) =
            parse_numstat_line("3\t1\t\"test/\\346\\265\\213\\350\\257\\225.txt\"")
                .expect("quoted numstat line must parse");
        assert_eq!(
            (additions, deletions, path.as_str()),
            (3, 1, "test/测试.txt")
        );
    }

    #[test]
    fn plain_path_is_left_untouched() {
        let (additions, deletions, path) =
            parse_numstat_line("2\t0\tsrc/main.rs").expect("plain line");
        assert_eq!((additions, deletions, path.as_str()), (2, 0, "src/main.rs"));
    }
}
