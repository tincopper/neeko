//! 文件监听后端**能力位**（WatchBackend）：注册方式与 ignored 子树处理方式的单一决策模型。
//!
//! 第一性原理：`Selective` / `Recursive` 从来不是同层的「策略选择」，而是「后端支持剪枝」
//! 与「后端不支持、只能兜底」的能力差异被伪装成了选择。把该差异显式化为一个枚举，注册层
//! 只消费能力，不再自行判断平台。

/// 当前平台的文件监听后端能力（单一决策点，由 [`super::watch_backend`] 产出）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WatchBackend {
    /// 可对任意子树做**物理排除**（exclusion 列表），边界在 OS 层生效。
    SubtreeExclusion,
    /// 只能按目录注册（逐可见目录 NonRecursive）；ignored 子树在注册层被省略。
    SelectiveRegistration,
    /// 只能整树订阅 + 回调过滤；ignored 子树仍会送达本流，属降级态。
    RecursiveFilterOnly,
}

impl WatchBackend {
    /// 该后端能否在物理层真正排除 ignored 子树（而非逐事件过滤）。
    ///
    /// 消费点：`registration/maintenance.rs` 的 `ReloadAll` —— 只有能物理排除的后端才需要
    /// 在忽略规则变化时重建 exclusion 流；其余后端规则变化只影响回调过滤，无需重建。
    #[must_use]
    pub const fn can_exclude_subtrees(self) -> bool {
        matches!(self, Self::SubtreeExclusion)
    }

    /// 该后端是否需要逐可见目录注册（唯一能在注册层省略 ignored 的后端）。
    ///
    /// 消费点：`registration/strategy.rs` 的维护路径（`on_dir_added` / `on_dir_removed` /
    /// `on_rules_changed`）—— 只有逐目录注册的后端才维护注册集合。
    #[must_use]
    pub const fn registers_selectively(self) -> bool {
        matches!(self, Self::SelectiveRegistration)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 能力位的「能排除 / 不能排除」两条降级路径（AC3）。
    #[test]
    fn capability_bits_cover_both_exclusion_paths() {
        // 能排除：唯一 `SubtreeExclusion`
        assert!(WatchBackend::SubtreeExclusion.can_exclude_subtrees());
        // 不能排除：注册式（注册层省略）与整树过滤式（回调丢弃）都不得声称物理排除
        assert!(!WatchBackend::SelectiveRegistration.can_exclude_subtrees());
        assert!(!WatchBackend::RecursiveFilterOnly.can_exclude_subtrees());
        // 注册式后端唯一
        assert!(WatchBackend::SelectiveRegistration.registers_selectively());
        assert!(!WatchBackend::SubtreeExclusion.registers_selectively());
        assert!(!WatchBackend::RecursiveFilterOnly.registers_selectively());
    }

    /// 平台分派与预期一致（Linux/Windows 与 W0 前 `watch_selectively()` 等价；
    /// macOS 升级为 `SubtreeExclusion`）。
    #[test]
    fn watch_backend_matches_platform() {
        #[cfg(target_os = "linux")]
        assert_eq!(
            super::super::watch_backend(),
            WatchBackend::SelectiveRegistration
        );
        #[cfg(target_os = "macos")]
        assert_eq!(
            super::super::watch_backend(),
            WatchBackend::SubtreeExclusion
        );
        #[cfg(target_os = "windows")]
        assert_eq!(
            super::super::watch_backend(),
            WatchBackend::RecursiveFilterOnly
        );
    }
}
