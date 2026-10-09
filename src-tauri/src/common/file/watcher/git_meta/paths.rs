//! git 元数据监听路径解析：单个Workspace的 HEAD / index / refs / git_dir 定位。
//!
//! 独立监听该单元的 git 目录（非递归），绕过 git 忽略过滤（该过滤会丢弃 .git 内事件）：
//! - HEAD：分支切换（checkout 改写 HEAD）；
//! - index：`git add` / `git rm --cached` / `git reset` / `git commit` 等只改
//!   `.git/index`、不触碰工作区文件的操作 —— 主 watcher 无法感知，若不监听，
//!   ignored_files（文件树 .gitignore 灰色）与 staged 状态会残留旧值；
//! - refs（`refs/**` 递归 + `packed-refs`）：本地分支 / remote-tracking ref 变化。
//!   外部 `git push` / `fetch` 只改这里（HEAD / index / workdir 都不动），而 ahead/behind
//!   正是由这些 ref 决定 —— 不在监听集合内就会无界陈旧。
//!
//! **每个单元只看自己的 refs 所在 gitdir**：linked worktree 的 HEAD/index 位于其私有 gitdir
//! （`<common>/.git/worktrees/<name>/`），而 refs 位于**公共 gitdir**（`commondir` 指向），
//! 由 `resolve_common_git_dir` 定位；别的工作树的元数据与本题无关（旧实现在主仓 watcher 里
//! 递归监听 `.git/worktrees/**` 与其它工作树的工作目录，那是「worktree 没有自己的资源」
//! 这一前提的补丁，前提已随身份补全而消失）。

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
    /// refs 根目录（递归监听）。普通仓库 = `git_dir/refs`；linked worktree 的 refs 在
    /// **公共 gitdir**（`commondir` 指向），不是私有 gitdir —— 否则 worktree 视图看不到
    /// 外部 push。refs 目录不存在（尚无任何 ref）时不监听，不算失败。
    pub(super) refs_dir: PathBuf,
    /// `packed-refs` 文件（refs 被 gc 打包后的形态）。与 `refs_dir` 同源（公共 gitdir）。
    pub(super) packed_refs: PathBuf,
}

/// 解析 refs 所在的**公共 gitdir**：linked worktree 的私有 gitdir 里有 `commondir`
/// 指针文件（内容相对私有 gitdir，如 `../..`），refs / packed-refs 都在那里。
/// 普通仓库没有 `commondir`，返回 `git_dir` 自身。
///
/// 不解析公共目录的后果：worktree 的 `@{upstream}` 只在公共 refs 变化时变，
/// 而私有 gitdir 下根本没有 `refs/` —— 外部 `git push` 永远不会触发 worktree 视图重算。
///
/// **阻塞前置条件**：本函数内含同步 `std::fs::read_to_string` + `canonicalize`（红线 3 的
/// 阻塞 I/O）。调用方必须在阻塞池内运行（当前唯一调用链是 `mount_only` → `watch`，由
/// `git/services/status.rs` 的 `run_blocking` 包裹）—— 不得在 async 上下文直呼。
fn resolve_common_git_dir(git_dir: &Path) -> PathBuf {
    let commondir_file = git_dir.join("commondir");
    let Ok(content) = std::fs::read_to_string(&commondir_file) else {
        return git_dir.to_path_buf();
    };
    let rel = content.trim();
    if rel.is_empty() {
        return git_dir.to_path_buf();
    }
    let candidate = git_dir.join(rel);
    // 与 notify 上报的 realpath 对齐；失败（罕见权限/删除）时退回未归一的同一路径。
    candidate.canonicalize().unwrap_or(candidate)
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
    let common_git_dir = resolve_common_git_dir(&git_dir);
    let refs_dir = common_git_dir.join("refs");
    let packed_refs = common_git_dir.join("packed-refs");
    Some(GitMetaPaths {
        head,
        index,
        git_dir,
        refs_dir,
        packed_refs,
    })
}
