//! Local git operations (status, log, diff, branch, worktree, etc.).

use crate::common::executor::factory::ExecTarget;
use crate::common::executor::SpawnOptions;
use crate::common::executor::{ExecError, ExecOutput};
use crate::common::git::types::{DiffHunk, DiffLine, DiffResult};
use crate::core::exec::collect_blocking_with;
use crate::project::types::{
    FileChange, FileDiffStats, FileStatus, GitBranchInfo, GitInfo, GitProvider, Worktree,
};
use anyhow::{Context, Result};
use git2::{Repository, Status, StatusOptions};
use std::path::{Path, PathBuf};

use super::parsers::parse_numstat_line;

/// 统一命令执行：在本地同步运行 `program`（git / wc 等），返回原始输出（含非零退出码）。
///
/// 本模块是纯本地仓库操作，固定使用 `ExecTarget::Local`，经 `core::exec`
/// 统一接口执行（PATH 解析 / Windows `CREATE_NO_WINDOW` 语义由统一接口保证）。
/// `current_dir` 为 `None` 时通过 `git -C` 指定仓库目录。
fn run_cmd_local(
    current_dir: Option<&Path>,
    program: &str,
    args: &[&str],
) -> Result<ExecOutput, ExecError> {
    let mut opts = SpawnOptions::new(program, args);
    if let Some(dir) = current_dir {
        let dir_str = dir
            .to_str()
            .ok_or_else(|| ExecError::InvalidConfig("non-UTF8 path".to_string()))?;
        opts = opts.with_current_dir(dir_str);
    }
    collect_blocking_with(&ExecTarget::Local, opts)
}

/// Get full git information for the repository at `repo_path`.
pub fn get_git_info(repo_path: &Path) -> Result<GitInfo> {
    let repo = Repository::open(repo_path).context("Failed to open git repository")?;

    // 复用已打开的 Repository，避免重复 open
    let branch_info = get_git_branch_info_from_repo(&repo)?;
    let changed_files = get_changed_files_from_repo(&repo)?;
    let is_clean = changed_files.is_empty();

    // 检测 Git 提供商（复用已打开的 repo，零额外开销）
    let git_provider = repo
        .find_remote("origin")
        .ok()
        .and_then(|r| r.url().map(|u| u.to_string()))
        .map(|u| crate::common::git::provider::detect_provider(&u))
        .unwrap_or(GitProvider::Unknown);

    // 注入 ProviderStore 缓存，后续 PR 操作直接读缓存
    crate::common::git::pr::set_cached_provider(repo_path, git_provider);

    Ok(GitInfo {
        current_branch: branch_info.current_branch,
        branches: branch_info.branches,
        worktrees: branch_info.worktrees,
        changed_files,
        is_clean,
        git_provider,
    })
}

