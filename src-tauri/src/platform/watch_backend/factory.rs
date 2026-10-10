//! 平台 watcher 构造工厂：把「物理排除集合」烘焙进后端，并处理运行时回退。
//!
//! 排除集合的来源是 `WatchManifest.ignored_roots`，经 [`build_exclusion_paths`] 归一后传入；
//! macOS 实现在 `FSEventStreamStart` 之前调用 `FSEventStreamSetExclusionPaths` 落盘。

// notify `RecommendedWatcher::new` 是 `Watcher` trait 方法，构造工厂需要该 trait 在作用域内。
use notify::Watcher;

use super::platform_watcher::PlatformWatcher;
use std::collections::HashSet;
use std::path::PathBuf;

/// 运行时回退开关的环境变量名：置任意值即禁用 macOS 物理排除，退回
/// `RecursiveFilterOnly`（回调过滤仍保证正确性）。用于 exclusion 后端出问题时
/// 不阻塞可用性，无需改配置。
pub const DISABLE_FSEVENT_EXCLUSION_ENV: &str = "NEEKO_DISABLE_FSEVENT_EXCLUSION";

/// 归一听证边界排除集合：去重 + 保序。
///
/// 输入是 `WatchManifest.ignored_roots`（已按 gitignore / 用户排除剪枝出的**顶层** ignored
/// 根，父必为可见目录，因此互不为祖先）。这里只做去重与保序，**不新增任何判定语义** ——
/// 忽略规则仍然只有一个决策点（`GitIgnoreFilter`）。
#[must_use]
pub fn build_exclusion_paths(ignored_roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut seen = HashSet::with_capacity(ignored_roots.len());
    let mut out = Vec::with_capacity(ignored_roots.len());
    for path in ignored_roots {
        if seen.insert(path.clone()) {
            out.push(path.clone());
        }
    }
    out
}

/// 读取运行时回退开关（独立小函数：让工厂主体不依赖环境变量即可直测）。
#[cfg(target_os = "macos")]
fn fsevent_exclusion_disabled() -> bool {
    std::env::var_os(DISABLE_FSEVENT_EXCLUSION_ENV).is_some()
}

/// 构造平台文件 watcher：把压缩后的性能排除集合烘焙进后端。
///
/// - **macOS 且 `exclusions` 非空且未设回退开关** → [`PlatformWatcher::MacExclusion`]（递归
///   FSEvents + 物理排除集）；构造失败（CF 分配）则记 warn 并回退 `Native`。
/// - **其余情况**（非 macOS / 空集合 / 运行时回退开关 / 构造失败）→ [`PlatformWatcher::Native`]
///   （`notify::RecommendedWatcher`，行为与 W2 之前逐字一致）。
///
/// 回退不是正确性依赖：结构事件收敛仍在回调层兜底，物理排除只省掉 OS 侧投递成本。
pub fn create_file_watcher<F: notify::EventHandler>(
    handler: F,
    config: notify::Config,
    exclusions: &[PathBuf],
) -> notify::Result<PlatformWatcher> {
    #[cfg(target_os = "macos")]
    let disabled = fsevent_exclusion_disabled();
    #[cfg(not(target_os = "macos"))]
    let disabled = true;
    create_file_watcher_with_disabled(handler, config, exclusions, disabled)
}

/// [`create_file_watcher`] 的可测内核：运行时开关以参数注入（避免测试改全局 env）。
fn create_file_watcher_with_disabled<F: notify::EventHandler>(
    handler: F,
    config: notify::Config,
    exclusions: &[PathBuf],
    disabled: bool,
) -> notify::Result<PlatformWatcher> {
    #[cfg(target_os = "macos")]
    {
        if disabled {
            log::warn!(
                "[WatchBackend] {DISABLE_FSEVENT_EXCLUSION_ENV} set; \
                 using native recursive backend without physical exclusion"
            );
        }
        if !disabled && !exclusions.is_empty() {
            return match super::macos_fsevent::MacFseventWatcher::with_exclusions(
                handler, exclusions,
            ) {
                Ok(watcher) => Ok(PlatformWatcher::MacExclusion(watcher)),
                Err(fallback_handler) => {
                    log::warn!(
                        "[WatchBackend] macOS exclusion watcher unavailable; \
                         falling back to native recursive (callback filter still applies)"
                    );
                    Ok(PlatformWatcher::Native(notify::RecommendedWatcher::new(
                        fallback_handler,
                        config,
                    )?))
                }
            };
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (exclusions, disabled);
    Ok(PlatformWatcher::Native(notify::RecommendedWatcher::new(
        handler, config,
    )?))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 排除集合归一：路径齐全、去重、保序。
    #[test]
    fn build_exclusion_paths_dedupes_and_preserves_order() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("node_modules");
        let b = tmp.path().join("target");
        let input = vec![a.clone(), b.clone(), a.clone(), b.clone()];
        assert_eq!(build_exclusion_paths(&input), vec![a, b]);
    }

    /// 空输入 → 空集合（工厂据此走 Native 回退，行为与 W2 前一致）。
    #[test]
    fn build_exclusion_paths_empty_input_is_empty() {
        assert!(build_exclusion_paths(&[]).is_empty());
    }

    /// 无排除集合（或非 macOS）→ 原生 notify 后端，行为与 W2 前一致。
    #[test]
    fn create_file_watcher_without_exclusions_uses_native_backend() {
        let (tx, _rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
        let watcher = create_file_watcher_with_disabled(tx, notify::Config::default(), &[], false)
            .expect("construct watcher");
        assert!(matches!(watcher, PlatformWatcher::Native(_)));
    }

    /// 运行时回退开关置位 → 即使有排除集合也退回原生（AC3 的「不能排除」降级路径）。
    #[cfg(target_os = "macos")]
    #[test]
    fn create_file_watcher_disabled_falls_back_to_native() {
        let tmp = tempfile::tempdir().unwrap();
        let (tx, _rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
        let exclusions = vec![tmp.path().join("target")];
        let watcher =
            create_file_watcher_with_disabled(tx, notify::Config::default(), &exclusions, true)
                .expect("construct watcher");
        assert!(matches!(watcher, PlatformWatcher::Native(_)));
    }

    /// 能排除的路径 → macOS 物理排除后端（AC3 的「能排除」路径）。
    #[cfg(target_os = "macos")]
    #[test]
    fn create_file_watcher_with_exclusions_uses_mac_exclusion_backend() {
        let tmp = tempfile::tempdir().unwrap();
        let (tx, _rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
        let exclusions = vec![tmp.path().join("target")];
        let watcher =
            create_file_watcher_with_disabled(tx, notify::Config::default(), &exclusions, false)
                .expect("construct watcher");
        assert!(matches!(watcher, PlatformWatcher::MacExclusion(_)));
    }

    /// 公开工厂读 env 开关的默认路径（未设开关 + 有排除集 → macOS 排除后端）。
    /// 覆盖 `fsevent_exclusion_disabled()` 的读取分支（N-4）；env 已置位时跳过
    /// （不修改全局 env，避开与并行测试的竞争）。
    #[cfg(target_os = "macos")]
    #[test]
    fn create_file_watcher_defaults_to_mac_exclusion_when_env_unset() {
        if std::env::var_os(DISABLE_FSEVENT_EXCLUSION_ENV).is_some() {
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        let (tx, _rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
        let exclusions = vec![tmp.path().join("target")];
        let watcher =
            create_file_watcher(tx, notify::Config::default(), &exclusions).expect("construct");
        assert!(matches!(watcher, PlatformWatcher::MacExclusion(_)));
    }
}
