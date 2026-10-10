//! 平台 watcher 门面：按能力位在「原生 notify」与「macOS 物理排除后端」之间选择，
//! 对外仍是一个 `notify::Watcher`，注册/维护代码无需感知具体后端。

use notify::{Config, EventHandler, RecursiveMode, Watcher, WatcherKind};
use std::path::Path;

/// 平台文件 watcher（唯一暴露给注册层的类型）。
///
/// 逐方法委托到内层实现：`Native` = `notify::RecommendedWatcher`（非 macOS / 无排除 /
/// Mac 后端构造失败），`MacExclusion` = 递归 FSEvents + `FSEventStreamSetExclusionPaths`。
pub enum PlatformWatcher {
    /// 原生 notify 后端（行为与 W2 之前逐字一致）。
    Native(notify::RecommendedWatcher),
    /// macOS 专用：物理排除 ignored 子树的 FSEvents 后端。
    #[cfg(target_os = "macos")]
    MacExclusion(super::macos_fsevent::MacFseventWatcher),
}

impl PlatformWatcher {
    /// 该 watcher 实例是否真正在做物理排除（**活变体**，而非全局能力位）。
    ///
    /// 与 [`WatchBackend::can_exclude_subtrees`](super::WatchBackend::can_exclude_subtrees) 的区别：
    /// 后者是平台能力位（env 回退开关不影响它），本方法是**构造结果**的实际能力 ——
    /// `Native`（含因 `NEEKO_DISABLE_FSEVENT_EXCLUSION` / 空集合 / 构造失败而回退的实例）
    /// 恒 `false`。维护线程据此跳过无收益的 manifest 重建（N-3）。
    #[must_use]
    pub const fn supports_subtree_exclusion(&self) -> bool {
        #[cfg(target_os = "macos")]
        {
            matches!(self, Self::MacExclusion(_))
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = self;
            false
        }
    }

    /// 重建物理排除集合（仅 macOS 排除后端生效；`Native` 恒 no-op 返回 `false`）。
    ///
    /// **为什么需要它**：排除集合是 ignore 规则的派生值。`.gitignore` / 用户排除变化后，
    /// 新可见的子树若仍留在旧排除集合里，其事件将永不投递（无界陈旧，违反下端界契约）。
    /// 维护线程在 `ReloadAll` 时调用本方法，把新集合重烘焙进流。
    #[must_use]
    pub fn set_exclusion_paths(&mut self, exclusions: &[std::path::PathBuf]) -> bool {
        match self {
            Self::Native(_) => false,
            #[cfg(target_os = "macos")]
            Self::MacExclusion(watcher) => {
                watcher.update_exclusions(exclusions);
                true
            }
        }
    }
}

impl Watcher for PlatformWatcher {
    /// 默认构造走 `Native`；需要 exclusion 的调用方用
    /// [`super::create_file_watcher`] 而不是此方法。
    fn new<F: EventHandler>(event_handler: F, config: Config) -> notify::Result<Self> {
        Ok(Self::Native(notify::RecommendedWatcher::new(
            event_handler,
            config,
        )?))
    }

    fn kind() -> WatcherKind {
        // 与 `RecommendedWatcher::kind()` 对齐：非 macOS 仍是 inotify / RDC；
        // macOS 两个变体都是 FSEvents（notify 的 kind() 会按 feature 返回 Fsevent）。
        notify::RecommendedWatcher::kind()
    }

    fn watch(&mut self, path: &Path, recursive_mode: RecursiveMode) -> notify::Result<()> {
        match self {
            Self::Native(watcher) => watcher.watch(path, recursive_mode),
            #[cfg(target_os = "macos")]
            Self::MacExclusion(watcher) => watcher.watch(path, recursive_mode),
        }
    }

    fn unwatch(&mut self, path: &Path) -> notify::Result<()> {
        match self {
            Self::Native(watcher) => watcher.unwatch(path),
            #[cfg(target_os = "macos")]
            Self::MacExclusion(watcher) => watcher.unwatch(path),
        }
    }

    fn configure(&mut self, config: Config) -> notify::Result<bool> {
        match self {
            Self::Native(watcher) => watcher.configure(config),
            #[cfg(target_os = "macos")]
            Self::MacExclusion(watcher) => watcher.configure(config),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::Watcher as _;

    /// `Native` 后端没有物理排除能力：`set_exclusion_paths` 必须 no-op 并返回 false。
    #[test]
    fn native_set_exclusion_paths_is_noop() {
        let (tx, _rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
        let mut watcher = PlatformWatcher::Native(
            notify::RecommendedWatcher::new(tx, Config::default()).expect("construct native"),
        );
        let tmp = tempfile::tempdir().unwrap();
        assert!(!watcher.set_exclusion_paths(&[tmp.path().to_path_buf()]));
    }

    /// `Native` 活变体不具备物理排除能力。
    #[test]
    fn native_watcher_does_not_support_subtree_exclusion() {
        let (tx, _rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
        let watcher = PlatformWatcher::Native(
            notify::RecommendedWatcher::new(tx, Config::default()).expect("construct native"),
        );
        assert!(!watcher.supports_subtree_exclusion());
    }

    /// macOS 排除后端：`set_exclusion_paths` 返回 true（内层重建细节由 `macos_fsevent` 单测覆盖）。
    #[cfg(target_os = "macos")]
    #[test]
    fn mac_exclusion_set_exclusion_paths_delegates() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("target");
        let (tx, _rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
        let inner = super::super::macos_fsevent::MacFseventWatcher::with_exclusions(
            tx,
            std::slice::from_ref(&target),
        )
        .expect("construct mac exclusion watcher");
        let mut watcher = PlatformWatcher::MacExclusion(inner);
        assert!(watcher.supports_subtree_exclusion());
        assert!(watcher.set_exclusion_paths(&[target]));
    }

    /// 测试专用：构造不启动流的 macOS 排除后端，供上层编排（maintenance）直测。
    #[cfg(all(test, target_os = "macos"))]
    impl PlatformWatcher {
        pub(crate) fn mac_exclusion_for_test<F: EventHandler + 'static>(
            handler: F,
            exclusions: &[std::path::PathBuf],
        ) -> Self {
            Self::MacExclusion(
                super::super::macos_fsevent::MacFseventWatcher::with_exclusions(
                    handler, exclusions,
                )
                .unwrap_or_else(|_| panic!("construct mac exclusion watcher for test")),
            )
        }
    }
}