/// Get changed files from an already-open git2 Repository
pub fn get_changed_files_from_repo(repo: &Repository) -> Result<Vec<FileChange>> {
    // 封顶（S1-1，公理：一切随输入规模增长的结构必须有界）：变更列表超过上限时
    // 截断并告警。S0 已让 untracked 折叠为目录条目，此处防御的是「一次性修改大量
    // 已跟踪文件」的极端场景（如手工 merge），避免把数万条 FileChange 推过 IPC。
    const MAX_CHANGED_FILES: usize = 500;

    let mut opts = StatusOptions::new();
    // untracked 目录保持折叠语义（与 CLI `git status --porcelain` 一致）：
    // 不得开启 recurse_untracked_dirs —— 它会把未忽略目录展开到每一个文件，
    // 大仓库下（构建产物误入 untracked）会产生数十万条目直至内存爆炸。
    opts.include_untracked(true).include_ignored(false);

    let statuses = repo.statuses(Some(&mut opts))?;
    let mut files = Vec::new();
    let repo_workdir = repo.workdir().unwrap_or(std::path::Path::new(""));

    for entry in statuses.iter() {
        if let Some(path) = entry.path() {
            let status = entry.status();

            if status.contains(Status::IGNORED) {
                continue;
            }
            if status.is_empty() {
                continue;
            }
            if has_symlink_ancestor(repo_workdir, path) {
                continue;
            }

            let file_status = if status.contains(Status::INDEX_NEW) {
                FileStatus::Added
            } else if status.contains(Status::WT_NEW) {
                FileStatus::Untracked
            } else if status.contains(Status::WT_TYPECHANGE)
                || status.contains(Status::INDEX_TYPECHANGE)
            {
                FileStatus::Modified
            } else if status.contains(Status::WT_DELETED) || status.contains(Status::INDEX_DELETED)
            {
                FileStatus::Deleted
            } else if status.contains(Status::WT_RENAMED) || status.contains(Status::INDEX_RENAMED)
            {
                FileStatus::Renamed
            } else if status.contains(Status::WT_MODIFIED)
                || status.contains(Status::INDEX_MODIFIED)
            {
                FileStatus::Modified
            } else {
                continue;
            };

            files.push(FileChange {
                path: PathBuf::from(path),
                status: file_status,
                additions: 0,
                deletions: 0,
            });
        }
    }

    // Enrich with additions/deletions from git diff --numstat
    if !files.is_empty() {
        let repo_path = repo_workdir;
        let mut numstat: std::collections::HashMap<String, (usize, usize)> =
            std::collections::HashMap::new();

        if let Ok(output) = run_cmd_local(
            None,
            "git",
            &["-C", repo_path.to_str().unwrap_or("."), "diff", "--numstat"],
        ) {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                if let Some((add, del, path)) = parse_numstat_line(line) {
                    let entry = numstat.entry(path).or_insert((0, 0));
                    entry.0 += add;
                    entry.1 += del;
                }
            }
        }

        if let Ok(output) = run_cmd_local(
            None,
            "git",
            &[
                "-C",
                repo_path.to_str().unwrap_or("."),
                "diff",
                "--cached",
                "--numstat",
            ],
        ) {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                if let Some((add, del, path)) = parse_numstat_line(line) {
                    let entry = numstat.entry(path).or_insert((0, 0));
                    entry.0 += add;
                    entry.1 += del;
                }
            }
        }

        for file in &mut files {
            let path_str = file.path.to_string_lossy().to_string();
            if let Some((add, del)) = numstat.get(&path_str) {
                file.additions = *add;
                file.deletions = *del;
            }
        }
    }

    if files.len() > MAX_CHANGED_FILES {
        log::warn!(
            "changed_files exceeded cap: {} entries truncated to {}",
            files.len(),
            MAX_CHANGED_FILES
        );
        files.truncate(MAX_CHANGED_FILES);
    }

    Ok(files)
}

