//! git 元数据监听路径解析：HEAD / index / git_dir / worktrees 定位。
//!
//! 独立监听 `.git` 目录（非递归），绕过 git 忽略过滤（该过滤会丢弃 .git 内事件）：
//! - HEAD：分支切换（checkout 改写 HEAD）；
//! - index：git add / rm --cached / reset / commit 等只改 `.git/index`、不触碰
//!   工作区文件的操作——主 watcher 无法感知，若不监听，ignored_files（文件树
//!   .gitignore 灰色）与 staged 状态会残留旧值；
//! - `.git/worktrees`：linked worktree 内 checkout 改写该目录下 HEAD。

use std::path::{Path, PathBuf};

/// 解析仓库 HEAD 文件路径（分支切换检测用）。
/// 普通仓库为 `<repo>/.git/HEAD`；linked worktree 的 `.git` 是指针文件，
/// 内容形如 `gitdir: /path/to/main/.git/worktrees/<name>`，HEAD 位于该目录下。
pub(super) fn resolve_git_head_path(repo_path: &Path) -> Option<PathBuf> {
    let git_path = repo_path.join(".git");
    if git_path.is_dir() {
        return Some(git_path.join("HEAD"));
    }
    if git_path.is_file() {
        // linked worktree：.git 是指针文件，读取 gitdir 定位真实 HEAD
        let content = std::fs::read_to_string(&git_path).ok()?;
        let gitdir = content
            .lines()
            .find_map(|l| l.trim().strip_prefix("gitdir:"))?
            .trim();
        if gitdir.is_empty() {
            return None;
        }
        return Some(PathBuf::from(gitdir).join("HEAD"));
    }
    None
}

/// Git 元数据监听路径解析结果。
///
/// `index` 是本次修复的核心：`git add` / `git rm --cached` / `git reset` /
/// `git commit` 等只改写 `.git/index`、不触碰工作区文件的操作，主 watcher
/// 完全无法感知，导致 `ignored_files`（文件树 .gitignore 灰色）与 staged 状态
/// 残留旧值。git 元数据 watcher 单独监听 `git_dir` 以捕获这些事件。
#[derive(Debug, Clone)]
pub(in crate::common::file::watcher) struct GitMetaPaths {
    /// HEAD 文件绝对路径（分支切换检测）
    pub(super) head: PathBuf,
    /// index 文件绝对路径（暂存 / 取消暂存检测）
    pub(super) index: PathBuf,
    /// HEAD 所在目录（普通仓库为 `<repo>/.git`，linked worktree 为其 gitdir）
    pub(super) git_dir: PathBuf,
    /// 是否存在 linked worktree（决定是否递归监听 `.git/worktrees`）
    pub(super) has_worktrees: bool,
}

/// 解析 git 元数据监听所需路径。非 git 目录返回 `None`。
///
/// 注意：必须对 `git_dir` 做 `canonicalize()` 归一化——notify（FSEvents 等
/// 后端）上报的事件路径是 realpath（macOS 上 `/var` → `/private/var` 符号链接
/// 会被解析），若不归一化，HEAD/index 事件路径与监听路径不匹配，分类永远落空、
/// 修复失效。canonicalize 失败（罕见权限/删除场景）时回退原始路径（仍可 watch，
/// 但符号链接场景下事件匹配可能受影响）。
pub(in crate::common::file::watcher) fn resolve_git_meta_paths(
    repo_path: &Path,
) -> Option<GitMetaPaths> {
    let head = resolve_git_head_path(repo_path)?;
    let parent = head.parent()?;
    let git_dir = parent
        .canonicalize()
        .unwrap_or_else(|_| parent.to_path_buf());
    // head/index 一律从归一化后的 git_dir 派生，与 notify realpath 事件对齐
    let head = git_dir.join("HEAD");
    let index = git_dir.join("index");
    let has_worktrees = git_dir.join("worktrees").is_dir();
    Some(GitMetaPaths {
        head,
        index,
        git_dir,
        has_worktrees,
    })
}

/// 解析 linked worktree 的工作目录绝对路径列表。
///
/// git 在 `.git/worktrees/<name>/gitdir` 文件中写入**裸绝对路径**，指向该 worktree
/// 工作目录内的 `.git` 文件（如 `/workspace/wt-dev/.git`，无 `gitdir: ` 前缀——
/// 前缀格式属于 worktree 侧的 `.git` 文件，此处防御性兼容）。指向的是 `.git`
/// 文件而非工作目录本身，须剥掉末尾 `.git` 分量才得到监听根。
/// 用于对 worktree 工作目录补挂递归监听（G3，P4：worktree 内文件编辑即时感知）。
pub(super) fn resolve_worktree_roots(git_dir: &Path) -> Vec<PathBuf> {
    let wts = git_dir.join("worktrees");
    let Ok(entries) = std::fs::read_dir(&wts) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|e| {
            let gitdir_file = e.path().join("gitdir");
            let content = std::fs::read_to_string(gitdir_file).ok()?;
            let line = content.lines().map(str::trim).find(|l| !l.is_empty())?;
            let raw = line.strip_prefix("gitdir:").map(str::trim).unwrap_or(line);
            let git_file = PathBuf::from(raw);
            let root = if git_file.file_name() == Some(std::ffi::OsStr::new(".git")) {
                git_file.parent()?.to_path_buf()
            } else {
                git_file
            };
            if root.as_os_str().is_empty() {
                return None;
            }
            // 归一化：与 notify realpath 事件对齐（macOS /var → /private/var）
            Some(root.canonicalize().unwrap_or(root))
        })
        .collect()
}
