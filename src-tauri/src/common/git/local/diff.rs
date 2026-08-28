#![allow(unused_imports, missing_docs)]
use super::run_cmd_local;
use crate::common::git::parsers::parse_numstat_line;
use crate::common::git::types::{DiffHunk, DiffLine, DiffResult};
use crate::project::types::{FileDiffStats, Worktree};
use anyhow::{Context, Result};
use git2::Repository;
use std::path::{Path, PathBuf};

/// 获取变更文件的 diff 统计（仅 additions / deletions，不含 diff 内容）。
/// 与 get_changed_files 分离，由前端异步懒加载。
/// 使用 git diff --numstat 子进程替代 git2 逐行遍历，性能大幅提升。
pub fn get_changed_files_diff_stats(repo_path: &Path) -> Result<Vec<FileDiffStats>> {
    // 使用缓存
    crate::common::git::cache::get_cached_diff_stats(repo_path, || {
        // 1. 使用 git diff --numstat 获取已跟踪文件的 diff 统计
        let unstaged_output = run_cmd_local(Some(repo_path), "git", &["diff", "--numstat"])
            .context("Failed to run git diff --numstat")?;

        let staged_output =
            run_cmd_local(Some(repo_path), "git", &["diff", "--cached", "--numstat"])
                .context("Failed to run git diff --cached --numstat")?;

        let mut stats: Vec<FileDiffStats> = Vec::new();
        let mut tracked_paths: std::collections::HashSet<String> = std::collections::HashSet::new();

        // 解析未暂存的 diff
        let unstaged = String::from_utf8_lossy(&unstaged_output.stdout);
        for line in unstaged.lines() {
            if let Some((additions, deletions, path)) = parse_numstat_line(line) {
                tracked_paths.insert(path.clone());
                stats.push(FileDiffStats {
                    path: PathBuf::from(&path),
                    additions,
                    deletions,
                });
            }
        }

        // 解析已暂存的 diff（合并到同一结果）
        let staged = String::from_utf8_lossy(&staged_output.stdout);
        for line in staged.lines() {
            if let Some((additions, deletions, path)) = parse_numstat_line(line) {
                if let Some(existing) = stats.iter_mut().find(|s| s.path.to_string_lossy() == path)
                {
                    // 文件同时有未暂存和已暂存变更，累加
                    existing.additions += additions;
                    existing.deletions += deletions;
                } else {
                    tracked_paths.insert(path.clone());
                    stats.push(FileDiffStats {
                        path: PathBuf::from(&path),
                        additions,
                        deletions,
                    });
                }
            }
        }

        // 2. 处理未跟踪文件（使用 git ls-files --others 获取列表，wc -l 计数）
        let untracked_output = run_cmd_local(
            Some(repo_path),
            "git",
            &["ls-files", "--others", "--exclude-standard"],
        )
        .context("Failed to run git ls-files --others")?;

        let untracked_files = String::from_utf8_lossy(&untracked_output.stdout);
        for file_path in untracked_files.lines() {
            let file_path = file_path.trim();
            if file_path.is_empty() || tracked_paths.contains(file_path) {
                continue;
            }

            let full_path = repo_path.join(file_path);
            if !full_path.exists() || !full_path.is_file() {
                continue;
            }

            // 使用 wc -l 计算行数（比 read_to_string 更高效）
            let line_count = count_lines_with_wc(&full_path);
            stats.push(FileDiffStats {
                path: PathBuf::from(file_path),
                additions: line_count,
                deletions: 0,
            });
        }

        Ok(stats)
    })
}

/// 使用 wc -l 计算文件行数
fn count_lines_with_wc(path: &Path) -> usize {
    let output = run_cmd_local(None, "wc", &["-l", path.to_str().unwrap_or("")]);

    match output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // wc -l 输出格式: "  123 path"
            stdout
                .split_whitespace()
                .next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0)
        }
        Err(_) => {
            // fallback: 使用 std::fs::read_to_string
            std::fs::read_to_string(path)
                .map(|c| c.lines().count())
                .unwrap_or(0)
        }
    }
}