/// Windows: 检测 reparse point（symlink + junction）。
/// 非 Windows: 检测 symlink。
#[cfg(windows)]
fn is_reparse_point(path: &std::path::Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    path.symlink_metadata()
        .map(|m| m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn is_reparse_point(path: &std::path::Path) -> bool {
    path.symlink_metadata()
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

/// 检查路径自身或其任意祖先目录是否为 symlink / junction。
/// 用于过滤 libgit2 recurse_untracked_dirs 跟进目录 junction 产生的误报。
fn has_symlink_ancestor(repo_path: &std::path::Path, relative_path: &str) -> bool {
    let mut current = repo_path.to_path_buf();
    for component in std::path::Path::new(relative_path).components() {
        current.push(component);
        if is_reparse_point(&current) {
            return true;
        }
    }
    false
}

/// 获取变更文件的 diff 统计（仅 additions / deletions，不含 diff 内容）。
/// 与 get_changed_files 分离，由前端异步懒加载。
/// 使用 git diff --numstat 子进程替代 git2 逐行遍历，性能大幅提升。
pub fn get_changed_files_diff_stats(repo_path: &Path) -> Result<Vec<FileDiffStats>> {
    // 使用缓存
    super::cache::get_cached_diff_stats(repo_path, || {
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

fn get_worktrees(repo: &Repository) -> Vec<Worktree> {
    let mut worktrees = Vec::new();

    if let Ok(names) = repo.worktrees() {
        for name in names.iter().flatten() {
            if let Ok(wt) = repo.find_worktree(name) {
                let path = wt.path().to_path_buf();
                // Use git command to get branch and head info (avoids N+1 repo opens)
                let wt_path_str = path.to_str().unwrap_or(".");
                if let Ok(output) = run_cmd_local(
                    None,
                    "git",
                    &["-C", wt_path_str, "rev-parse", "--abbrev-ref", "HEAD"],
                ) {
                    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    let branch = if branch.is_empty() {
                        "HEAD".to_string()
                    } else {
                        branch
                    };

                    if let Ok(output) =
                        run_cmd_local(None, "git", &["-C", wt_path_str, "rev-parse", "HEAD"])
                    {
                        let head = String::from_utf8_lossy(&output.stdout).trim().to_string();
                        let head = if head.is_empty() {
                            "detached".to_string()
                        } else {
                            head
                        };

                        worktrees.push(Worktree { path, branch, head });
                    }
                }
            }
        }
    }

    worktrees
}
/// Get the diff for a single file (working tree vs HEAD).
pub fn get_file_diff(repo_path: &Path, file_path: &str, collapse: bool) -> Result<DiffResult> {
    super::cache::get_cached_worktree_diff(repo_path, file_path, collapse, || {
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
            let lines = super::parsers::full_diff_context_lines(file_bytes);
            (lines, lines < super::parsers::DIFF_FULL_CONTEXT_LINES)
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
/// 内部版本：接受已打开的 &Repository，避免重复 open
pub fn get_git_branch_info_from_repo(repo: &Repository) -> Result<GitBranchInfo> {
    // 获取当前分支
    let head = repo.head()?;
    let current_branch = if head.is_branch() {
        head.shorthand().unwrap_or("HEAD").to_string()
    } else {
        "HEAD (detached)".to_string()
    };

    // 本地分支
    let local_branches = repo.branches(Some(git2::BranchType::Local))?;
    let mut branch_names = Vec::new();
    for (branch, _) in local_branches.flatten() {
        if let Some(name) = branch.name()? {
            branch_names.push(name.to_string());
        }
    }

    // 远程跟踪分支（如 origin/feature/xxx），仅当本地同名分支不存在时加入
    if let Ok(remote_branches) = repo.branches(Some(git2::BranchType::Remote)) {
        for (branch, _) in remote_branches.flatten() {
            if let Some(name) = branch.name()? {
                let name = name.to_string();
                // 跳过 HEAD 远程引用 (origin/HEAD -> origin/main)
                if name.ends_with("/HEAD") {
                    continue;
                }
                // 提取远程名后的分支名，如 origin/feature/xxx -> feature/xxx
                let local_name = name.split('/').skip(1).collect::<Vec<_>>().join("/");
                if !local_name.is_empty() && branch_names.contains(&local_name) {
                    continue;
                }
                branch_names.push(name);
            }
        }
    }

    // 获取 worktrees
    let worktrees = get_worktrees(repo);

    Ok(GitBranchInfo {
        current_branch,
        branches: branch_names,
        worktrees,
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
    use crate::common::git::parsers::parse_unified_diff;

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
        // Should not include --- or +++ as diff lines
        assert_eq!(hunk.lines.len(), 2);
        assert!(matches!(hunk.lines[0], DiffLine::Context(_)));
        assert!(matches!(hunk.lines[1], DiffLine::Added(_)));
    }

    #[test]
    fn should_parse_hunk_without_line_counts() {
        let diff = "@@ -1 +1 @@
-old
+new";
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

    #[test]
    fn should_get_changed_files_for_worktree_path() {
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path();

        // Init git repo
        let repo = Repository::init(repo_path).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();

        // Create initial commit
        let file_path = repo_path.join("initial.txt");
        std::fs::write(&file_path, "initial content\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("initial.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = git2::Signature::now("test", "test@test.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();

        // Modify a file
        std::fs::write(&file_path, "modified content\n").unwrap();

        // Call get_changed_files_from_repo (should detect modification)
        let files = get_changed_files_from_repo(&repo).unwrap();
        assert!(!files.is_empty(), "Should detect changed file");
        assert_eq!(files[0].status, FileStatus::Modified);
    }

    /// 回归（内存暴涨根因）：untracked 目录必须保持折叠语义，
    /// 不得递归展开到每一个文件 —— recurse_untracked_dirs(true) 在
    /// 大仓库未忽略目录场景下曾产生数十万条目直至内存爆炸。
    #[test]
    fn should_collapse_untracked_dir_to_single_entry() {
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path();

        let repo = Repository::init(repo_path).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();

        // 初始提交保证工作区基线干净
        std::fs::write(repo_path.join("initial.txt"), "initial\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("initial.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = git2::Signature::now("test", "test@test.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();

        // 生成一个含多文件的 untracked 未忽略目录
        let bulk = repo_path.join("generated");
        std::fs::create_dir_all(&bulk).unwrap();
        for i in 0..50 {
            std::fs::write(bulk.join(format!("file_{i}.txt")), format!("content {i}\n")).unwrap();
        }
        std::fs::write(repo_path.join("top_untracked.txt"), "top\n").unwrap();

        let files = get_changed_files_from_repo(&repo).unwrap();

        assert_eq!(
            files.len(),
            2,
            "untracked 目录应折叠为 1 条目录条目 + 1 条顶层文件"
        );
        assert!(
            files
                .iter()
                .any(|f| f.path == std::path::PathBuf::from("generated")),
            "折叠条目应为目录路径本身（如 generated/），而不是其中的文件"
        );
        assert!(!files.iter().any(|f| {
            f.path.starts_with(std::path::Path::new("generated/"))
                && f.path != std::path::Path::new("generated")
        }));
    }

    #[test]
    fn should_return_empty_for_clean_worktree_path() {
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path();

        let repo = Repository::init(repo_path).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();

        // Create initial commit
        let file_path = repo_path.join("clean.txt");
        std::fs::write(&file_path, "clean content\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("clean.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = git2::Signature::now("test", "test@test.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();

        // No modifications
        let files = get_changed_files_from_repo(&repo).unwrap();
        assert!(files.is_empty(), "Clean repo should have no changes");
    }

    #[test]
    fn should_get_file_diff_for_worktree_path() {
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path();

        let repo = Repository::init(repo_path).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();

        // Create initial commit
        let file_path = repo_path.join("test.txt");
        std::fs::write(&file_path, "line1\nline2\nline3\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("test.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = git2::Signature::now("test", "test@test.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();

        // Modify file
        std::fs::write(&file_path, "line1\nmodified\nline3\n").unwrap();

        // Get diff
        let diff_result = get_file_diff(repo_path, "test.txt", true).unwrap();
        assert!(!diff_result.hunks.is_empty(), "Should have hunks");
        // Should have removed and added lines
        let has_removed = diff_result
            .hunks
            .iter()
            .any(|h| h.lines.iter().any(|l| matches!(l, DiffLine::Removed(_))));
        let has_added = diff_result
            .hunks
            .iter()
            .any(|h| h.lines.iter().any(|l| matches!(l, DiffLine::Added(_))));
        assert!(has_removed, "Should have removed lines");
        assert!(has_added, "Should have added lines");
    }

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

    #[test]
    fn should_detect_added_file_in_worktree_path() {
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path();

        let repo = Repository::init(repo_path).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();

        // Create initial commit
        let file_path = repo_path.join("existing.txt");
        std::fs::write(&file_path, "existing\n").unwrap();
        let mut index = repo.index().unwrap();
        index
            .add_path(std::path::Path::new("existing.txt"))
            .unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = git2::Signature::now("test", "test@test.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
            .unwrap();

        // Add new untracked file
        let new_file = repo_path.join("new_file.txt");
        std::fs::write(&new_file, "new content\n").unwrap();

        let files = get_changed_files_from_repo(&repo).unwrap();
        let new_file_entry = files
            .iter()
            .find(|f| f.path.to_string_lossy().contains("new_file.txt"));
        assert!(new_file_entry.is_some(), "Should detect new file");
        assert_eq!(new_file_entry.unwrap().status, FileStatus::Untracked);
    }
}
