//! watch 注册策略与状态机：平台策略分派 + Selective 逐目录注册 + 降级兜底 + 维护操作。

use super::super::gitignore::GitIgnoreFilter;
use super::super::manifest::WatchManifest;
use crate::platform::watch_backend::{watch_backend, WatchBackend};
use notify::{RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// 注册目录数上限（公理：随仓库规模增长的结构必须有界）。超限降级为整树递归注册。
pub(in crate::common::file::watcher) const MAX_WATCH_DIRS: usize = 5000;
/// 单目录 watch 失败数上限（如 inotify EMFILE）：超过则降级为整树递归注册。
pub(super) const MAX_WATCH_FAILURES: usize = 8;

/// 整树递归注册（`RecursiveFilterOnly` / `SubtreeExclusion` / 非 git `SelectiveRegistration`
/// 的公共形态；W2 会在 `SubtreeExclusion` 上于此前附加 exclusion 列表）。
fn watch_recursive<W: Watcher>(watcher: &mut W, root: &Path) {
    if let Err(e) = watcher.watch(root, RecursiveMode::Recursive) {
        log::warn!(
            "[WatchRegistration] recursive watch error for {}: {}",
            root.display(),
            e
        );
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

/// 一次注册会话的状态（跨维护消息共享注册集合）。
///
/// 泛型 `W: Watcher`：生产路径传 `RecommendedWatcher`，测试可注入 mock
/// （如 `FailureWatch`）确定性覆盖超限/失败降级分支——真实 notify 对不可监听
/// 路径的行为三平台不统一，直接断言会 flaky（与 git_meta 的 watch_fn 注入先例同因）。
#[derive(Default)]
pub(in crate::common::file::watcher) struct WatchRegistration {
    /// 已注册目录集合（`SelectiveRegistration` 使用；其它后端恒空）
    pub(super) registered: HashSet<PathBuf>,
    /// 降级标志：触发后 Selective 不再逐目录注册
    pub(super) degraded: bool,
}

impl WatchRegistration {
    /// 初始注册：按平台策略对项目根建立监听。
    ///
    /// `manifest` 是由 `manager/core.rs` **预计算**的监听边界清单（纯计算，注册与 macOS
    /// 物理排除共用同一份，避免重复遍历整棵树）。`SelectiveRegistration` 后端在
    /// `filter.is_some()` 时消费它的 `visible_dirs` / `degraded`；其余后端忽略之。
    /// 传 `None` 时（仅测试与维护路径的内部调用）回退到现算，行为不变。
    pub(in crate::common::file::watcher) fn register_root<W: Watcher>(
        &mut self,
        watcher: &mut W,
        root: &Path,
        filter: Option<&GitIgnoreFilter>,
        manifest: Option<&WatchManifest>,
    ) {
        match watch_backend() {
            // Selective 后端 + git 语义过滤：逐可见目录注册（ignored 子树在注册层排除）
            WatchBackend::SelectiveRegistration if filter.is_some() => {
                let computed;
                let manifest = match manifest {
                    Some(manifest) => manifest,
                    None => {
                        computed = WatchManifest::compute(root, filter, MAX_WATCH_DIRS);
                        &computed
                    }
                };
                self.register_selective(watcher, manifest, root);
            }
            // 非 git 项目（无排除语义，避免 inotify watch 压力）、SubtreeExclusion（macOS
            // FSEvents 已在工厂构造期烘焙 exclusion 列表）与 RecursiveFilterOnly：整树递归注册。
            WatchBackend::SelectiveRegistration
            | WatchBackend::SubtreeExclusion
            | WatchBackend::RecursiveFilterOnly => watch_recursive(watcher, root),
        }
    }

    /// SelectiveRegistration 后端的选择式注册：逐可见目录 NonRecursive；超限/失败过多降级整树
    pub(super) fn register_selective<W: Watcher>(
        &mut self,
        watcher: &mut W,
        manifest: &WatchManifest,
        root: &Path,
    ) {
        if manifest.is_degraded() {
            log::warn!(
                "[WatchRegistration] visible dirs exceeded cap {} at {} — degrading to recursive",
                MAX_WATCH_DIRS,
                root.display()
            );
            self.degrade_recursive(watcher, root);
            return;
        }
        log::debug!(
            "[WatchRegistration] manifest at {}: {} visible dirs, {} ignored roots",
            manifest.root().display(),
            manifest.visible_dirs().len(),
            manifest.ignored_roots().len()
        );
        let mut failures = 0usize;
        for dir in manifest.visible_dirs() {
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

    /// 降级：清空已注册目录，整树递归注册（回调过滤兜底）。
    ///
    /// **与 R5 的关系（显式例外）**：R5 要求 caps 溢出「只粗化、不扩成整树注册」。但对
    /// `SelectiveRegistration`（Linux）后端而言，caps 溢出意味着无法再逐目录注册；此时
    /// 若拒绝递归注册就会漏掉可见目录的事件 —— 直接违反 §14 下界（无界陈旧）。两难中
    /// **下界是正确性契约、优先于成本上界**：故此处仍递归，代价是 ignored 子树被一并
    /// 观察。该路径只在可见目录数触顶（MAX_WATCH_DIRS，远高于实际仓库）时可达，且 W1
    /// 已使 ignored churn 不再触发它，`degraded` 标志与日志使其可观测。
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
        if !watch_backend().registers_selectively() || self.degraded || filter.is_none() {
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
        // 监听层不订阅 ignored 子树（R1）：`WatchManifest::compute` 以 `dir` 为根、
        // 不会对 root 自身做剪枝——若 `dir` 已被 gitignore 忽略，补注册会把整棵
        // ignored 子树重新拉进物理监听。ignored 根的边界变化由其父目录（可见）
        // 监听捕获，无需也不能在此补注册。
        if filter.is_some_and(|f| f.should_ignore_own(dir, true)) {
            return;
        }
        let manifest = WatchManifest::compute(
            dir,
            filter,
            MAX_WATCH_DIRS.saturating_sub(self.registered.len()),
        );
        for d in manifest.visible_dirs() {
            if self.registered.insert(d.clone()) {
                if let Err(e) = watcher.watch(d, RecursiveMode::NonRecursive) {
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
        if !watch_backend().registers_selectively() || self.degraded {
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
        if !watch_backend().registers_selectively() || self.degraded || filter.is_none() {
            return;
        }
        for dir in self.registered.drain() {
            let _ = watcher.unwatch(&dir);
        }
        let manifest = WatchManifest::compute(root, filter, MAX_WATCH_DIRS);
        self.register_selective(watcher, &manifest, root);
    }
}
