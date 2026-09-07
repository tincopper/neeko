//! git 元数据 watcher 组装：notify watcher 创建、事件分类回调、worktrees 自愈补挂。

use super::classify::{classify_git_meta_event, GitMetaChange};
use super::paths::{resolve_worktree_roots, GitMetaPaths};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

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
pub(in crate::common::file::watcher) struct GitMetaWatcherHandle {
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
    /// 已挂递归监听的 linked worktree 工作目录集合（G3：P4 worktree 文件即时感知）。
    /// 由 rearm 解析 `.git/worktrees/*/gitdir` 增量补挂。
    watched_worktree_roots: Arc<Mutex<std::collections::HashSet<PathBuf>>>,
}

impl GitMetaWatcherHandle {
    /// 自愈补挂：心跳线程按 10s 节奏调用。worktrees 目录在启动后出现时，首次
    /// 补挂递归监听并置位 `has_wt`，此后该 worktree 的 HEAD/index 变更才会驱动
    /// `git-changed` 全量刷新（修复会话中途 `git worktree add` 后 worktree 状态
    /// 永不自动刷新的缺口）。已挂载 / 目录未出现时为 no-op；监听失败保持
    /// 未置位，下轮 10s 后重试。
    ///
    /// G3 扩展：每个 tick 同时解析 linked worktree 工作目录（`.git/worktrees/*/gitdir`），
    /// 对未挂载的目录补挂递归监听（覆盖会话中途 `git worktree add` 后工作目录内
    /// 文件编辑/新建的即时感知）。
    pub(in crate::common::file::watcher) fn rearm_worktrees_if_needed(&self) {
        let Some(wt_dir) = &self.worktrees_dir else {
            return;
        };
        if wt_dir.is_dir() && !self.worktrees_armed.load(Ordering::Relaxed) {
            let result = self
                .watcher
                .lock()
                .expect("infallible: git meta watcher mutex")
                .watch(wt_dir, RecursiveMode::Recursive);
            apply_rearm_result(wt_dir, result, &self.worktrees_armed, &self.has_wt);
        }

        // G3：linked worktree 工作目录增量补挂（与 .git/worktrees 监听独立）
        let Some(meta_git_dir) = wt_dir.parent() else {
            return;
        };
        let mut watched = self
            .watched_worktree_roots
            .lock()
            .expect("infallible: worktree roots mutex");
        for root in resolve_worktree_roots(meta_git_dir) {
            if watched.contains(&root) {
                continue;
            }
            let result = self
                .watcher
                .lock()
                .expect("infallible: git meta watcher mutex")
                .watch(&root, RecursiveMode::Recursive);
            match result {
                Ok(()) => {
                    watched.insert(root.clone());
                    log::info!(
                        "[Watcher] Watching linked worktree dir {} (worktree file events)",
                        root.display()
                    );
                }
                Err(e) => {
                    log::warn!(
                        "[Watcher] watch linked worktree dir error for {}: {}",
                        root.display(),
                        e
                    );
                }
            }
        }
    }
}

/// rearm 结果的状态迁移（纯函数，供测试确定性覆盖失败/成功两分支）。
///
/// 成功 → 置位 `worktrees_armed` + `has_wt`，返回 `true`（worktree HEAD 事件
/// 此后携带 has_wt=true 驱动全量刷新）；失败 → 保持 false（下轮 10s 后重试），
/// 仅告警，返回 `false`。
pub(super) fn apply_rearm_result(
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
pub(in crate::common::file::watcher) fn create_git_meta_watcher(
    project_id: String,
    meta: &GitMetaPaths,
    on_index_changed: impl FnMut() + Send + 'static,
    on_head_changed: impl FnMut(bool) + Send + 'static,
    on_worktree_meta_changed: impl FnMut() + Send + 'static,
) -> Option<GitMetaWatcherHandle> {
    create_git_meta_watcher_with(
        project_id,
        meta,
        on_index_changed,
        on_head_changed,
        on_worktree_meta_changed,
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
pub(super) fn create_git_meta_watcher_with<W>(
    project_id: String,
    meta: &GitMetaPaths,
    mut on_index_changed: impl FnMut() + Send + 'static,
    mut on_head_changed: impl FnMut(bool) + Send + 'static,
    mut on_worktree_meta_changed: impl FnMut() + Send + 'static,
    mut watch_fn: W,
) -> Option<GitMetaWatcherHandle>
where
    W: FnMut(&mut RecommendedWatcher, &Path, RecursiveMode) -> Result<(), notify::Error>,
{
    let head_path = meta.head.clone();
    let index_path = meta.index.clone();
    // 恒为 `<git_dir>/worktrees`：启动时可能不存在，由 rearm 在出现后补挂；
    // 回调分类据此识别 worktree HEAD/index 事件。
    let worktrees_dir = Some(meta.git_dir.join("worktrees"));
    // 回调闭包 move 捕获用 clone，外层仍需保留 worktrees_dir 做 watch 设置
    let worktrees_dir_for_cb = worktrees_dir.clone();
    // 共享状态：回调在 notify 线程读取，rearm 在心跳线程写入
    let worktrees_armed = Arc::new(AtomicBool::new(false));
    let has_wt = Arc::new(AtomicBool::new(meta.has_worktrees));
    let has_wt_for_cb = has_wt.clone();
    // G3：linked worktree 工作目录集合（rearm 增量补挂；回调读取用于事件分类）
    let watched_worktree_roots: Arc<Mutex<std::collections::HashSet<PathBuf>>> =
        Arc::new(Mutex::new(std::collections::HashSet::new()));
    let watched_roots_for_cb = watched_worktree_roots.clone();
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
            let roots_snapshot: Vec<PathBuf> = watched_roots_for_cb
                .lock()
                .map(|s| s.iter().cloned().collect())
                .unwrap_or_default();
            match classify_git_meta_event(
                &event.paths,
                &head_path,
                &index_path,
                worktrees_dir_for_cb.as_deref(),
                &roots_snapshot,
            ) {
                GitMetaChange::Nothing => {}
                GitMetaChange::IndexChanged => on_index_changed(),
                GitMetaChange::HeadChanged => {
                    on_head_changed(has_wt_for_cb.load(Ordering::Relaxed));
                }
                GitMetaChange::WorktreeMetaChanged => on_worktree_meta_changed(),
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
        // G3：linked worktree 工作目录（P4 —— worktree 内文件编辑即时感知）。
        // 启动时已存在的 worktree 直接补挂；会话中途新增由 rearm 增量处理。
        {
            let mut watched = watched_worktree_roots
                .lock()
                .expect("infallible: worktree roots mutex");
            for root in resolve_worktree_roots(&meta.git_dir) {
                match watch_fn(&mut watcher, &root, RecursiveMode::Recursive) {
                    Ok(()) => {
                        watched.insert(root.clone());
                        log::info!(
                            "[Watcher:{}] Watching linked worktree dir {}",
                            project_id,
                            root.display()
                        );
                    }
                    Err(e) => {
                        log::warn!(
                            "[Watcher:{}] watch linked worktree dir error for {}: {}",
                            project_id,
                            root.display(),
                            e
                        );
                    }
                }
            }
        }
    }
    Some(GitMetaWatcherHandle {
        watcher: Arc::new(Mutex::new(watcher)),
        worktrees_dir,
        worktrees_armed,
        has_wt,
        watched_worktree_roots,
    })
}
