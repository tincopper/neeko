//! watch 注册策略与状态机：平台策略分派 + Selective 逐目录注册 + 降级兜底 + 维护操作。

use super::super::gitignore::GitIgnoreFilter;
use notify::{RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// 注册目录数上限（公理：随仓库规模增长的结构必须有界）。超限降级为整树递归注册。
pub(super) const MAX_WATCH_DIRS: usize = 5000;
/// 单目录 watch 失败数上限（如 inotify EMFILE）：超过则降级为整树递归注册。
pub(super) const MAX_WATCH_FAILURES: usize = 8;

/// 注册策略（平台差异收敛点：新增平台 = 新增 variant 并补 match 分支）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum WatchStrategy {
    /// 逐可见目录 NonRecursive 注册（Linux inotify）
    Selective,
    /// 整树 Recursive 注册 + 回调过滤（macOS / Windows）
    Recursive,
}

impl WatchStrategy {
    /// 平台 → 策略（单一决策点）
    pub(super) const fn for_platform() -> Self {
        if crate::platform::watch_strategy::watch_selectively() {
            WatchStrategy::Selective
        } else {
            WatchStrategy::Recursive
        }
    }
}

/// 结构维护消息（notify 回调只投递、不直接 watch）
#[derive(Debug)]
pub(in crate::common::file::watcher) enum WatchMaintenance {
    /// 新出现的可见目录（Create/移入）：对其可见子树补注册
    AddDir(PathBuf),
    /// 目录被删除 / 移出（Remove）：清理自身与子孙注册状态
    RemoveDir(PathBuf),
    /// 忽略规则变化（.gitignore / info/exclude 编辑）：全量重算注册
    ReloadAll,
}

/// 计划纯函数：root 下应注册的全部目录（含 root 自身）。
///
/// 沿可见树遍历：跳过 `.git`、用 `filter.should_ignore_own` 剪枝（读层同款
/// 自匹配语义——被忽略目录不进入也不注册）；输出按遍历序（浅→深）。
/// `max_dirs` 超限时提前截止（调用方据此降级为整树注册）。
pub(super) fn compute_watch_dirs(
    root: &Path,
    filter: Option<&GitIgnoreFilter>,
    max_dirs: usize,
) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if out.len() >= max_dirs {
            break;
        }
        out.push(dir.clone());
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            let name = path.file_name().and_then(|n| n.to_str());
            // .git 元数据永不注册（git_meta watcher 单独负责）；ignored 子树剪枝
            if file_type.is_dir()
                && name != Some(".git")
                && !filter.is_some_and(|f| f.should_ignore_own(&path, file_type.is_dir()))
            {
                stack.push(path);
            }
        }
    }
    out
}

/// 一次注册会话的状态（跨维护消息共享注册集合）。
///
/// 泛型 `W: Watcher`：生产路径传 `RecommendedWatcher`，测试可注入 mock
/// （如 `FailureWatch`）确定性覆盖超限/失败降级分支——真实 notify 对不可监听
/// 路径的行为三平台不统一，直接断言会 flaky（与 git_meta 的 watch_fn 注入先例同因）。
#[derive(Default)]
pub(in crate::common::file::watcher) struct WatchRegistration {
    /// 已注册目录集合（Selective 策略使用；Recursive 恒空）
    pub(super) registered: HashSet<PathBuf>,
    /// 降级标志：触发后 Selective 不再逐目录注册
    pub(super) degraded: bool,
}

impl WatchRegistration {
    /// 初始注册：按平台策略对项目根建立监听
    pub(in crate::common::file::watcher) fn register_root<W: Watcher>(
        &mut self,
        watcher: &mut W,
        root: &Path,
        filter: Option<&GitIgnoreFilter>,
    ) {
        match WatchStrategy::for_platform() {
            WatchStrategy::Recursive => {
                // macOS/Windows：整树注册，ignored 子树由回调过滤
                if let Err(e) = watcher.watch(root, RecursiveMode::Recursive) {
                    log::warn!(
                        "[WatchRegistration] recursive watch error for {}: {}",
                        root.display(),
                        e
                    );
                }
            }
            WatchStrategy::Selective => {
                match filter {
                    // 有 git 语义过滤才值得逐目录注册（ignored 子树在注册层排除）
                    Some(_) => self.register_selective(watcher, root, filter),
                    // 非 git 项目：无排除语义，整树注册（避免 inotify watch 压力）
                    None => {
                        if let Err(e) = watcher.watch(root, RecursiveMode::Recursive) {
                            log::warn!(
                                "[WatchRegistration] recursive watch error for {}: {}",
                                root.display(),
                                e
                            );
                        }
                    }
                }
            }
        }
    }

