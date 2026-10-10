//! 注册维护线程：消费结构变化消息，串行执行注册维护。
//!
//! **生命周期契约（与 `manager/core.rs` 的所有权约定配套）**：本线程**不得**强持有
//! `PlatformWatcher` —— 唯一强所有者是 `WatcherHandle`。持强引用会与「watcher 内的
//! notify 闭包持有本线程的 `maintenance_tx`」构成互相保活：watcher 不掉 → 闭包不掉 →
//! `tx` 不掉 → 本线程的 `rx.recv()` 永不返回 `Err` → 线程不退、它持有的 `Arc` 也不掉。
//! （2026-09-24 实测：同项目被 watch 4 次、单次变更被 emit 3 次。）
//! 改用 `Weak` 后，句柄 drop ⇒ watcher drop ⇒ 闭包与各 tx drop ⇒ 本线程既有的
//! "recv 断开即退出"语义自然生效，无需另设停机消息。

use super::super::gitignore::GitIgnoreFilter;
use super::super::manifest::WatchManifest;
use super::strategy::{WatchMaintenance, WatchRegistration, MAX_WATCH_DIRS};
use crate::platform::watch_backend::{build_exclusion_paths, PlatformWatcher};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Weak};

/// 维护线程入口：消费结构变化消息，串行执行注册维护（持 watcher 锁）。
/// notify 回调内禁止 watch（FSEvents 死锁），故经此线程中转。
pub(in crate::common::file::watcher) fn spawn_maintenance_thread(
    watcher: Weak<std::sync::Mutex<PlatformWatcher>>,
    root: PathBuf,
    filter: Option<Arc<GitIgnoreFilter>>,
    registration: Arc<std::sync::Mutex<WatchRegistration>>,
    rx: mpsc::Receiver<WatchMaintenance>,
) {
    let _ = std::thread::Builder::new()
        .name("watch-registration".to_string())
        .spawn(move || {
            while let Ok(msg) = rx.recv() {
                // 强所有者（句柄）已释放 ⇒ 无需再维护任何目录，直接退出。
                // 注意：upgrade 失败与「tx 全部断开」是同一件事的两面，此处显式退出
                // 以免依赖 drop 顺序的偶然性。
                let Some(watcher) = watcher.upgrade() else {
                    log::debug!(
                        "[WatchRegistration] watcher owner released, stopping maintenance thread"
                    );
                    break;
                };
                let Ok(mut watcher) = watcher.lock() else {
                    break;
                };
                let filter_ref = filter.as_deref();
                let mut reg = match registration.lock() {
                    Ok(reg) => reg,
                    Err(e) => {
                        log::warn!("[WatchRegistration] registration mutex poisoned: {}", e);
                        break;
                    }
                };
                // MutexGuard 不实现 Watcher：显式解引用到内层
                match msg {
                    WatchMaintenance::AddDir(dir) => {
                        reg.on_dir_added(&mut *watcher, &root, &dir, filter_ref);
                        // W2 成本缺口：挂载时**尚不存在**的 ignored 根（如首次
                        // `cargo build` 前的 `target/`）未被收进 exclusion，其内部
                        // churn 仍会投递（正确性由 W1 回调过滤兼底，但成本未兑）。
                        // 边界事件到达时补一次重建，让物理排除跟上运行期边界。
                        if added_ignored_root_needs_rebuild(&watcher, filter_ref, &dir) {
                            refresh_exclusions(&mut watcher, &root, filter_ref);
                        }
                    }
                    WatchMaintenance::RemoveDir(dir) => {
                        reg.on_dir_removed(&mut *watcher, &dir);
                    }
                    WatchMaintenance::ReloadAll => {
                        // 物理排除集合是 ignore 规则的派生值：规则变化（含**撤销**忽略）
                        // 必须重组 exclusion 流，否则新可见的子树仍留在旧排除集里、事件
                        // 永不投递（§14 下界）。仅对**活变体**真正做物理排除的后端执行
                        // （env 降级为 Native 时跳过无收益重建）。
                        refresh_exclusions(&mut watcher, &root, filter_ref);
                        reg.on_rules_changed(&mut *watcher, &root, filter_ref);
                    }
                }
            }
        });
}

/// 忽略规则变化后重建物理排除流；返回是否真的执行了重建。
///
/// 把「活变体判定 → manifest 派生 → set」这段编排抽成命名函数，便于直测
/// （`ReloadAll` 分支体因此只剩一行调度，无需为维护线程本身造夹具）。
/// 非物理排除后端（`Native`）或无过滤器时直接返回 `false`，不进 manifest 遍历。
fn refresh_exclusions(
    watcher: &mut PlatformWatcher,
    root: &Path,
    filter: Option<&GitIgnoreFilter>,
) -> bool {
    if !watcher.supports_subtree_exclusion() {
        return false;
    }
    let Some(filter) = filter else {
        return false;
    };
    let manifest = WatchManifest::compute(root, Some(filter), MAX_WATCH_DIRS);
    let exclusions = build_exclusion_paths(manifest.ignored_roots());
    watcher.set_exclusion_paths(&exclusions)
}

