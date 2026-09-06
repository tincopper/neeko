#![allow(unused_imports, missing_docs)]
use super::run_cmd_local;
use crate::common::git::parsers::parse_numstat_line;
use crate::project::types::{FileChange, FileStatus, GitInfo, GitProvider};
use anyhow::{Context, Result};
use git2::{Repository, Status, StatusOptions};
use std::path::{Path, PathBuf};

/// Get full git information for the repository at `repo_path`.
pub fn get_git_info(repo_path: &Path) -> Result<GitInfo> {
    let repo = Repository::open(repo_path).context("Failed to open git repository")?;

    // 复用已打开的 Repository，避免重复 open
    let branch_info = crate::common::git::local::get_git_branch_info_from_repo(&repo)?;
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
    // 上限与主链路 MAX_STATUS_ENTRIES 统一为 1000（G5，redesign-plan 决策点 4）。
    const MAX_CHANGED_FILES: usize = 1000;

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

            // G6 契约：git2 status flags → porcelain X/Y 字符（与 CLI 路径同词表；
            // libgit2 不提供 rename 旧路径，renamed_from 恒 None —— 主路径 CLI 有值）
            let (index_status, worktree_status) = status_chars(status);
            files.push(FileChange {
                // G1 契约统一：折叠 untracked 目录条目 path 不带尾斜杠（本路径一直如此），
                // 目录性落到显式 is_dir 字段 —— 与 CLI porcelain 路径（parse_status_line
                // 剥离尾斜杠 + is_dir）语义对齐，前端不再依赖斜杠判定（P0）。
                path: PathBuf::from(path),
                status: file_status,
                additions: 0,
                deletions: 0,
                is_dir: repo_workdir.join(path).is_dir(),
                index_status,
                worktree_status,
                renamed_from: None,
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

/// git2 status flags → porcelain X/Y 字符（G6 契约）。
/// X 表 index 侧（A/M/D/R/T），Y 表 worktree 侧（?/M/D/R/T）；冲突 CONFLICTED
/// 统一 'U'/'U'；与 CLI `git status --porcelain` 词表一致。
const fn status_chars(status: git2::Status) -> (Option<char>, Option<char>) {
    if status.contains(git2::Status::CONFLICTED) {
        return (Some('U'), Some('U'));
    }
    // porcelain 永远双侧输出：无变更侧为字面空格（词表一致性）
    let x = if status.contains(git2::Status::INDEX_NEW) {
        'A'
    } else if status.contains(git2::Status::INDEX_MODIFIED) {
        'M'
    } else if status.contains(git2::Status::INDEX_DELETED) {
        'D'
    } else if status.contains(git2::Status::INDEX_RENAMED) {
        'R'
    } else if status.contains(git2::Status::INDEX_TYPECHANGE) {
        'T'
    } else {
        ' '
    };
    let y = if status.contains(git2::Status::WT_NEW) {
        '?'
    } else if status.contains(git2::Status::WT_MODIFIED) {
        'M'
    } else if status.contains(git2::Status::WT_DELETED) {
        'D'
    } else if status.contains(git2::Status::WT_RENAMED) {
        'R'
    } else if status.contains(git2::Status::WT_TYPECHANGE) {
        'T'
    } else {
        ' '
    };
    (Some(x), Some(y))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::types::FileStatus;
    use git2::Repository;

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

    /// G6 契约：git2 flags → porcelain XY 映射。
    /// wt-only 修改：X=' '、Y='M'；index+wt 双改：X='M'、Y='M'；
    /// untracked：X=' '、Y='?'；冲突：'U'/'U'。
    #[test]
    fn status_chars_map_matches_porcelain_vocabulary() {
        assert_eq!(
            status_chars(git2::Status::WT_MODIFIED),
            (Some(' '), Some('M'))
        );
        assert_eq!(
            status_chars(git2::Status::INDEX_MODIFIED),
            (Some('M'), Some(' '))
        );
        assert_eq!(status_chars(git2::Status::WT_NEW), (Some(' '), Some('?')));
        assert_eq!(
            status_chars(git2::Status::INDEX_MODIFIED.union(git2::Status::WT_MODIFIED)),
            (Some('M'), Some('M'))
        );
        assert_eq!(
            status_chars(git2::Status::CONFLICTED),
            (Some('U'), Some('U'))
        );
        assert_eq!(
            status_chars(git2::Status::INDEX_NEW.union(git2::Status::WT_DELETED)),
            (Some('A'), Some('D'))
        );
    }

    /// G6 端到端：libgit2 路径产出的 entries 携带正确 XY
    /// （wt-only 修改 → ' '/'M'；untracked → ' '?''）。
    #[test]
    fn changed_files_from_repo_carry_xy_chars() {
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path();
        let repo = Repository::init(repo_path).unwrap();
        let mut config = repo.config().unwrap();
        config.set_str("user.name", "test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();
        std::fs::write(repo_path.join("tracked.txt"), "v1\n").unwrap();
        {
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("tracked.txt")).unwrap();
            index.write().unwrap();
            let tree_id = index.write_tree().unwrap();
            let tree = repo.find_tree(tree_id).unwrap();
            let sig = git2::Signature::now("test", "test@test.com").unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "initial", &tree, &[])
                .unwrap();
        }
        std::fs::write(repo_path.join("tracked.txt"), "v2\n").unwrap();
        std::fs::write(repo_path.join("new.txt"), "untracked\n").unwrap();

        let files = get_changed_files_from_repo(&repo).unwrap();
        let modified = files
            .iter()
            .find(|f| f.path.ends_with("tracked.txt"))
            .unwrap();
        assert_eq!(modified.index_status, Some(' '));
        assert_eq!(modified.worktree_status, Some('M'));
        let untracked = files.iter().find(|f| f.path.ends_with("new.txt")).unwrap();
        assert_eq!(untracked.index_status, Some(' '));
        assert_eq!(untracked.worktree_status, Some('?'));
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
