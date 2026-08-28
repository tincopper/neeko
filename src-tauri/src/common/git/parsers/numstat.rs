#![allow(unused_imports, missing_docs)]
/// Parse a single line from `git diff --numstat` output.
/// Format: "additions\tdeletions\tpath" or "-\t-\tpath" for binary files.
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
    Some((additions, deletions, parts[2].to_string()))
}
