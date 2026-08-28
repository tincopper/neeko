#![allow(unused_imports, missing_docs)]
use std::path::PathBuf;

use crate::common::git::refs::parse_decorate_refs;
use crate::project::types::{CommitEntry, CommitFileChange, FileNode, StashEntry};

/// Parse NUL-separated git log format output into CommitEntry list
pub(crate) fn parse_commit_log_output(output: &str) -> Vec<CommitEntry> {
    output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\0').collect();
            if parts.len() >= 6 {
                let parents = parts
                    .get(6)
                    .map(|s| {
                        s.split_whitespace()
                            .map(|p| p.to_string())
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let refs_list = parse_decorate_refs(parts.get(5).copied().unwrap_or(""));
                let refs = refs_list
                    .iter()
                    .map(|r| r.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                Some(CommitEntry {
                    hash: parts[0].to_string(),
                    short_hash: parts[1].to_string(),
                    author: parts[2].to_string(),
                    timestamp: parts[3].to_string(),
                    message: parts[4].to_string(),
                    refs,
                    refs_list,
                    parents,
                })
            } else {
                None
            }
        })
        .collect()
}

/// Parse NUL-separated `git stash list --format` output into StashEntry list.
///
/// 每条记录以 NUL 结尾（`...%aI%x00`），按 NUL 切分后每 4 个字段为一组，
/// 因此消息字段内的换行不会破坏记录边界。
#[must_use]
pub fn parse_stash_list(output: &str) -> Vec<StashEntry> {
    output
        .split('\0')
        .collect::<Vec<_>>()
        .chunks(4)
        .filter_map(|chunk| {
            if chunk.len() < 4 {
                return None;
            }
            let message = chunk[1].to_string();
            let branch = parse_stash_branch(&message);
            Some(StashEntry {
                selector: chunk[0].trim_start_matches('\n').to_string(),
                hash: chunk[2].to_string(),
                message,
                branch,
                timestamp: chunk[3].to_string(),
            })
        })
        .collect()
}

/// Extract the source branch from a stash message (`WIP on <b>:` / `On <b>:`).
#[must_use]
pub fn parse_stash_branch(message: &str) -> String {
    for prefix in ["WIP on ", "On "] {
        if let Some(rest) = message.strip_prefix(prefix) {
            if let Some(end) = rest.find(':') {
                return rest[..end].to_string();
            }
        }
    }
    String::new()
}

/// Merge `--numstat` output with `--name-status` output into CommitFileChange list.
#[must_use]
pub fn parse_numstat_with_status(numstat: &str, status_output: &str) -> Vec<CommitFileChange> {
    let status_map: std::collections::HashMap<String, String> = status_output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 2 {
                Some((parts[1].to_string(), parts[0].to_string()))
            } else {
                None
            }
        })
        .collect();

    numstat
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 3 {
                let path = parts[2].to_string();
                let additions = parts[0].parse::<usize>().unwrap_or(0);
                let deletions = parts[1].parse::<usize>().unwrap_or(0);
                let status = status_map
                    .get(&path)
                    .cloned()
                    .unwrap_or_else(|| "M".to_string());
                Some(CommitFileChange {
                    path,
                    status,
                    additions,
                    deletions,
                })
            } else {
                None
            }
        })
        .collect()
}

/// Extract commit hash from git commit output (format "[branch abc1234] ...")
pub(crate) fn extract_commit_hash_from_output(output: &str) -> Option<String> {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            if let Some(idx) = trimmed.find("] ") {
                let bracket_content = &trimmed[1..idx];
                if let Some(last_space) = bracket_content.rfind(' ') {
                    return Some(bracket_content[last_space + 1..].to_string());
                }
                return Some(bracket_content.to_string());
            }
        }
    }
    None
}

// ─── File tree builder (originally from remote.rs) ───────────────────────────