/// Get the diff for a single file (working tree vs HEAD).
pub fn get_file_diff(repo_path: &Path, file_path: &str, collapse: bool) -> Result<DiffResult> {
    crate::common::git::cache::get_cached_worktree_diff(repo_path, file_path, collapse, || {
        let t_open = std::time::Instant::now();
        let repo = Repository::open(repo_path).context("Failed to open git repository")?;
        log::debug!(
            "[perf:detail] Repository::open: {}ms",
            t_open.elapsed().as_millis()
        );

        let mut opts = git2::DiffOptions::new();
        let (context_lines, truncated) = if collapse {
            (3, false)
        } else {
            // 全量护栏：超过单文件字节上限时回退受限上下文，防止 IPC JSON 超 2MB
            let file_bytes = std::fs::metadata(repo_path.join(file_path))
                .map(|m| m.len())
                .unwrap_or(0);
            let lines = crate::common::git::parsers::full_diff_context_lines(file_bytes);
            (
                lines,
                lines < crate::common::git::parsers::DIFF_FULL_CONTEXT_LINES,
            )
        };
        opts.pathspec(file_path)
            .context_lines(context_lines)
            .ignore_whitespace_eol(false);

        let old_tree = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .and_then(|c| c.tree().ok());

        let t_diff = std::time::Instant::now();
        let diff = match &old_tree {
            Some(tree) => repo
                .diff_tree_to_workdir_with_index(Some(tree), Some(&mut opts))
                .context("Failed to compute diff")?,
            None => repo
                .diff_index_to_workdir(None, Some(&mut opts))
                .context("Failed to compute diff")?,
        };
        log::debug!("[perf:detail] diff_T2W: {}ms", t_diff.elapsed().as_millis());

        // 先收集所有 patch 数据，避免多个闭包同时借用
        use std::cell::RefCell;
        let hunks: RefCell<Vec<DiffHunk>> = RefCell::new(Vec::new());

        let t_foreach = std::time::Instant::now();
        diff.foreach(
            &mut |_, _| true,
            None,
            Some(&mut |_delta, hunk| {
                hunks.borrow_mut().push(DiffHunk {
                    old_start: hunk.old_start(),
                    old_lines: hunk.old_lines(),
                    new_start: hunk.new_start(),
                    new_lines: hunk.new_lines(),
                    lines: Vec::new(),
                });
                true
            }),
            Some(&mut |_delta, _hunk_opt, line| {
                let content = std::str::from_utf8(line.content())
                    .unwrap_or("")
                    .trim_end_matches('\n')
                    .trim_end_matches('\r')
                    .to_string();

                let diff_line = match line.origin() {
                    '+' => DiffLine::Added(content),
                    '-' => DiffLine::Removed(content),
                    ' ' => DiffLine::Context(content),
                    _ => return true,
                };

                if let Some(last) = hunks.borrow_mut().last_mut() {
                    last.lines.push(diff_line);
                }
                true
            }),
        )
        .context("Failed to iterate diff")?;
        log::debug!(
            "[perf:detail] diff_foreach: {}ms",
            t_foreach.elapsed().as_millis()
        );

        let mut result_hunks = hunks.into_inner();

        // If hunks is empty, try to read file content (may be a new file)
        if result_hunks.is_empty() {
            let full_path = repo_path.join(file_path);
            if full_path.exists() && full_path.is_file() {
                if let Ok(content) = std::fs::read_to_string(&full_path) {
                    let lines: Vec<DiffLine> = content
                        .lines()
                        .map(|line| DiffLine::Added(line.to_string()))
                        .collect();

                    if !lines.is_empty() {
                        #[allow(clippy::cast_possible_truncation)]
                        result_hunks.push(DiffHunk {
                            old_start: 0,
                            old_lines: 0,
                            new_start: 1,
                            new_lines: lines.len() as u32,
                            lines,
                        });
                    }
                }
            }
        }

        Ok(DiffResult {
            hunks: result_hunks,
            truncated,
        })
    })
}

