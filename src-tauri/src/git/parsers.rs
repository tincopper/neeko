use anyhow::Result;
use std::path::PathBuf;

use crate::git::types::{DiffHunk, DiffLine, DiffResult};
use crate::project::types::{CommitEntry, FileChange, FileNode, FileStatus, GitInfo, Worktree};

// ─── Diff parsers (originally from local.rs) ─────────────────────────────────

/// Parse git diff --unified=3 text output into DiffResult
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
            } else if line.starts_with(' ') {
                last.lines.push(DiffLine::Context(line[1..].to_string()));
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

    let (new_part, _rest) = if let Some(pos) = rest.find(" @@") {
        (&rest[..pos], &rest[pos..])
    } else {
        return None;
    };

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
        collapsed_lines.extend(buffer.drain(..));
    } else {
        collapsed_lines.extend(buffer.drain(..));
    }
}

/// Collapse consecutive context lines, keeping <keep_edges> lines before/after
pub fn collapse_diff_context(hunks: &mut Vec<DiffHunk>, threshold: usize) {
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

// ─── Git info parser (originally from remote.rs) ─────────────────────────────

/// Parse the combined output of git commands (branch / branches / worktrees / status) into GitInfo
pub fn parse_git_info_output(output: &str) -> GitInfo {
    let mut current_branch = String::new();
    let mut branches = Vec::new();
    let mut worktrees = Vec::new();
    let mut changed_files = Vec::new();

    let mut section = "";
    let mut wt_path: Option<PathBuf> = None;
    let mut wt_head = String::new();
    let mut wt_branch = String::new();

    for line in output.lines() {
        match line.trim() {
            "__BRANCH__" => {
                section = "branch";
                continue;
            }
            "__BRANCHES__" => {
                section = "branches";
                continue;
            }
            "__WORKTREES__" => {
                section = "worktrees";
                continue;
            }
            "__STATUS__" => {
                section = "status";
                continue;
            }
            _ => {}
        }

        match section {
            "branch" => {
                if !line.trim().is_empty() {
                    current_branch = line.trim().to_string();
                }
            }
            "branches" => {
                let trimmed = line.trim();
                if trimmed.starts_with('*') {
                    let name = trimmed.trim_start_matches('*').trim();
                    branches.push(name.to_string());
                } else if !trimmed.is_empty() {
                    branches.push(trimmed.to_string());
                }
            }
            "worktrees" => {
                let trimmed = line.trim();
                if trimmed.starts_with("worktree ") {
                    if let Some(path) = wt_path.take() {
                        worktrees.push(Worktree {
                            path,
                            branch: wt_branch.clone(),
                            head: wt_head.clone(),
                        });
                    }
                    wt_path = Some(PathBuf::from(&trimmed[9..]));
                    wt_head.clear();
                    wt_branch.clear();
                } else if trimmed.starts_with("HEAD ") {
                    wt_head = trimmed[5..].to_string();
                } else if trimmed.starts_with("branch refs/heads/") {
                    wt_branch = trimmed[18..].to_string();
                } else if trimmed == "detached" {
                    wt_branch = "(detached HEAD)".to_string();
                } else if trimmed == "bare" {
                    wt_branch = "(bare)".to_string();
                } else if trimmed.is_empty() {
                    if let Some(path) = wt_path.take() {
                        worktrees.push(Worktree {
                            path,
                            branch: wt_branch.clone(),
                            head: wt_head.clone(),
                        });
                    }
                    wt_head.clear();
                    wt_branch.clear();
                }
            }
            "status" => {
                if let Some(fc) = parse_status_line(line) {
                    changed_files.push(fc);
                }
            }
            _ => {}
        }
    }

    if let Some(path) = wt_path.take() {
        worktrees.push(Worktree {
            path,
            branch: wt_branch,
            head: wt_head,
        });
    }

    if !worktrees.is_empty() {
        worktrees.remove(0);
    }

    let is_clean = changed_files.is_empty();

    GitInfo {
        current_branch,
        branches,
        worktrees,
        changed_files,
        is_clean,
    }
}

/// Parse a single line from `git status --porcelain` into a FileChange
pub(crate) fn parse_status_line(line: &str) -> Option<FileChange> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let status_chars = &trimmed[..2.min(trimmed.len())];
    let file_path = trimmed[2.min(trimmed.len())..].trim();

    if file_path.is_empty() {
        return None;
    }

    let file_status = if status_chars.contains('?') {
        FileStatus::Untracked
    } else if status_chars.contains('A') {
        FileStatus::Added
    } else if status_chars.contains('D') {
        FileStatus::Deleted
    } else if status_chars.contains('R') {
        FileStatus::Renamed
    } else {
        FileStatus::Modified
    };

    Some(FileChange {
        path: PathBuf::from(file_path),
        status: file_status,
        additions: 0,
        deletions: 0,
    })
}

// ─── Commit parsers (originally from remote.rs) ──────────────────────────────

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
                Some(CommitEntry {
                    hash: parts[0].to_string(),
                    short_hash: parts[1].to_string(),
                    author: parts[2].to_string(),
                    timestamp: parts[3].to_string(),
                    message: parts[4].to_string(),
                    refs: parts.get(5).map(|s| s.to_string()).unwrap_or_default(),
                    parents,
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
pub(crate) fn build_file_tree_from_find(
    find_output: &str,
    root_path: &str,
) -> Result<Vec<FileNode>> {
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

    Ok(top_level)
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

// ─── Numstat parser (shared by local.rs and operations.rs) ──────────────────

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