/// Build file tree from find command output (used by both SSH and WSL)
pub(crate) fn build_file_tree_from_find(find_output: &str, root_path: &str) -> Vec<FileNode> {
    use std::collections::HashMap;

    let mut path_set: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut all_paths: Vec<String> = Vec::new();

    for line in find_output.lines() {
        let p = line.trim();
        if p.is_empty() || p == root_path {
            continue;
        }
        path_set.insert(p.to_string());
        all_paths.push(p.to_string());
    }

    let mut is_dir_map: HashMap<String, bool> = HashMap::new();
    for p in &all_paths {
        is_dir_map.entry(p.clone()).or_insert(false);
        if let Some(parent) = std::path::Path::new(p).parent() {
            let parent_str = parent.to_string_lossy().to_string();
            if parent_str != root_path && path_set.contains(&parent_str) {
                is_dir_map.insert(parent_str, true);
            }
        }
    }

    let mut top_level: Vec<FileNode> = Vec::new();
    for p in &all_paths {
        let parent = std::path::Path::new(p)
            .parent()
            .map(|pp| pp.to_string_lossy().to_string())
            .unwrap_or_default();
        if parent == root_path {
            let name = std::path::Path::new(p)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| p.clone());
            let is_dir = *is_dir_map.get(p).unwrap_or(&false);
            let children = if is_dir {
                collect_file_tree_children(p, &all_paths, &is_dir_map, root_path)
            } else {
                vec![]
            };
            let rel_path = p
                .strip_prefix(&format!("{}/", root_path))
                .or_else(|| p.strip_prefix(root_path))
                .unwrap_or(p)
                .to_string();
            top_level.push(FileNode {
                name,
                path: rel_path,
                is_dir,
                children,
            });
        }
    }

    top_level.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            if a.is_dir {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    top_level
}

pub(crate) fn collect_file_tree_children(
    dir_path: &str,
    all_paths: &[String],
    is_dir_map: &std::collections::HashMap<String, bool>,
    root_path: &str,
) -> Vec<FileNode> {
    let mut children: Vec<FileNode> = Vec::new();
    for p in all_paths {
        let parent = std::path::Path::new(p)
            .parent()
            .map(|pp| pp.to_string_lossy().to_string())
            .unwrap_or_default();
        if parent == dir_path {
            let name = std::path::Path::new(p)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| p.clone());
            let is_dir = *is_dir_map.get(p).unwrap_or(&false);
            let grandchildren = if is_dir {
                collect_file_tree_children(p, all_paths, is_dir_map, root_path)
            } else {
                vec![]
            };
            let rel_path = p
                .strip_prefix(&format!("{}/", root_path))
                .or_else(|| p.strip_prefix(root_path))
                .unwrap_or(p)
                .to_string();
            children.push(FileNode {
                name,
                path: rel_path,
                is_dir,
                children: grandchildren,
            });
        }
    }

    children.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            if a.is_dir {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    children
}

#[cfg(test)]
mod file_tree_tests {
    use super::*;

    fn names(nodes: &[FileNode]) -> Vec<&str> {
        nodes.iter().map(|n| n.name.as_str()).collect()
    }

    #[test]
    fn builds_nested_tree_with_relative_paths() {
        let out = "/proj\n/proj/src\n/proj/src/a.ts\n/proj/src/utils\n/proj/src/utils/b.ts\n/proj/README.md\n";
        let tree = build_file_tree_from_find(out, "/proj");

        // 目录优先、名称不区分大小写排序
        assert_eq!(names(&tree), ["src", "README.md"]);

        let src = &tree[0];
        assert!(src.is_dir);
        assert_eq!(src.path, "src");
        assert_eq!(names(&src.children), ["utils", "a.ts"]);

        let utils = &src.children[0];
        assert!(utils.is_dir);
        assert_eq!(utils.path, "src/utils");
        assert_eq!(names(&utils.children), ["b.ts"]);
        assert_eq!(utils.children[0].path, "src/utils/b.ts");
        assert!(!utils.children[0].is_dir);
    }

    #[test]
    fn partial_output_still_builds_tree() {
        // 模拟 find 非零退出（个别目录无权限）：stdout 仍包含已扫描路径，整树不应被丢弃
        let out = "/proj\n/proj/src\n/proj/src/ok.ts\n/proj/src/locked\n/proj/README.md\n";
        let tree = build_file_tree_from_find(out, "/proj");

        assert_eq!(names(&tree), ["src", "README.md"]);
        let src = &tree[0];
        // locked 在输出中出现但没有子路径：解析器无法判定其目录身份，按叶子文件处理
        assert_eq!(names(&src.children), ["locked", "ok.ts"]);
        assert!(!src.children[0].is_dir);
        assert!(src.children[0].children.is_empty());
    }

    #[test]
    fn skips_root_path_and_blank_lines() {
        let out = "\n/proj\n/proj/a.txt\n\n";
        let tree = build_file_tree_from_find(out, "/proj");
        assert_eq!(names(&tree), ["a.txt"]);
    }

    #[test]
    fn empty_output_yields_empty_tree() {
        assert!(build_file_tree_from_find("", "/proj").is_empty());
        assert!(build_file_tree_from_find("/proj\n", "/proj").is_empty());
    }

