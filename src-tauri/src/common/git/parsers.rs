//! Parsers for git command output (diff, log, numstat, file tree, etc.).

use std::path::PathBuf;

use crate::common::git::refs::parse_decorate_refs;
use crate::common::git::types::{DiffHunk, DiffLine, DiffResult};
use crate::project::types::{
    CommitEntry, CommitFileChange, FileChange, FileNode, FileStatus, GitInfo, GitProvider,
    StashEntry, Worktree,
};

// ─── Diff parsers (originally from local.rs) ─────────────────────────────────

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

// ─── Git info parser (originally from remote.rs) ─────────────────────────────

/// Parse the combined output of git commands (branch / branches / worktrees / status) into GitInfo
#[must_use]
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
                if let Some(stripped) = trimmed.strip_prefix("worktree ") {
                    if let Some(path) = wt_path.take() {
                        worktrees.push(Worktree {
                            path,
                            branch: wt_branch.clone(),
                            head: wt_head.clone(),
                        });
                    }
                    wt_path = Some(PathBuf::from(stripped));
                    wt_head.clear();
                    wt_branch.clear();
                } else if let Some(stripped) = trimmed.strip_prefix("HEAD ") {
                    wt_head = stripped.to_string();
                } else if let Some(stripped) = trimmed.strip_prefix("branch refs/heads/") {
                    wt_branch = stripped.to_string();
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
        git_provider: GitProvider::Unknown,
    }
}

/// Parse a single line from `git status --porcelain` into a FileChange.
///
/// porcelain v1 的唯一解析入口（status_worker / operations / remote 共用，
/// AGENTS.md DRY：三处曾各有一套语义不一致的实现）。
///
/// 语义（X=index 状态，Y=worktree 状态）：
/// - `??` → Untracked
/// - rename（`R`）：`old -> new` 取 new 作为路径
/// - unmerged（任一 `U`，或 `AA`/`DD`）与 typechange（`T`）：归入 Modified ——
///   关键约束是**冲突文件必须出现在变更列表**（曾因 `_ => continue` 在
///   WSL/SSH 链路把 `UU` 丢弃）；FileStatus 暂无 Conflict 变体
/// - `A` → Added（Y 位 `M`/`?` 不改变 index 语义）、任一 `D` → Deleted、
///   其余 → Modified
pub(crate) fn parse_status_line(line: &str) -> Option<FileChange> {
    // porcelain 行形如 `XY<space>path`：前 3 字节恒为 ASCII，可安全切片
    let bytes = line.as_bytes();
    if bytes.len() < 4 || bytes[2] != b' ' {
        return None;
    }
    let xy = &line[..2];
    let raw_path = &line[3..];
    if raw_path.trim().is_empty() {
        return None;
    }

    let file_path = match raw_path.find(" -> ") {
        Some(idx) => &raw_path[idx + 4..],
        None => raw_path,
    };

    let x = xy.as_bytes()[0];
    let y = xy.as_bytes()[1];
    let file_status = if x == b'?' && y == b'?' {
        FileStatus::Untracked
    } else if x == b'A' && y != b'A' {
        // AA 属于 unmerged，落入下方 Modified 分支
        FileStatus::Added
    } else if x == b'D' || y == b'D' {
        // DD 属于 unmerged，但作为 Deleted 呈现同样成立（双方都删）
        FileStatus::Deleted
    } else if x == b'R' {
        FileStatus::Renamed
    } else {
        // 含 unmerged（U*、AA）、typechange（T）、其余未知码
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

#[cfg(test)]
mod porcelain_status_tests {
    use super::*;
    use crate::common::types::FileStatus;

    #[test]
    fn unmerged_uu_line_must_not_be_dropped() {
        // 回归（operations.rs `_ => continue` 曾丢弃冲突文件，WSL/SSH 上 UI 消失）：
        // 冲突行必须出现；FileStatus 暂无 Conflict 变体，统一映射为 Modified。
        let fc = parse_status_line("UU conflicted.txt").expect("UU line must parse");
        assert_eq!(fc.path, std::path::PathBuf::from("conflicted.txt"));
        assert!(matches!(fc.status, FileStatus::Modified));
    }

    #[test]
    fn both_added_and_both_deleted_are_conflicts_not_silent_drops() {
        assert!(parse_status_line("AA both-added.txt").is_some());
        assert!(parse_status_line("DD both-deleted.txt").is_some());
        assert!(parse_status_line("AU added-by-us.txt").is_some());
        assert!(parse_status_line("UA added-by-them.txt").is_some());
        assert!(parse_status_line("UD deleted-by-them.txt").is_some());
        assert!(parse_status_line("DU deleted-by-us.txt").is_some());
    }

    #[test]
    fn typechange_maps_to_modified() {
        let fc = parse_status_line("T  symlink.txt").expect("T line must parse");
        assert!(matches!(fc.status, FileStatus::Modified));
        let fc = parse_status_line(" T symlink.txt").expect(" T line must parse");
        assert!(matches!(fc.status, FileStatus::Modified));
    }

    #[test]
    fn rename_arrow_takes_new_path() {
        let fc = parse_status_line("R  old.txt -> new.txt").expect("rename line must parse");
        assert_eq!(fc.path, std::path::PathBuf::from("new.txt"));
        assert!(matches!(fc.status, FileStatus::Renamed));
    }

    #[test]
    fn staged_rename_arrow_takes_new_path() {
        let fc = parse_status_line("RM old.txt -> new.txt").expect("rename line must parse");
        assert_eq!(fc.path, std::path::PathBuf::from("new.txt"));
        assert!(matches!(fc.status, FileStatus::Renamed));
    }

    #[test]
    fn staged_added_worktree_modified_is_added() {
        let fc = parse_status_line("AM partial.txt").expect("AM line must parse");
        assert!(matches!(fc.status, FileStatus::Added));
    }

    #[test]
    fn staged_deleted_is_deleted() {
        let fc = parse_status_line("D  gone.txt").expect("D line must parse");
        assert!(matches!(fc.status, FileStatus::Deleted));
        let fc = parse_status_line(" D gone.txt").expect(" D line must parse");
        assert!(matches!(fc.status, FileStatus::Deleted));
    }

    #[test]
    fn modified_variants() {
        for line in ["M  a.txt", " M a.txt", "MM a.txt"] {
            let fc = parse_status_line(line).expect(line);
            assert!(matches!(fc.status, FileStatus::Modified), "{line}");
            assert_eq!(fc.path, std::path::PathBuf::from("a.txt"));
        }
    }

    #[test]
    fn untracked_only_double_question_mark() {
        let fc = parse_status_line("?? new dir/file.txt").expect("?? line must parse");
        assert!(matches!(fc.status, FileStatus::Untracked));
        assert_eq!(fc.path, std::path::PathBuf::from("new dir/file.txt"));
    }

    #[test]
    fn junk_lines_are_rejected() {
        assert!(parse_status_line("").is_none());
        assert!(parse_status_line("   ").is_none());
        assert!(parse_status_line("ab").is_none(), "no path part");
        assert!(parse_status_line("XY").is_none(), "no path part");
        assert!(
            parse_status_line("M a.txt").is_none(),
            "single-letter code is not porcelain XY"
        );
    }

    #[test]
    fn full_output_parse() {
        let out = "?? a.txt\n M b.txt\nUU c.txt\nR  d.txt -> e.txt\n";
        let files: Vec<FileChange> = out.lines().filter_map(parse_status_line).collect();
        assert_eq!(files.len(), 4, "every valid line must survive");
    }
}
