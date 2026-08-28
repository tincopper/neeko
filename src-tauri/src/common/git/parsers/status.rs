#![allow(unused_imports, missing_docs)]
use std::path::PathBuf;

use crate::project::types::{FileChange, FileStatus, GitInfo, GitProvider, Worktree};

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

#[cfg(test)]
mod porcelain_status_tests {
    use super::*;
    use crate::common::types::FileStatus;
    use crate::project::types::FileChange;

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