    #[test]
    fn sorts_dirs_first_then_names_case_insensitive() {
        // bravo 带子路径 → 判定为目录，排最前；文件按名称不区分大小写（alpha < Zeta）
        let out = "/proj\n/proj/Zeta.txt\n/proj/alpha.txt\n/proj/bravo\n/proj/bravo/x.txt\n";
        let tree = build_file_tree_from_find(out, "/proj");
        assert_eq!(names(&tree), ["bravo", "alpha.txt", "Zeta.txt"]);
    }
}

#[cfg(test)]
mod stash_parse_tests {
    use super::*;

    #[test]
    fn parse_stash_list_parses_nul_separated_rows() {
        let output = "stash@{0}\u{0}WIP on main: 9f3c1a2 feat: xyz\u{0}abc123\u{0}2026-08-01T10:00:00+08:00\u{0}\nstash@{1}\u{0}On feature: fix typo\u{0}def456\u{0}2026-07-30T09:00:00Z\u{0}\n";
        let stashes = parse_stash_list(output);
        assert_eq!(stashes.len(), 2);
        assert_eq!(stashes[0].selector, "stash@{0}");
        assert_eq!(stashes[0].message, "WIP on main: 9f3c1a2 feat: xyz");
        assert_eq!(stashes[0].branch, "main");
        assert_eq!(stashes[0].hash, "abc123");
        assert_eq!(stashes[0].timestamp, "2026-08-01T10:00:00+08:00");
        assert_eq!(stashes[1].selector, "stash@{1}");
        assert_eq!(stashes[1].branch, "feature");
        assert_eq!(stashes[1].hash, "def456");
    }

    #[test]
    fn parse_stash_list_handles_multiline_messages() {
        // 消息字段内含换行（不依赖 git 压平换行的内部行为）也不破坏记录边界。
        let output = "stash@{0}\u{0}On main: line1\nline2\nline3\u{0}abc123\u{0}2026-08-01T10:00:00+08:00\u{0}\nstash@{1}\u{0}On feature: fix typo\u{0}def456\u{0}2026-07-30T09:00:00Z\u{0}\n";
        let stashes = parse_stash_list(output);
        assert_eq!(stashes.len(), 2);
        assert_eq!(stashes[0].selector, "stash@{0}");
        assert_eq!(stashes[0].message, "On main: line1\nline2\nline3");
        assert_eq!(stashes[0].hash, "abc123");
        assert_eq!(stashes[1].selector, "stash@{1}");
        assert_eq!(stashes[1].message, "On feature: fix typo");
        assert_eq!(stashes[1].hash, "def456");
    }

    #[test]
    fn parse_stash_list_handles_empty_message_field() {
        // 空消息字段（`%gs` 为空）不会导致后续字段错位。
        let output = "stash@{0}\u{0}\u{0}abc123\u{0}2026-08-01T10:00:00+08:00\u{0}\n";
        let stashes = parse_stash_list(output);
        assert_eq!(stashes.len(), 1);
        assert_eq!(stashes[0].selector, "stash@{0}");
        assert_eq!(stashes[0].message, "");
        assert_eq!(stashes[0].hash, "abc123");
        assert_eq!(stashes[0].timestamp, "2026-08-01T10:00:00+08:00");
    }

    #[test]
    fn parse_stash_list_empty_output_yields_empty_list() {
        assert!(parse_stash_list("").is_empty());
    }

    #[test]
    fn parse_stash_branch_falls_back_to_empty_when_no_prefix() {
        assert_eq!(parse_stash_branch("WIP on main: x"), "main");
        assert_eq!(parse_stash_branch("On develop: x"), "develop");
        assert_eq!(parse_stash_branch("just a message"), "");
        assert_eq!(parse_stash_branch(""), "");
    }

    #[test]
    fn parse_numstat_with_status_merges_status_map() {
        let numstat = "3\t1\tREADME.md\n1\t0\tsrc/new.ts\n";
        let status = "M\tREADME.md\nA\tsrc/new.ts\n";
        let files = parse_numstat_with_status(numstat, status);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "README.md");
        assert_eq!(files[0].status, "M");
        assert_eq!(files[0].additions, 3);
        assert_eq!(files[0].deletions, 1);
        assert_eq!(files[1].path, "src/new.ts");
        assert_eq!(files[1].status, "A");
        assert_eq!(files[1].additions, 1);
    }

    #[test]
    fn parse_numstat_with_status_defaults_missing_status_to_modified() {
        let files = parse_numstat_with_status("1\t0\tonly_numstat.txt\n", "");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "only_numstat.txt");
        assert_eq!(files[0].status, "M");
    }
}
