//! git 元数据 watcher 组装：单个仓库单元的 notify watcher 创建与事件分类回调。

use super::classify::{classify_git_meta_event, GitMetaChange};
use super::paths::GitMetaPaths;
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::{Arc, Mutex};

/// Git 元数据 watcher 句柄。
///
/// 只承担**保活**职责：drop 即释放该 watcher 及其监听。跨目录自愈补挂
/// （`rearm_worktrees_if_needed`）已随身份补全退役 —— 每个仓库单元自带一条
/// git 元数据 watcher，不再需要由主仓代为监听别人的 HEAD / index / 工作目录。
#[derive(Clone)]
pub(in crate::common::file::watcher) struct GitMetaWatcherHandle {
    /// Arc<Mutex> 与主 watcher 同款形态：`Watcher::watch` 需要 `&mut self`，
    /// 构造之后再无变更（保留 Mutex 仅因 notify 的所有权模型）。
    _watcher: Arc<Mutex<RecommendedWatcher>>,
}

/// 创建 git 元数据 watcher：非递归监听**该单元自己的** git 目录，捕获 HEAD（分支切换）
/// 与 index（暂存 / 取消暂存）变更，绕过 git 忽略过滤（该过滤会丢弃 .git 内事件）。
///
/// linked worktree 的 HEAD/index 位于其私有 gitdir（`<common>/.git/worktrees/<name>/`），
/// 由 [`super::paths::resolve_git_meta_paths`] 经 `.git` 指针文件定位 —— 因此该单元的
/// 分支切换与暂存操作与主仓完全同构地被覆盖（旧实现要靠主仓递归监听 `.git/worktrees/**`
/// 才能间接感知，事件还会串到错误的身份上）。
///
/// 回调经参数注入，便于脱离 `AppHandle` 做真实文件系统集成测试：
/// - `on_index_changed`：index 变更时调用（调用方负责查询调度，见 `WatcherManager::watch`）；
/// - `on_head_changed`：本单元 HEAD 变更时调用；
/// - `on_refs_changed`：`refs/**` / `packed-refs` 变更时调用（外部 push / fetch）。
///
/// 失败语义（显式约定）：核心 `git_dir` 监听失败 = watcher 无意义 → 返回 `None`（仅告警）；
/// 新增的 `refs_dir` / 公共 gitdir（linked worktree 的 `packed-refs` 所在目录）监听失败
/// 只告警，不影响 HEAD/index（各自独立）。
#[allow(clippy::type_complexity)]
pub(in crate::common::file::watcher) fn create_git_meta_watcher(
    unit: String,
    meta: &GitMetaPaths,
    on_index_changed: impl FnMut() + Send + 'static,
    on_head_changed: impl FnMut() + Send + 'static,
    on_refs_changed: impl FnMut() + Send + 'static,
) -> Option<GitMetaWatcherHandle> {
    create_git_meta_watcher_with(
        unit,
        meta,
        on_index_changed,
        on_head_changed,
        on_refs_changed,
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
    unit: String,
    meta: &GitMetaPaths,
    mut on_index_changed: impl FnMut() + Send + 'static,
    mut on_head_changed: impl FnMut() + Send + 'static,
    mut on_refs_changed: impl FnMut() + Send + 'static,
    mut watch_fn: W,
) -> Option<GitMetaWatcherHandle>
where
    W: FnMut(&mut RecommendedWatcher, &Path, RecursiveMode) -> Result<(), notify::Error>,
{
    let head_path = meta.head.clone();
    let index_path = meta.index.clone();
    let refs_dir = meta.refs_dir.clone();
    let packed_refs = meta.packed_refs.clone();
    let unit_for_cb = unit.clone();
    let result = RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| {
            let event = match result {
                Ok(ev) => ev,
                Err(e) => {
                    log::warn!("[Watcher:{}] git meta notify error: {}", unit_for_cb, e);
                    return;
                }
            };
            match classify_git_meta_event(
                &event.paths,
                &head_path,
                &index_path,
                &refs_dir,
                &packed_refs,
            ) {
                GitMetaChange::Nothing => {}
                GitMetaChange::IndexChanged => on_index_changed(),
                GitMetaChange::HeadChanged => on_head_changed(),
                GitMetaChange::RefsChanged => on_refs_changed(),
            }
        },
        Config::default(),
    );
    let mut watcher = match result {
        Ok(w) => w,
        Err(e) => {
            log::warn!("[Watcher:{}] create git meta watcher error: {}", unit, e);
            return None;
        }
    };
    // 核心：非递归监听该单元的 git 元数据目录（含 HEAD / index / 顶层元数据文件）。
    // 事件在回调内按 HEAD / index 分类过滤。失败 = watcher 无意义 → 返回 None。
    if let Err(e) = watch_fn(&mut watcher, &meta.git_dir, RecursiveMode::NonRecursive) {
        log::warn!(
            "[Watcher:{}] watch git meta dir error for {}: {}",
            unit,
            meta.git_dir.display(),
            e
        );
        return None;
    }
    log::info!(
        "[Watcher:{}] Watching git meta dir {}",
        unit,
        meta.git_dir.display()
    );

    // refs 递归监听：本地分支 / remote-tracking ref 的变化（外部 push / fetch / commit）
    // 不在 HEAD / index / workdir 里体现，必须在监听集合内，否则 ahead/behind 无界陈旧。
    // 失败只告警、**不**使整条 watcher 失效 —— HEAD/index 仍然有效（R3.3 行为兼容）。
    if meta.refs_dir.is_dir() {
        match watch_fn(&mut watcher, &meta.refs_dir, RecursiveMode::Recursive) {
            Ok(()) => log::info!(
                "[Watcher:{}] Watching git refs dir {} (recursive)",
                unit,
                meta.refs_dir.display()
            ),
            Err(e) => log::warn!(
                "[Watcher:{}] watch git refs dir error for {}: {} (HEAD/index still active)",
                unit,
                meta.refs_dir.display(),
                e
            ),
        }
    }
    // `packed-refs` 位于**公共 gitdir 根**下（linked worktree 时它是私有 gitdir 的兄弟，
    // `refs/` 递归监听覆盖不到），`git gc` / `pack-refs` 改写它必须能触发重算。
    // 普通仓库该目录就是 `meta.git_dir`（已非递归监听），跳过避免重复。失败只告警（R3.3）。
    if let Some(common_dir) = meta.packed_refs.parent() {
        if common_dir != meta.git_dir && common_dir.is_dir() {
            match watch_fn(&mut watcher, common_dir, RecursiveMode::NonRecursive) {
                Ok(()) => log::info!(
                    "[Watcher:{}] Watching common git dir {} (non-recursive, packed-refs)",
                    unit,
                    common_dir.display()
                ),
                Err(e) => log::warn!(
                    "[Watcher:{}] watch common git dir error for {}: {} (HEAD/index/refs still active)",
                    unit,
                    common_dir.display(),
                    e
                ),
            }
        }
    }
    Some(GitMetaWatcherHandle {
        _watcher: Arc::new(Mutex::new(watcher)),
    })
}