/// Check whether the given path is a valid git repository.
///
/// 轻量判定：`.git` 条目存在即视为 git 仓库（目录 = 普通仓库 / linked worktree，
/// 文件 = worktree / submodule 的 gitdir 指针）。与 `transport.rs` 的
/// `ExecTarget::is_git_repo` 保持同一语义，避免多端判定漂移。
/// 注意：bare repo（无 `.git` 条目）判定为 false —— Neeko 项目均为工作区仓库，
/// 不支持 bare repo 作为项目根。
#[must_use]
pub fn is_git_repo(path: &Path) -> bool {
    path.join(".git").exists()
}

/// Guard: bail with an explicit error if `path` is not a git repository.
///
/// All git read operations (`get_git_info`, `get_git_branch_info`, `get_ahead_behind`,
/// `get_worktree_changed_files`) must call this before spawning any git subprocess, so
/// that non-git projects (where `git_info` is `null`) produce a clean, early error
/// instead of executing `git rev-parse` etc. and surfacing a raw `fatal: not a git repository`.
///
/// 与 [`is_git_repo`] 共用同一轻量判定（`.git` 目录或文件存在），避免调用方
/// `transport.open_repo()` 内部 git2 open 与守卫判定不一致导致的误判
/// （bare repo / submodule / worktree），同时省去守卫自身的 git2 open 开销。
pub fn assert_git_repo(path: &Path) -> Result<()> {
    if is_git_repo(path) {
        Ok(())
    } else {
        anyhow::bail!("not a git repository: {}", path.display())
    }
}

/// 获取指定文件相对于 HEAD 的 diff（未 staged 也包含）。
/// 优先取 `git diff HEAD -- files`，新文件（untracked）回退到直接读文件内容。
/// 超过 `line_limit` 行时截断并附加 stat 摘要。
pub fn get_diff_for_files(
    repo_path: &Path,
    file_paths: &[String],
    line_limit: usize,
) -> Result<String> {
    if file_paths.is_empty() {
        return Ok(String::new());
    }

    // git diff HEAD -- file1 file2 ...（包含已 stage 和未 stage 的变更）
    let mut args = vec!["diff", "HEAD", "--"];
    args.extend(file_paths.iter().map(|s| s.as_str()));

    let diff_output =
        run_cmd_local(Some(repo_path), "git", &args).context("Failed to run git diff HEAD")?;

    let mut diff_text = String::from_utf8_lossy(&diff_output.stdout).to_string();

    // 对于新文件（untracked），git diff HEAD 返回空；读文件内容补充
    if diff_text.trim().is_empty() {
        let mut lines: Vec<String> = Vec::new();
        for fp in file_paths {
            let full = repo_path.join(fp);
            if full.exists() {
                if let Ok(content) = std::fs::read_to_string(&full) {
                    lines.push(format!("--- /dev/null\n+++ b/{}", fp));
                    for line in content.lines() {
                        lines.push(format!("+{}", line));
                    }
                }
            }
        }
        diff_text = lines.join("\n");
    }

    if diff_text.trim().is_empty() {
        return Ok(String::new());
    }

    // stat 摘要
    let mut stat_args = vec!["diff", "HEAD", "--stat", "--"];
    stat_args.extend(file_paths.iter().map(|s| s.as_str()));
    let stat_output = run_cmd_local(Some(repo_path), "git", &stat_args)
        .context("Failed to run git diff HEAD --stat")?;
    let stat_text = String::from_utf8_lossy(&stat_output.stdout)
        .trim()
        .to_string();

    let lines: Vec<&str> = diff_text.lines().collect();
    if lines.len() <= line_limit {
        Ok(diff_text)
    } else {
        let truncated = lines[..line_limit].join("\n");
        Ok(format!(
            "{}\n\n[diff truncated at {} lines]\n\nFile change summary:\n{}",
            truncated, line_limit, stat_text
        ))
    }
}