/// 运行期新出现的目录是否需要触发 exclusion 重建。
///
/// 仅当“后端真在物理排除” **且** “该目录是被忽略的根”时成立 ——
/// 可见目录的平凡新增不得引发重建（否则每次新建目录都全树遍历）。
fn added_ignored_root_needs_rebuild(
    watcher: &PlatformWatcher,
    filter: Option<&GitIgnoreFilter>,
    dir: &Path,
) -> bool {
    watcher.supports_subtree_exclusion() && filter.is_some_and(|f| f.should_ignore_own(dir, true))
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::Watcher as _;

    fn native_watcher() -> PlatformWatcher {
        let (tx, _rx) = mpsc::channel::<notify::Result<notify::Event>>();
        PlatformWatcher::Native(
            notify::RecommendedWatcher::new(tx, notify::Config::default())
                .expect("construct native"),
        )
    }

    /// 非物理排除后端（Native）→ 不重建（跳过无收益的 manifest 遍历）。
    #[test]
    fn refresh_exclusions_is_noop_for_native_watcher() {
        let tmp = tempfile::tempdir().unwrap();
        let filter = GitIgnoreFilter::new(tmp.path().to_path_buf());
        let mut watcher = native_watcher();
        assert!(!refresh_exclusions(&mut watcher, tmp.path(), Some(&filter)));
    }

    /// 无过滤器（非 git 单元）→ 不重建。
    #[test]
    fn refresh_exclusions_is_noop_without_filter() {
        let tmp = tempfile::tempdir().unwrap();
        let mut watcher = native_watcher();
        assert!(!refresh_exclusions(&mut watcher, tmp.path(), None));
    }

    /// 物理排除后端 + 有过滤器 → 重建（撤销/新增忽略都能生效）。
    #[cfg(target_os = "macos")]
    #[test]
    fn refresh_exclusions_rebuilds_on_mac_exclusion_watcher() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("target")).unwrap();
        std::fs::write(tmp.path().join(".gitignore"), "target/\n").unwrap();
        let filter = GitIgnoreFilter::new(tmp.path().to_path_buf());
        let (tx, _rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let mut watcher = PlatformWatcher::mac_exclusion_for_test(tx, &[]);
        assert!(refresh_exclusions(&mut watcher, tmp.path(), Some(&filter)));
    }

    /// 运行期新增**被忽略的**根（如首建前的 `target/`）→ 需重建（W2 成本缺口）。
    #[cfg(target_os = "macos")]
    #[test]
    fn added_ignored_root_needs_rebuild_true_on_mac_watcher() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("target");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(tmp.path().join(".gitignore"), "target/\n").unwrap();
        let filter = GitIgnoreFilter::new(tmp.path().to_path_buf());
        let (tx, _rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let watcher = PlatformWatcher::mac_exclusion_for_test(tx, &[]);
        assert!(added_ignored_root_needs_rebuild(
            &watcher,
            Some(&filter),
            &target
        ));
    }

    /// 运行期新增**可见**目录 → 不重建（避免每次新建目录都全树遍历）。
    #[cfg(target_os = "macos")]
    #[test]
    fn added_visible_dir_does_not_need_rebuild() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(tmp.path().join(".gitignore"), "target/\n").unwrap();
        let filter = GitIgnoreFilter::new(tmp.path().to_path_buf());
        let (tx, _rx) = mpsc::channel::<notify::Result<notify::Event>>();
        let watcher = PlatformWatcher::mac_exclusion_for_test(tx, &[]);
        assert!(!added_ignored_root_needs_rebuild(
            &watcher,
            Some(&filter),
            &src
        ));
    }

    /// 非物理排除后端 / 无过滤器 → 即使目录被忽略也不重建。
    #[test]
    fn added_ignored_root_needs_rebuild_false_without_exclusion_or_filter() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("target");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(tmp.path().join(".gitignore"), "target/\n").unwrap();
        let filter = GitIgnoreFilter::new(tmp.path().to_path_buf());
        let watcher = native_watcher();
        assert!(!added_ignored_root_needs_rebuild(
            &watcher,
            Some(&filter),
            &target
        ));
        assert!(!added_ignored_root_needs_rebuild(&watcher, None, &target));
    }
}
