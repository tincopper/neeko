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

/// 拆 porcelain 路径：是 rename（`old -> new`）就返回两侧原始 token，否则 `None`。
///
/// 引号形态（含非 ASCII / 特殊字符，见 `parsers::quoting`）两侧各自成 token，且
/// **引号内的名字本身可能含 ` -> `**，故按 token 扫描而非整行 `find`；
/// 非引号形态沿用 git porcelain v1 的分隔约定（第一个 ` -> `）。
fn split_porcelain_paths(raw: &str) -> Option<(&str, &str)> {
    if raw.starts_with('"') {
        let (first, rest) = take_quoted_token(raw)?;
        let second = rest.strip_prefix(" -> ")?;
        return Some((first, second));
    }
    let idx = raw.find(" -> ")?;
    Some((&raw[..idx], &raw[idx + 4..]))
}

/// 取引号包裹的路径 token 及其后的剩余部分（`\"` 不算收尾引号）。
fn take_quoted_token(raw: &str) -> Option<(&str, &str)> {
    let bytes = raw.as_bytes();
    if bytes.first() != Some(&b'"') {
        return None;
    }
    let mut i = 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'"' => return Some((raw.get(..=i)?, raw.get(i + 1..)?)),
            _ => i += 1,
        }
    }
    None
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
use super::quoting::unquote_git_path;

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

    // G6 契约：rename 行 `old -> new` —— old 落 renamed_from（UI 显示 old → new）。
    // P2 显式降级（业界同款，VSCode 同）：rename 识别完全交给 git 的相似度启发式；
    // similarity 不足时 git 自身输出 `D` + `?` 两条目，Neeko 不做补偿推断，
    // watcher 的 Rename 事件仅作为 status 重算触发信号。
    // 两侧路径都可能被 C 转义引号包裹，且**引号内的名字本身可能含 ` -> `**
    // （`R  "a -> b.txt" -> "c.txt"`）—— 故按 token 扫描而非整行 find(" -> ")；
    // 解码统一在解析入口做（parsers::quoting）。
    let (renamed_from, file_path) = match split_porcelain_paths(raw_path) {
        Some((old_path, new_path)) => {
            (Some(unquote_git_path(old_path)), unquote_git_path(new_path))
        }
        None => (None, unquote_git_path(raw_path)),
    };

    // G1 契约统一：porcelain `?? dir/` 折叠目录条目尾带斜杠 —— 剥离尾斜杠并把
    // 目录性落到显式 is_dir 字段（前端不再用尾斜杠判定目录，P0）。
    let is_dir = file_path.ends_with('/');
    let clean_path = file_path.trim_end_matches('/');
    if clean_path.is_empty() {
        return None;
    }

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
        path: PathBuf::from(clean_path),
        status: file_status,
        additions: 0,
        deletions: 0,
        is_dir,
        // G6 契约：porcelain 原始 XY 字符（'?' 与空格均保留原语义）
        index_status: Some(x as char),
        worktree_status: Some(y as char),
        renamed_from,
    })
}

#[cfg(test)]
mod porcelain_status_tests {
    use super::*;
    use crate::common::types::FileStatus;
    use crate::project::types::FileChange;

    // ── G6 XY 契约：porcelain X/Y 字符与 renamed_from 提取 ──────────────────

    #[test]
    fn xy_chars_are_extracted_from_porcelain_columns() {
        let cases = [
            ("M  staged-only.txt", 'M', ' '),
            (" M wt-only.txt", ' ', 'M'),
            ("MM both.txt", 'M', 'M'),
            ("?? untracked.txt", '?', '?'),
            ("A  added.txt", 'A', ' '),
            ("D  index-deleted.txt", 'D', ' '),
            ("UU conflicted.txt", 'U', 'U'),
            ("T  typechange.txt", 'T', ' '),
        ];
        for (line, x, y) in cases {
            let fc = parse_status_line(line).unwrap_or_else(|| panic!("{line} must parse"));
            assert_eq!(fc.index_status, Some(x), "{line}: X");
            assert_eq!(fc.worktree_status, Some(y), "{line}: Y");
        }
    }