    /// Linux 选择式注册：逐可见目录 NonRecursive；超限/失败过多降级整树
    pub(super) fn register_selective<W: Watcher>(
        &mut self,
        watcher: &mut W,
        root: &Path,
        filter: Option<&GitIgnoreFilter>,
    ) {
        let plan = compute_watch_dirs(root, filter, MAX_WATCH_DIRS);
        if plan.len() >= MAX_WATCH_DIRS {
            log::warn!(
                "[WatchRegistration] visible dirs exceeded cap {} at {} — degrading to recursive",
                MAX_WATCH_DIRS,
                root.display()
            );
            self.degrade_recursive(watcher, root);
            return;
        }
        let mut failures = 0usize;
        for dir in &plan {
            if self.registered.contains(dir) {
                continue;
            }
            match watcher.watch(dir, RecursiveMode::NonRecursive) {
                Ok(()) => {
                    self.registered.insert(dir.clone());
                }
                Err(e) => {
                    failures += 1;
                    log::warn!("[WatchRegistration] watch {} error: {}", dir.display(), e);
                    if failures >= MAX_WATCH_FAILURES {
                        log::warn!(
                            "[WatchRegistration] {} watch failures at {} — degrading to recursive",
                            failures,
                            root.display()
                        );
                        self.degrade_recursive(watcher, root);
                        return;
                    }
                }
            }
        }
        log::info!(
            "[WatchRegistration] selective registration: {} dirs at {}",
            self.registered.len(),
            root.display()
        );
    }

    /// 降级：清空已注册目录，整树递归注册（回调过滤兜底）
    pub(super) fn degrade_recursive<W: Watcher>(&mut self, watcher: &mut W, root: &Path) {
        self.degraded = true;
        for dir in self.registered.drain() {
            let _ = watcher.unwatch(&dir);
        }
        if let Err(e) = watcher.watch(root, RecursiveMode::Recursive) {
            log::warn!(
                "[WatchRegistration] degraded recursive watch error for {}: {}",
                root.display(),
                e
            );
        }
    }

    /// 维护：新出现的路径（子树补注册；Recursive 策略、降级态、非目录为 no-op）。
    /// 非目录判定在维护线程执行（notify 回调不做 fs 探测）。
    pub(in crate::common::file::watcher) fn on_dir_added<W: Watcher>(
        &mut self,
        watcher: &mut W,
        root: &Path,
        dir: &Path,
        filter: Option<&GitIgnoreFilter>,
    ) {
        if WatchStrategy::for_platform() != WatchStrategy::Selective
            || self.degraded
            || filter.is_none()
        {
            return;
        }
        self.add_dir(watcher, root, dir, filter);
    }

    /// Selective 状态机的目录补注册；与平台分派分离，便于跨平台直测。
    pub(super) fn add_dir<W: Watcher>(
        &mut self,
        watcher: &mut W,
        root: &Path,
        dir: &Path,
        filter: Option<&GitIgnoreFilter>,
    ) {
        if self.registered.len() >= MAX_WATCH_DIRS {
            log::warn!(
                "[WatchRegistration] selective watch cap {} reached at {} — degrading to recursive",
                MAX_WATCH_DIRS,
                root.display()
            );
            self.degrade_recursive(watcher, root);
            return;
        }
        if !dir.is_dir() {
            return;
        }
        let plan = compute_watch_dirs(
            dir,
            filter,
            MAX_WATCH_DIRS.saturating_sub(self.registered.len()),
        );
        for d in plan {
            if self.registered.insert(d.clone()) {
                if let Err(e) = watcher.watch(&d, RecursiveMode::NonRecursive) {
                    log::warn!("[WatchRegistration] add watch {} error: {}", d.display(), e);
                }
            }
        }
    }

    /// 维护：目录删除 / 移出 → 清理自身与所有子孙注册，避免 stale 集合。
    pub(in crate::common::file::watcher) fn on_dir_removed<W: Watcher>(
        &mut self,
        watcher: &mut W,
        dir: &Path,
    ) {
        if WatchStrategy::for_platform() != WatchStrategy::Selective || self.degraded {
            return;
        }
        self.remove_dir(watcher, dir);
    }

    /// Selective 状态机的目录移除清理；与平台分派分离，便于跨平台直测。
    pub(super) fn remove_dir<W: Watcher>(&mut self, watcher: &mut W, dir: &Path) {
        let removed: Vec<PathBuf> = self
            .registered
            .iter()
            .filter(|path| *path == dir || path.starts_with(dir))
            .cloned()
            .collect();
        for path in &removed {
            self.registered.remove(path);
            let _ = watcher.unwatch(path);
        }
    }

    /// 维护：忽略规则变化 → 全量重算（先解除全部，再按新规则注册）
    pub(in crate::common::file::watcher) fn on_rules_changed<W: Watcher>(
        &mut self,
        watcher: &mut W,
        root: &Path,
        filter: Option<&GitIgnoreFilter>,
    ) {
        if WatchStrategy::for_platform() != WatchStrategy::Selective
            || self.degraded
            || filter.is_none()
        {
            return;
        }
        for dir in self.registered.drain() {
            let _ = watcher.unwatch(&dir);
        }
        self.register_selective(watcher, root, filter);
    }
}
