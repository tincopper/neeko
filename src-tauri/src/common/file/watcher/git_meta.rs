//! git 元数据（HEAD / index / worktrees）监听与分类。
//!
//! 独立监听 `.git` 目录（非递归），绕过 git 忽略过滤（该过滤会丢弃 .git 内事件）：
//! - HEAD：分支切换（checkout 改写 HEAD）；
//! - index：git add / rm --cached / reset / commit 等只改 `.git/index`、不触碰
//!   工作区文件的操作——主 watcher 无法感知，若不监听，ignored_files（文件树
//!   .gitignore 灰色）与 staged 状态会残留旧值；
//! - `.git/worktrees`：linked worktree 内 checkout 改写该目录下 HEAD。

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

/// 解析仓库 HEAD 文件路径（分支切换检测用）。
/// 普通仓库为 `<repo>/.git/HEAD`；linked worktree 的 `.git` 是指针文件，
/// 内容形如 `gitdir: /path/to/main/.git/worktrees/<name>`，HEAD 位于该目录下。
fn resolve_git_head_path(repo_path: &Path) -> Option<PathBuf> {
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
pub(super) struct GitMetaPaths {
    /// HEAD 文件绝对路径（分支切换检测）
    head: PathBuf,
    /// index 文件绝对路径（暂存 / 取消暂存检测）
    index: PathBuf,
    /// HEAD 所在目录（普通仓库为 `<repo>/.git`，linked worktree 为其 gitdir）
    git_dir: PathBuf,
    /// 是否存在 linked worktree（决定是否递归监听 `.git/worktrees`）
    has_worktrees: bool,
}

/// 解析 git 元数据监听所需路径。非 git 目录返回 `None`。
///
/// 注意：必须对 `git_dir` 做 `canonicalize()` 归一化——notify（FSEvents 等
/// 后端）上报的事件路径是 realpath（macOS 上 `/var` → `/private/var` 符号链接
/// 会被解析），若不归一化，HEAD/index 事件路径与监听路径不匹配，分类永远落空、
/// 修复失效。canonicalize 失败（罕见权限/删除场景）时回退原始路径（仍可 watch，
/// 但符号链接场景下事件匹配可能受影响）。
pub(super) fn resolve_git_meta_paths(repo_path: &Path) -> Option<GitMetaPaths> {
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

/// Git 元数据事件分类结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GitMetaChange {
    /// 无关路径（config / ORIG_HEAD 等），不处理
    Nothing,
    /// index 变更 → 需要全量刷新（覆盖 ignored_files）
    IndexChanged,
    /// HEAD 或 worktree HEAD 变更（分支切换）
    HeadChanged,
}

/// 将一次 git 元数据事件涉及的路径分类为 HEAD / index / 无关。
///
/// 优先级：index 优先于 HEAD —— `git commit` 会同时改写 index（清空暂存）
/// 与 HEAD，此时按 index 处理，确保全量刷新覆盖 ignored_files。
fn classify_git_meta_event(
    paths: &[PathBuf],
    head: &Path,
    index: &Path,
    worktrees_dir: Option<&Path>,
) -> GitMetaChange {
    if paths.iter().any(|p| p == index) {
        return GitMetaChange::IndexChanged;
    }
    let touched_head = paths.iter().any(|p| p == head);
    // worktrees 目录递归监听产生的事件（其他 worktree 的 HEAD 变更）
    let touched_worktree = worktrees_dir
        .map(|w| paths.iter().any(|p| p.starts_with(w)))
        .unwrap_or(false);
    if touched_head || touched_worktree {
        GitMetaChange::HeadChanged
    } else {
        GitMetaChange::Nothing
    }
}

/// Git 元数据 watcher 句柄：持有 Arc 化 watcher 与共享状态。
///
/// `worktrees_armed`：`.git/worktrees` 递归监听是否已实际挂载（供 rearm 判断）。
/// `has_wt`：worktrees 是否存在（或已出现）的语义标志——HEAD 事件据此决定是否
/// 走 `git-changed` 全量刷新兜底（与 worktree 场景无法区分事件来源的既有设计一致）。
///
/// 会话中途 `git worktree add` 后 worktrees 目录才出现：启动时的非递归 `.git`
/// 监听只会捕获目录创建事件、无法捕获其内 HEAD/index 变更（深度 2+）。本句柄提供
/// `rearm_worktrees_if_needed()` 自愈补挂，由心跳线程调用（notify 回调内禁止再调用
/// `watch()`——macOS FSEvents 会死锁，必须从独立线程补挂）。
#[derive(Clone)]
pub(super) struct GitMetaWatcherHandle {
    /// Arc<Mutex> 使心跳线程（rearm）能取 `&mut` 调用 `watch`（notify 的
    /// `Watcher::watch` 需要 `&mut self`）。锁仅在启动设置与 30s rearm 时短暂持有，
    /// notify 回调不触碰该锁，无死锁风险。
    watcher: Arc<Mutex<RecommendedWatcher>>,
    /// 可能存在的 worktrees 目录。普通/主仓库恒为 `<git_dir>/worktrees`；
    /// linked worktree 项目为其 gitdir 下的同名子目录（实际不存在，由 is_dir 兜底）。
    worktrees_dir: Option<PathBuf>,
    /// worktrees 是否已被递归监听（自愈补挂成功后置 true）
    worktrees_armed: Arc<AtomicBool>,
    /// worktrees 是否存在（HEAD 事件是否应触发全量刷新兜底）
    has_wt: Arc<AtomicBool>,
}

impl GitMetaWatcherHandle {
    /// 自愈补挂：心跳线程按 10s 节奏调用。worktrees 目录在启动后出现时，首次
    /// 补挂递归监听并置位 `has_wt`，此后该 worktree 的 HEAD/index 变更才会驱动
    /// `git-changed` 全量刷新（修复会话中途 `git worktree add` 后 worktree 状态
    /// 永不自动刷新的缺口）。已挂载 / 目录未出现时为 no-op；监听失败保持
    /// 未置位，下轮 10s 后重试。
    pub(super) fn rearm_worktrees_if_needed(&self) {
        let Some(wt_dir) = &self.worktrees_dir else {
            return;
        };
        if self.worktrees_armed.load(Ordering::Relaxed) || !wt_dir.is_dir() {
            return;
        }
        let result = self
            .watcher
            .lock()
            .expect("infallible: git meta watcher mutex")
            .watch(wt_dir, RecursiveMode::Recursive);
        apply_rearm_result(wt_dir, result, &self.worktrees_armed, &self.has_wt);
    }
}

/// rearm 结果的状态迁移（纯函数，供测试确定性覆盖失败/成功两分支）。
///
/// 成功 → 置位 `worktrees_armed` + `has_wt`，返回 `true`（worktree HEAD 事件
/// 此后携带 has_wt=true 驱动全量刷新）；失败 → 保持 false（下轮 10s 后重试），
/// 仅告警，返回 `false`。
fn apply_rearm_result(
    wt_dir: &Path,
    result: Result<(), notify::Error>,
    worktrees_armed: &AtomicBool,
    has_wt: &AtomicBool,
) -> bool {
    match result {
        Ok(()) => {
            worktrees_armed.store(true, Ordering::Relaxed);
            has_wt.store(true, Ordering::Relaxed);
            log::info!("[Watcher] Re-armed worktree HEAD dir {}", wt_dir.display());
            true
        }
        Err(e) => {
            log::warn!(
                "[Watcher] re-arm worktree HEAD dir error for {}: {}",
                wt_dir.display(),
                e
            );
            false
        }
    }
}

/// 创建 git 元数据 watcher：监听 `.git` 目录（非递归）捕获 HEAD（分支切换）
/// 与 index（暂存/取消暂存）变更，绕过 git 忽略过滤（该过滤会丢弃 .git 内事件）。
///
/// 监听范围：
/// - HEAD：分支切换（checkout 改写 HEAD）；
/// - index：git add / git rm --cached / git reset / git commit 等只改写
///   `.git/index`、不触碰工作区文件的操作——主 watcher 无法感知，若不监听，
///   ignored_files（文件树 .gitignore 灰色）与 staged 状态会残留旧值；
/// - `.git/worktrees`：linked worktree 内 checkout 改写该目录下 HEAD；启动时
///   不存在则由心跳线程经 `GitMetaWatcherHandle::rearm_worktrees_if_needed` 自愈补挂。
///
/// 回调经参数注入，便于脱离 `AppHandle` 做真实文件系统集成测试：
/// - `on_index_changed`：index 变更时调用（调用方负责全量刷新 fallback）；
/// - `on_head_changed(has_worktrees)`：HEAD / worktree HEAD 变更时调用。
///
/// 失败语义（显式约定）：
/// - 核心 `git_dir` 监听失败 = watcher 无意义 → 返回 `None`；
/// - `.git/worktrees` 子监听失败 = 非致命（本仓库 HEAD/index 监听仍有效）→ 仅告警。
#[allow(clippy::type_complexity)]
pub(super) fn create_git_meta_watcher(
    project_id: String,
    meta: &GitMetaPaths,
    on_index_changed: impl FnMut() + Send + 'static,
    on_head_changed: impl FnMut(bool) + Send + 'static,
) -> Option<GitMetaWatcherHandle> {
    create_git_meta_watcher_with(
        project_id,
        meta,
        on_index_changed,
        on_head_changed,
        |watcher, path, mode| watcher.watch(path, mode),
    )
}

/// `create_git_meta_watcher` 的 watch 行为注入版：`watch_fn` 替换真实
/// `RecommendedWatcher::watch`，供测试确定性覆盖失败分支。
///
/// 为何必须注入而非用「监听不存在路径」触发失败：notify 三平台行为不统一
/// （Linux inotify 报 ENOENT、Windows 报路径错误，但 macOS FSEvents 惰性、对
/// 不存在的路径不报错），以真实 notify 断言失败会跨平台 flaky。注入后失败分支
/// 可确定性验证（见测试 `create_git_meta_watcher_*_failure`）。
fn create_git_meta_watcher_with<W>(
    project_id: String,
    meta: &GitMetaPaths,
    mut on_index_changed: impl FnMut() + Send + 'static,
    mut on_head_changed: impl FnMut(bool) + Send + 'static,
    mut watch_fn: W,
) -> Option<GitMetaWatcherHandle>
where
    W: FnMut(&mut RecommendedWatcher, &Path, RecursiveMode) -> Result<(), notify::Error>,
{
    let head_path = meta.head.clone();
    let index_path = meta.index.clone();
    // 恒为 `<git_dir>/worktrees`：启动时可能不存在，由 rearm 在出现后补挂；
    // 回调分类据此识别 worktree HEAD 事件。
    let worktrees_dir = Some(meta.git_dir.join("worktrees"));
    // 回调闭包 move 捕获用 clone，外层仍需保留 worktrees_dir 做 watch 设置
    let worktrees_dir_for_cb = worktrees_dir.clone();
    // 共享状态：回调在 notify 线程读取，rearm 在心跳线程写入
    let worktrees_armed = Arc::new(AtomicBool::new(false));
    let has_wt = Arc::new(AtomicBool::new(meta.has_worktrees));
    let has_wt_for_cb = has_wt.clone();
    // 回调闭包 move 捕获用 clone，外层仍需保留 project_id 做 watch 设置日志
    let project_id_for_cb = project_id.clone();
    let result = RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| {
            let event = match result {
                Ok(ev) => ev,
                Err(e) => {
                    log::warn!(
                        "[Watcher:{}] git meta notify error: {}",
                        project_id_for_cb,
                        e
                    );
                    return;
                }
            };
            match classify_git_meta_event(
                &event.paths,
                &head_path,
                &index_path,
                worktrees_dir_for_cb.as_deref(),
            ) {
                GitMetaChange::Nothing => {}
                GitMetaChange::IndexChanged => on_index_changed(),
                GitMetaChange::HeadChanged => {
                    on_head_changed(has_wt_for_cb.load(Ordering::Relaxed));
                }
            }
        },
        Config::default(),
    );
    let mut watcher = match result {
        Ok(w) => w,
        Err(e) => {
            log::warn!(
                "[Watcher:{}] create git meta watcher error: {}",
                project_id,
                e
            );
            return None;
        }
    };
    // 核心：监听 git 元数据目录（含 HEAD / index / 顶层元数据文件），非递归。
    // 事件在回调内按 HEAD / index / worktrees 分类过滤。失败 = watcher 无意义。
    if let Err(e) = watch_fn(&mut watcher, &meta.git_dir, RecursiveMode::NonRecursive) {
        log::warn!(
            "[Watcher:{}] watch git meta dir error for {}: {}",
            project_id,
            meta.git_dir.display(),
            e
        );
        return None;
    }
    log::info!(
        "[Watcher:{}] Watching git meta dir {}",
        project_id,
        meta.git_dir.display()
    );
    // 辅助：linked worktree 的 HEAD 位于 `<git_dir>/worktrees/<name>/HEAD`。
    // 启动时即存在才补挂；会话中途出现由 rearm 自愈补挂。失败不致命
    // （本仓库 HEAD/index 监听仍有效），仅告警（best-effort）。
    if let Some(wt_dir) = &worktrees_dir {
        if wt_dir.is_dir() {
            match watch_fn(&mut watcher, wt_dir, RecursiveMode::Recursive) {
                Ok(()) => {
                    worktrees_armed.store(true, Ordering::Relaxed);
                    log::info!(
                        "[Watcher:{}] Watching worktree HEAD dir {}",
                        project_id,
                        wt_dir.display()
                    );
                }
                Err(e) => {
                    log::warn!(
                        "[Watcher:{}] watch worktree HEAD dir error for {}: {}",
                        project_id,
                        wt_dir.display(),
                        e
                    );
                }
            }
        }
    }
    Some(GitMetaWatcherHandle {
        watcher: Arc::new(Mutex::new(watcher)),
        worktrees_dir,
        worktrees_armed,
        has_wt,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize};
    use std::time::{Duration, Instant};

    /// 普通仓库：HEAD 位于 `<repo>/.git/HEAD`
    #[test]
    fn resolve_git_head_path_normal_repo() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        let git_dir = repo.join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();

        let head = resolve_git_head_path(repo).expect("should resolve HEAD");
        assert_eq!(head, git_dir.join("HEAD"));
    }

    /// linked worktree：`.git` 是指针文件，HEAD 位于 gitdir 指向的目录下
    #[test]
    fn resolve_git_head_path_linked_worktree() {
        let tmp = tempfile::tempdir().unwrap();
        let main_repo = tmp.path().join("main");
        let wt = tmp.path().join("wt");
        let wt_gitdir = main_repo.join(".git").join("worktrees").join("dev");
        std::fs::create_dir_all(&wt_gitdir).unwrap();
        std::fs::write(wt_gitdir.join("HEAD"), "ref: refs/heads/dev\n").unwrap();
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::write(
            wt.join(".git"),
            format!("gitdir: {}\n", wt_gitdir.display()),
        )
        .unwrap();

        let head = resolve_git_head_path(&wt).expect("should resolve worktree HEAD");
        assert_eq!(head, wt_gitdir.join("HEAD"));
    }

    /// 非 git 目录：返回 None
    #[test]
    fn resolve_git_head_path_not_a_repo() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(resolve_git_head_path(tmp.path()).is_none());
    }

    /// 主仓库 + linked worktree 并存：
    /// 主仓库 HEAD 解析到 `.git/HEAD`，且 `.git/worktrees` 目录存在
    /// （HEAD watcher 据此判定需要全量 emit 兜底，覆盖 worktree 场景）。
    #[test]
    fn resolve_git_head_path_with_linked_worktrees() {
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("main");
        let main_repo = git2::Repository::init(&main).unwrap();

        // 需要至少一个 commit 才能添加 worktree
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        std::fs::write(main.join("README.md"), "# Test\n").unwrap();
        {
            let mut index = main_repo.index().unwrap();
            index.add_path(std::path::Path::new("README.md")).unwrap();
            index.write().unwrap();
            let tree_id = index.write_tree().unwrap();
            let tree = main_repo.find_tree(tree_id).unwrap();
            main_repo
                .commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
                .unwrap();
        }

        // 添加 linked worktree（git worktree add 等价操作）
        let wt = tmp.path().join("wt");
        main_repo
            .worktree("dev", &wt, None)
            .expect("should add worktree");

        // 主仓库 HEAD 仍是 `.git/HEAD`
        let main_head = resolve_git_head_path(&main).expect("should resolve main HEAD");
        assert_eq!(main_head, main.join(".git").join("HEAD"));

        // `.git/worktrees` 目录存在 → has_worktrees 判定为 true
        let wt_dir = main.join(".git").join("worktrees");
        assert!(
            wt_dir.is_dir(),
            "linked worktree 应创建 .git/worktrees 目录"
        );

        // linked worktree 的 HEAD 解析到 worktree 专属 gitdir。
        // macOS 上 /var 是 /private/var 符号链接，git2 写入的 gitdir 为 realpath，
        // 比较前先 canonicalize 归一化路径。
        let wt_head = resolve_git_head_path(&wt).expect("should resolve worktree HEAD");
        let wt_head_canon = wt_head.canonicalize().unwrap_or(wt_head.clone());
        let wt_dir_canon = wt_dir.canonicalize().unwrap_or(wt_dir.clone());
        assert!(
            wt_head_canon.starts_with(&wt_dir_canon),
            "worktree HEAD 应位于 .git/worktrees/<name>/HEAD，实际 {}",
            wt_head.display()
        );
        assert!(wt_head.ends_with("HEAD"));
    }
    // ── git 元数据路径解析（HEAD + index + git_dir + worktrees） ──────────────

    /// 普通仓库：HEAD 与 index 均位于 `<repo>/.git` 下
    #[test]
    fn resolve_git_meta_paths_normal_repo() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        let git_dir = repo.join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        std::fs::write(git_dir.join("index"), "\0").unwrap();

        let meta = resolve_git_meta_paths(repo).expect("should resolve git meta paths");
        // git_dir 会被 canonicalize（macOS /var → /private/var），断言按归一化后比较
        let git_dir_canon = git_dir.canonicalize().unwrap_or_else(|_| git_dir.clone());
        assert_eq!(meta.head, git_dir_canon.join("HEAD"));
        assert_eq!(meta.index, git_dir_canon.join("index"));
        assert_eq!(meta.git_dir, git_dir_canon);
        assert!(!meta.has_worktrees);
    }

    /// linked worktree：HEAD 与 index 位于 `<git_dir>/worktrees/<name>` 下
    #[test]
    fn resolve_git_meta_paths_linked_worktree() {
        let tmp = tempfile::tempdir().unwrap();
        let main_repo = tmp.path().join("main");
        let wt = tmp.path().join("wt");
        let wt_gitdir = main_repo.join(".git").join("worktrees").join("dev");
        std::fs::create_dir_all(&wt_gitdir).unwrap();
        std::fs::write(wt_gitdir.join("HEAD"), "ref: refs/heads/dev\n").unwrap();
        std::fs::write(wt_gitdir.join("index"), "\0").unwrap();
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::write(
            wt.join(".git"),
            format!("gitdir: {}\n", wt_gitdir.display()),
        )
        .unwrap();

        let meta = resolve_git_meta_paths(&wt).expect("should resolve worktree git meta paths");
        // git_dir 会被 canonicalize，断言按归一化后比较
        let wt_gitdir_canon = wt_gitdir
            .canonicalize()
            .unwrap_or_else(|_| wt_gitdir.clone());
        assert_eq!(meta.head, wt_gitdir_canon.join("HEAD"));
        assert_eq!(meta.index, wt_gitdir_canon.join("index"));
        assert_eq!(meta.git_dir, wt_gitdir_canon);
        assert!(!meta.has_worktrees);
    }

    /// 非 git 目录：返回 None
    #[test]
    fn resolve_git_meta_paths_not_a_repo() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(resolve_git_meta_paths(tmp.path()).is_none());
    }

    /// 主仓库 + linked worktree 并存：has_worktrees 判定为 true
    /// （git 元数据 watcher 据此监听 `.git/worktrees` 递归，捕获其他 worktree 的 HEAD）
    #[test]
    fn resolve_git_meta_paths_with_linked_worktrees() {
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("main");
        let main_repo = git2::Repository::init(&main).unwrap();

        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        std::fs::write(main.join("README.md"), "# Test\n").unwrap();
        {
            let mut index = main_repo.index().unwrap();
            index.add_path(std::path::Path::new("README.md")).unwrap();
            index.write().unwrap();
            let tree_id = index.write_tree().unwrap();
            let tree = main_repo.find_tree(tree_id).unwrap();
            main_repo
                .commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
                .unwrap();
        }

        let wt = tmp.path().join("wt");
        main_repo
            .worktree("dev", &wt, None)
            .expect("should add worktree");

        let meta = resolve_git_meta_paths(&main).expect("should resolve main git meta paths");
        assert!(meta.has_worktrees, "主仓库应检测到 linked worktree");

        let wt_meta = resolve_git_meta_paths(&wt).expect("should resolve worktree git meta paths");
        let wt_dir_canon = main.join(".git").join("worktrees").canonicalize().unwrap();
        let wt_meta_dir_canon = wt_meta
            .git_dir
            .canonicalize()
            .unwrap_or_else(|_| wt_meta.git_dir.clone());
        assert!(
            wt_meta_dir_canon.starts_with(&wt_dir_canon),
            "worktree git_dir 应位于 .git/worktrees/<name>，实际 {}",
            wt_meta.git_dir.display()
        );
        assert_eq!(wt_meta.index.file_name().unwrap(), "index");
        assert_eq!(wt_meta.head.file_name().unwrap(), "HEAD");
    }

    // ── git 元数据事件分类（HEAD / index / worktrees） ────────────────────────

    /// index 变更（git add / rm --cached / reset / commit）→ IndexChanged
    #[test]
    fn classify_git_meta_event_index_touched() {
        let head = PathBuf::from("/repo/.git/HEAD");
        let index = PathBuf::from("/repo/.git/index");
        let change = classify_git_meta_event(&[index.clone()], &head, &index, None);
        assert_eq!(change, GitMetaChange::IndexChanged);
    }

    /// HEAD 变更（分支切换）→ HeadChanged
    #[test]
    fn classify_git_meta_event_head_touched() {
        let head = PathBuf::from("/repo/.git/HEAD");
        let index = PathBuf::from("/repo/.git/index");
        let change = classify_git_meta_event(&[head.clone()], &head, &index, None);
        assert_eq!(change, GitMetaChange::HeadChanged);
    }

    /// 无关 git 元数据文件（config / ORIG_HEAD 等）→ Nothing
    #[test]
    fn classify_git_meta_event_ignores_unrelated_meta() {
        let head = PathBuf::from("/repo/.git/HEAD");
        let index = PathBuf::from("/repo/.git/index");
        let change =
            classify_git_meta_event(&[PathBuf::from("/repo/.git/config")], &head, &index, None);
        assert_eq!(change, GitMetaChange::Nothing);
    }

    /// worktrees 目录下的事件（其他 worktree 的 HEAD）→ HeadChanged
    #[test]
    fn classify_git_meta_event_worktree_head_touched() {
        let head = PathBuf::from("/repo/.git/HEAD");
        let index = PathBuf::from("/repo/.git/index");
        let wt_dir = PathBuf::from("/repo/.git/worktrees");
        let change = classify_git_meta_event(
            &[PathBuf::from("/repo/.git/worktrees/dev/HEAD")],
            &head,
            &index,
            Some(&wt_dir),
        );
        assert_eq!(change, GitMetaChange::HeadChanged);
    }

    /// 无 worktrees 时，worktrees 目录下的事件 → Nothing
    #[test]
    fn classify_git_meta_event_no_worktrees_dir_ignores_worktree_path() {
        let head = PathBuf::from("/repo/.git/HEAD");
        let index = PathBuf::from("/repo/.git/index");
        let change = classify_git_meta_event(
            &[PathBuf::from("/repo/.git/worktrees/dev/HEAD")],
            &head,
            &index,
            None,
        );
        assert_eq!(change, GitMetaChange::Nothing);
    }

    /// HEAD 与 index 同时变更（git commit：清空暂存 + 更新 HEAD）→ IndexChanged 优先
    /// （index 变更需要全量刷新覆盖 ignored_files，优先级高于 HEAD）
    #[test]
    fn classify_git_meta_event_index_takes_priority_over_head() {
        let head = PathBuf::from("/repo/.git/HEAD");
        let index = PathBuf::from("/repo/.git/index");
        let change = classify_git_meta_event(&[head.clone(), index.clone()], &head, &index, None);
        assert_eq!(change, GitMetaChange::IndexChanged);
    }

    /// 空事件路径 → Nothing
    #[test]
    fn classify_git_meta_event_empty_paths() {
        let head = PathBuf::from("/repo/.git/HEAD");
        let index = PathBuf::from("/repo/.git/index");
        let change = classify_git_meta_event(&[], &head, &index, None);
        assert_eq!(change, GitMetaChange::Nothing);
    }

    // ── 真实文件系统集成测试：验证 notify 事件送达（方案 B 修复的核心假设） ────
    //
    // 这些测试使用真实 notify::RecommendedWatcher + 真实临时 git 仓库，验证：
    // 1. `.git/index` 的原子写（lock + rename，git 真实行为）能被捕获 → on_index_changed
    // 2. `.git/HEAD` 的原子写能被捕获 → on_head_changed
    // 3. 无关元数据（config / ORIG_HEAD）不触发任何回调
    // 有界等待（5s）避免 flaky；非递归监听 `.git` 目录即足以捕获（git 在目录顶层
    // 原子替换 HEAD/index）。

    /// 集成测试助手：创建临时普通仓库 + git 元数据 watcher，返回计数 flag。
    /// `tempfile::TempDir` 必须随返回保持存活，否则目录被删、watcher 无事件。
    #[allow(clippy::type_complexity)]
    fn spawn_git_meta_watcher_spy() -> (
        tempfile::TempDir,
        GitMetaWatcherHandle,
        GitMetaPaths,
        Arc<AtomicUsize>,
        Arc<AtomicUsize>,
    ) {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        let git_dir = repo.join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        std::fs::write(git_dir.join("index"), "v1").unwrap();
        let meta = resolve_git_meta_paths(repo).unwrap();

        let index_changed = Arc::new(AtomicUsize::new(0));
        let head_changed = Arc::new(AtomicUsize::new(0));
        let index_flag = index_changed.clone();
        let head_flag = head_changed.clone();

        let watcher = create_git_meta_watcher(
            "integration-test".to_string(),
            &meta,
            move || {
                index_flag.fetch_add(1, Ordering::SeqCst);
            },
            move |_has_wt| {
                head_flag.fetch_add(1, Ordering::SeqCst);
            },
        )
        .expect("git meta watcher should be created");

        (tmp, watcher, meta, index_changed, head_changed)
    }

    /// 有界轮询等待条件成立（notify 异步送达，避免 flaky）
    fn wait_until(cond: impl Fn() -> bool, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if cond() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        cond()
    }

    /// 集成验证：`.git/index` 原子写（lock + rename，git add / rm --cached /
    /// reset / commit 的真实行为）能触发 on_index_changed——这是方案 B 修复
    /// 的核心假设：外部只改 index 的 git 操作必须驱动 git-changed 全量刷新，
    /// 否则 ignored_files（文件树 .gitignore 灰色）残留旧值。
    #[test]
    fn git_meta_watcher_detects_index_change_on_real_fs() {
        let (_tmp, watcher, meta, index_changed, head_changed) = spawn_git_meta_watcher_spy();
        // 给 notify 一点注册时间，降低首事件丢失概率（尤其 FSEvents）
        std::thread::sleep(Duration::from_millis(300));

        // 模拟 git 原子写 index：先写 index.lock 再 rename 为 index
        std::fs::write(meta.git_dir.join("index.lock"), "v2").unwrap();
        std::fs::rename(meta.git_dir.join("index.lock"), meta.git_dir.join("index")).unwrap();

        assert!(
            wait_until(
                || index_changed.load(Ordering::SeqCst) > 0,
                Duration::from_secs(5)
            ),
            "index 变更应触发 on_index_changed"
        );
        // index 变更不应触发 HEAD 回调
        assert_eq!(head_changed.load(Ordering::SeqCst), 0);
        drop(watcher);
    }

    /// 集成验证：`.git/HEAD` 原子写（分支切换的真实行为）能触发 on_head_changed。
    #[test]
    fn git_meta_watcher_detects_head_change_on_real_fs() {
        let (_tmp, watcher, meta, _index_changed, head_changed) = spawn_git_meta_watcher_spy();
        std::thread::sleep(Duration::from_millis(300));

        // 模拟 git 切分支改写 HEAD：lock + rename
        std::fs::write(meta.git_dir.join("HEAD.lock"), "ref: refs/heads/dev\n").unwrap();
        std::fs::rename(meta.git_dir.join("HEAD.lock"), meta.git_dir.join("HEAD")).unwrap();

        assert!(
            wait_until(
                || head_changed.load(Ordering::SeqCst) > 0,
                Duration::from_secs(5)
            ),
            "HEAD 变更应触发 on_head_changed"
        );
        drop(watcher);
    }

    /// 集成验证：无关 git 元数据（config / ORIG_HEAD）不应触发任何回调。
    /// 负向断言，验证事件分类过滤在真实文件系统上同样生效。
    #[test]
    fn git_meta_watcher_ignores_unrelated_git_meta_on_real_fs() {
        let (_tmp, watcher, meta, index_changed, head_changed) = spawn_git_meta_watcher_spy();
        std::thread::sleep(Duration::from_millis(300));

        std::fs::write(meta.git_dir.join("config"), "[core]\n").unwrap();
        std::fs::write(meta.git_dir.join("ORIG_HEAD"), "abc123\n").unwrap();

        // 等待足够时间，确认两个回调都未被触发
        std::thread::sleep(Duration::from_millis(600));
        assert_eq!(index_changed.load(Ordering::SeqCst), 0);
        assert_eq!(head_changed.load(Ordering::SeqCst), 0);
        drop(watcher);
    }

    // ── worktrees 自愈补挂（会话中途 git worktree add） ────────────────────────

    /// 自愈补挂集成验证：会话中途 `git worktree add`（worktrees 目录出现）后，
    /// 心跳线程调用 `rearm_worktrees_if_needed` 补挂递归监听，此后该 worktree 的
    /// HEAD 变更触发 `on_head_changed(has_wt=true)`（驱动 git-changed 全量刷新）。
    ///
    /// 断言铁三角（确定性，不依赖事件精确计数）：
    /// - rearm 前已送达的事件（目录创建）携带 has_wt=false；
    /// - rearm 后 worktree HEAD 变更使计数增长；
    /// - 增长由携带 has_wt=true 的 HeadChanged 事件贡献——该值只有在 rearm
    ///   成功置位后才能出现，是「递归监听已挂载且生效」的直接证明。
    #[test]
    fn git_meta_watcher_rearms_worktrees_watch_after_dir_appears() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        let git_dir = repo.join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        std::fs::write(git_dir.join("index"), "v1").unwrap();
        let meta = resolve_git_meta_paths(repo).unwrap();
        assert!(!meta.has_worktrees, "启动时应无 worktrees");

        let head_changed = Arc::new(AtomicUsize::new(0));
        let last_has_wt = Arc::new(AtomicBool::new(false));
        let head_flag = head_changed.clone();
        let last_has_wt_flag = last_has_wt.clone();
        let handle = create_git_meta_watcher(
            "rearm-test".to_string(),
            &meta,
            || {},
            move |has_wt| {
                last_has_wt_flag.store(has_wt, Ordering::SeqCst);
                head_flag.fetch_add(1, Ordering::SeqCst);
            },
        )
        .expect("git meta watcher should be created");
        // 给 notify 一点注册时间，降低首事件丢失概率
        std::thread::sleep(Duration::from_millis(300));

        // 1. 启动时无 worktrees：rearm 为 no-op
        handle.rearm_worktrees_if_needed();

        // 2. 会话中途 git worktree add：创建 worktrees/dev 目录。
        //    目录创建事件（深度 1）由非递归 .git 监听送达，分类为 HeadChanged
        //    （此刻 has_wt 仍 false）。wait_until 保证该事件已计入，后续断言无竞态。
        let wt_dir = git_dir.join("worktrees").join("dev");
        std::fs::create_dir_all(&wt_dir).unwrap();
        assert!(
            wait_until(
                || head_changed.load(Ordering::SeqCst) >= 1,
                Duration::from_secs(5)
            ),
            "worktrees 目录创建事件应送达（分类为 HeadChanged）"
        );
        assert!(
            !last_has_wt.load(Ordering::SeqCst),
            "rearm 前已送达的 HEAD 事件应携带 has_wt=false"
        );

        // 3. rearm 前：深度 2 的 worktree HEAD 写入不被非递归 .git 监听捕获
        //    （该路径只能由 rearm 后的递归监听送达——递归监听是必要路径）。
        std::fs::write(wt_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        std::thread::sleep(Duration::from_millis(400));
        let before_rearm = head_changed.load(Ordering::SeqCst);

        // 4. 自愈补挂：worktrees 目录已出现 → 挂上递归监听并置位 has_wt
        handle.rearm_worktrees_if_needed();
        std::thread::sleep(Duration::from_millis(300));

        // 5. rearm 后：worktree HEAD 变更（lock + rename，git 真实行为）
        //    应触发 on_head_changed，且携带 has_wt=true（驱动全量刷新兜底）
        std::fs::write(wt_dir.join("HEAD.lock"), "ref: refs/heads/feature\n").unwrap();
        std::fs::rename(wt_dir.join("HEAD.lock"), wt_dir.join("HEAD")).unwrap();

        assert!(
            wait_until(
                || head_changed.load(Ordering::SeqCst) > before_rearm,
                Duration::from_secs(5)
            ),
            "rearm 后 worktree HEAD 变更应触发 on_head_changed"
        );
        assert!(
            last_has_wt.load(Ordering::SeqCst),
            "rearm 后 HEAD 回调应携带 has_wt=true（驱动全量刷新兜底）"
        );
        drop(handle);
    }

    // ── create_git_meta_watcher 失败分支（确定性注入，跨平台安全） ─────────────

    /// 核心 `git_dir` 监听失败 = watcher 无意义 → 返回 `None`。
    ///
    /// 通过 `create_git_meta_watcher_with` 注入 watch_fn 模拟失败：不依赖 notify
    /// 对「不存在路径」的报错行为（macOS FSEvents 惰性不报错，真实触发会跨平台
    /// flaky），失败分支得以在任意平台确定性覆盖。
    #[test]
    fn create_git_meta_watcher_returns_none_when_git_dir_watch_fails() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        let git_dir = repo.join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        std::fs::write(git_dir.join("index"), "\0").unwrap();
        let meta = resolve_git_meta_paths(repo).unwrap();

        // 注入：核心 git_dir 监听一律失败（模拟权限/删除竞态）
        let result = create_git_meta_watcher_with(
            "test".to_string(),
            &meta,
            || {},
            |_| {},
            |_watcher, _path, _mode| Err(notify::Error::generic("simulated watch failure")),
        );
        assert!(
            result.is_none(),
            "核心 git_dir 监听失败 → watcher 无意义 → None"
        );
    }

    /// `.git/worktrees` 子监听失败 = 非致命 → 仍返回 watcher
    /// （本仓库 HEAD/index 监听保持有效）。
    #[test]
    fn create_git_meta_watcher_tolerates_worktree_subwatch_failure() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        let git_dir = repo.join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();
        // worktrees 目录存在，使「子监听失败」分支被走到
        std::fs::create_dir_all(git_dir.join("worktrees")).unwrap();
        std::fs::write(git_dir.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        std::fs::write(git_dir.join("index"), "\0").unwrap();
        let meta = resolve_git_meta_paths(repo).unwrap();

        // 注入：核心 git_dir 监听成功，仅 worktrees 子目录监听失败
        let result = create_git_meta_watcher_with(
            "test".to_string(),
            &meta,
            || {},
            |_| {},
            |watcher, path, mode| {
                if path.ends_with("worktrees") {
                    Err(notify::Error::generic("simulated worktrees watch failure"))
                } else {
                    watcher.watch(path, mode)
                }
            },
        );
        assert!(
            result.is_some(),
            "worktrees 子监听失败 → 非致命 → 仍返回 watcher"
        );
    }

    // ── rearm 结果状态迁移（apply_rearm_result 纯函数） ────────────────────────

    /// rearm 失败：标志保持 false，返回 false（下轮 10s 后重试）——确定性覆盖
    /// `rearm_worktrees_if_needed` 的 Err 分支（真实 notify 对不可监听路径的行为
    /// 三平台不统一，故经纯函数注入错误直接断言状态迁移）。
    #[test]
    fn apply_rearm_result_on_failure_keeps_flags_clear_for_retry() {
        let armed = AtomicBool::new(false);
        let has_wt = AtomicBool::new(false);
        let ok = apply_rearm_result(
            Path::new("/repo/.git/worktrees"),
            Err(notify::Error::generic("simulated rearm failure")),
            &armed,
            &has_wt,
        );
        assert!(!ok, "rearm 失败应返回 false");
        assert!(
            !armed.load(Ordering::SeqCst),
            "失败后 armed 应保持 false（下轮重试）"
        );
        assert!(!has_wt.load(Ordering::SeqCst), "失败后 has_wt 应保持 false");
    }

    /// rearm 成功：置位 armed + has_wt，返回 true（worktree HEAD 事件此后
    /// 携带 has_wt=true 驱动全量刷新）。
    #[test]
    fn apply_rearm_result_on_success_sets_flags() {
        let armed = AtomicBool::new(false);
        let has_wt = AtomicBool::new(false);
        let ok = apply_rearm_result(Path::new("/repo/.git/worktrees"), Ok(()), &armed, &has_wt);
        assert!(ok, "rearm 成功应返回 true");
        assert!(armed.load(Ordering::SeqCst), "成功后 armed 应置位");
        assert!(has_wt.load(Ordering::SeqCst), "成功后 has_wt 应置位");
    }
}