    #[test]
    fn untracked_dir_entry_carries_xy() {
        let fc = parse_status_line("?? new_dir/").expect("dir line must parse");
        assert_eq!(fc.index_status, Some('?'));
        assert_eq!(fc.worktree_status, Some('?'));
        assert!(fc.is_dir);
    }

    #[test]
    fn rename_line_extracts_old_path_as_renamed_from() {
        let fc = parse_status_line("R  old.txt -> new.txt").expect("rename must parse");
        assert_eq!(fc.index_status, Some('R'));
        assert_eq!(fc.renamed_from.as_deref(), Some("old.txt"));
        assert_eq!(fc.path, std::path::PathBuf::from("new.txt"));

        let wt = parse_status_line(" R old.rs -> new.rs").expect("wt rename must parse");
        assert_eq!(wt.worktree_status, Some('R'));
        assert_eq!(wt.renamed_from.as_deref(), Some("old.rs"));
    }

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
    fn untracked_collapsed_dir_normalizes_to_is_dir() {
        // G1 契约回归（P0）：`?? dir/` 折叠目录必须 → path 无尾斜杠 + is_dir=true，
        // 与 libgit2 兜底路径（无尾斜杠目录条目）语义一致；前端不再靠斜杠判定。
        let fc = parse_status_line("?? generated/").expect("collapsed dir must parse");
        assert!(matches!(fc.status, FileStatus::Untracked));
        assert_eq!(fc.path, std::path::PathBuf::from("generated"));
        assert!(fc.is_dir, "collapsed untracked dir must carry is_dir=true");

        let file = parse_status_line("?? plain.txt").expect("plain file must parse");
        assert!(!file.is_dir, "plain file must carry is_dir=false");
        assert_eq!(file.path, std::path::PathBuf::from("plain.txt"));
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

/// git 文本输出对非 ASCII / 特殊字符路径做 C 风格转义并整体加双引号
/// （`core.quotePath` 默认 true）：`"test/\346\265\213\350\257\225.txt"`。
/// 解析入口必须解码成真实路径 —— 否则下游把它当路径用会全线错位：
/// UI 显示乱码、按路径建索引不命中、staging/diff 命令找不到文件。
#[cfg(test)]
mod quoted_path_tests {
    use super::*;
    use crate::project::types::FileChange;

    #[test]
    fn quoted_non_ascii_file_path_is_decoded() {
        let fc: FileChange = parse_status_line("?? \"test/\\346\\265\\213\\350\\257\\225.txt\"")
            .expect("quoted untracked line must parse");
        assert_eq!(fc.path, std::path::PathBuf::from("test/测试.txt"));
        assert!(!fc.is_dir);
        assert_eq!(fc.index_status, Some('?'));
        assert_eq!(fc.worktree_status, Some('?'));
    }

    #[test]
    fn quoted_collapsed_dir_still_carries_is_dir() {
        // 引号包住整个路径（含尾斜杠）—— 必须先解码再判目录性
        let fc = parse_status_line("?? \"\\346\\265\\213\\350\\257\\225/\"").expect("dir line");
        assert!(fc.is_dir, "解码后仍须识别折叠目录");
        assert_eq!(fc.path, std::path::PathBuf::from("测试"));
    }

    #[test]
    fn quoted_rename_with_arrow_inside_name_splits_correctly() {
        // 旧名自身含 ` -> ` 且两侧带引号：不能对整行做 find(" -> ")
        let fc =
            parse_status_line("R  \"a -> b.txt\" -> \"\\346\\265\\213.txt\"").expect("rename line");
        assert_eq!(fc.renamed_from.as_deref(), Some("a -> b.txt"));
        assert_eq!(fc.path, std::path::PathBuf::from("测.txt"));
        assert!(matches!(fc.status, FileStatus::Renamed));
    }

    #[test]
    fn plain_paths_are_left_untouched() {
        let fc = parse_status_line(" M src/main.rs").expect("plain line");
        assert_eq!(fc.path, std::path::PathBuf::from("src/main.rs"));
        assert_eq!(fc.renamed_from, None);
    }
}