/// 获取最近 N 条 commit message（仅 subject 行）。
pub fn get_recent_commit_messages(repo_path: &Path, count: usize) -> Result<Vec<String>> {
    let count_str = format!("-{}", count);
    let output = run_cmd_local(
        Some(repo_path),
        "git",
        &["log", count_str.as_str(), "--format=%s"],
    )
    .context("Failed to run git log for recent messages")?;

    if output.exit_code != 0 {
        // 空仓库或无提交记录时不报错，返回空列表
        return Ok(vec![]);
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let messages: Vec<String> = text
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    Ok(messages)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collapse_false_returns_full_context_in_file_diff() {
        // 30 行文件，修改第 5 行与第 25 行：collapse=true 只保留少量上下文，
        // collapse=false 应返回完整文件上下文（git2 context_lines 放大）。
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path();

        let repo = Repository::init(repo_path).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();

        let content: String = (1..=30).map(|i| format!("line{i}\n")).collect();
        let file_path = repo_path.join("test.txt");
        std::fs::write(&file_path, &content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("test.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = git2::Signature::now("test", "test@test.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();

        let mut lines: Vec<String> = (1..=30).map(|i| format!("line{i}")).collect();
        lines[4] = "line5-modified".to_string();
        lines[24] = "line25-modified".to_string();
        std::fs::write(&file_path, format!("{}\n", lines.join("\n"))).unwrap();

        let collapsed = get_file_diff(repo_path, "test.txt", true).unwrap();
        let full = get_file_diff(repo_path, "test.txt", false).unwrap();

        let collapsed_lines: usize = collapsed.hunks.iter().map(|h| h.lines.len()).sum();
        let full_lines: usize = full.hunks.iter().map(|h| h.lines.len()).sum();
        assert!(
            collapsed_lines > 0,
            "collapse=true should still show changes"
        );
        assert!(
            full_lines > collapsed_lines,
            "collapse=false should return more context lines (full={full_lines} > collapsed={collapsed_lines})"
        );
        // 全量视图应包含被折叠掉的中间行（如 line10、line15）
        let full_text: Vec<String> = full
            .hunks
            .iter()
            .flat_map(|h| &h.lines)
            .filter_map(|l| match l {
                DiffLine::Context(c) | DiffLine::Added(c) | DiffLine::Removed(c) => Some(c.clone()),
                _ => None,
            })
            .collect();
        assert!(
            full_text.iter().any(|l| l == "line10"),
            "full diff should include middle lines"
        );
        assert!(
            !collapsed
                .hunks
                .iter()
                .flat_map(|h| &h.lines)
                .any(|l| matches!(l, DiffLine::Context(c) if c == "line10")),
            "collapsed diff should drop middle context lines"
        );
    }

    #[test]
    fn oversized_file_full_diff_is_truncated() {
        // 超过 DIFF_FULL_MAX_FILE_BYTES 的文件：collapse=false 时上下文被护栏限制，
        // truncated=true，避免 IPC JSON 超 2MB 红线。
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path();

        let repo = Repository::init(repo_path).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();

        // 构造 12k 行长文件（远超 400KB 阈值）
        let content: String = (0..12_000)
            .map(|i| format!("line{i:05} padding-padding-padding\n"))
            .collect();
        assert!(content.len() as u64 > crate::common::git::parsers::DIFF_FULL_MAX_FILE_BYTES);
        let file_path = repo_path.join("big.txt");
        std::fs::write(&file_path, &content).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("big.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = git2::Signature::now("test", "test@test.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();

        // 修改首尾两行
        let mut lines: Vec<String> = content.lines().map(String::from).collect();
        lines[0] = "line00000 modified".to_string();
        lines[11999] = "line11999 modified".to_string();
        std::fs::write(&file_path, format!("{}\n", lines.join("\n"))).unwrap();

        let result = get_file_diff(repo_path, "big.txt", false).unwrap();
        assert!(result.truncated, "oversized full diff should be truncated");
        // 护栏回退上下文（500 行）应远小于全量 12k 行
        let full_lines: usize = result.hunks.iter().map(|h| h.lines.len()).sum();
        assert!(
            full_lines < 12_000,
            "truncated context should be bounded (got {full_lines})"
        );
        // 小文件仍返回全量、不截断
        std::fs::write(repo_path.join("small.txt"), "a\nb\nc\n").unwrap();
        let small = get_file_diff(repo_path, "small.txt", false).unwrap();
        assert!(!small.truncated);
    }
}
