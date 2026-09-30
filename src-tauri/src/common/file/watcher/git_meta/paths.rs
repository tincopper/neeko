//! git 元数据监听路径解析：单个仓库单元的 HEAD / index / git_dir 定位。
//!
//! 独立监听该单元的 git 目录（非递归），绕过 git 忽略过滤（该过滤会丢弃 .git 内事件）：
//! - HEAD：分支切换（checkout 改写 HEAD）；
//! - index：`git add` / `git rm --cached` / `git reset` / `git commit` 等只改
//!   `.git/index`、不触碰工作区文件的操作 —— 主 watcher 无法感知，若不监听，
//!   ignored_files（文件树 .gitignore 灰色）与 staged 状态会残留旧值。
//!
//! **每个单元只看自己的 git 目录**：linked worktree 的 HEAD/index 位于其私有 gitdir
//! （`<common>/.git/worktrees/<name>/`），由该单元自己的这条 watcher 负责；别的工作树的
//! 元数据与本题无关（旧实现在主仓 watcher 里递归监听 `.git/worktrees/**` 与其他工作树的
//! 工作目录，那是「worktree 没有自己的资源」这一前提的补丁，前提已随身份补全而消失）。

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
#[derive(Debug, Clone)]
pub(in crate::common::file::watcher) struct GitMetaPaths {
    /// HEAD 文件绝对路径（分支切换检测）
    pub(super) head: PathBuf,
    /// index 文件绝对路径（暂存 / 取消暂存检测）
    pub(super) index: PathBuf,
    /// 该单元的 git 目录（HEAD 所在目录：普通仓库为 `<repo>/.git`，linked worktree 为其 gitdir）
    pub(super) git_dir: PathBuf,
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
    // 先取 parent（`?` 已保证存在），再在它上面 canonicalize —— 失败就退回未归一的同一路径，
    // 不用 `expect`：本函数属于挂载路径，任何 panic 都会变成整个应用的 abort。
    let git_dir_parent = head.parent()?.to_path_buf();
    let git_dir = git_dir_parent.canonicalize().unwrap_or(git_dir_parent);
    // head/index 一律从归一化后的 git_dir 派生，与 notify realpath 事件对齐
    let head = git_dir.join("HEAD");
    let index = git_dir.join("index");
    Some(GitMetaPaths {
        head,
        index,
        git_dir,
    })
}
