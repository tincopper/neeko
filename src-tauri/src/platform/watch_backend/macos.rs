//! macOS 文件监听后端能力：自写 FSEvents 后端可对子树做物理排除。
//!
//! 后端实现见 [`super::macos_fsevent`]；本文件只声明平台能力位。

use super::types::WatchBackend;

/// macOS FSEvents：递归订阅 + `FSEventStreamSetExclusionPaths` 物理排除 ignored 子树。
#[must_use]
pub const fn watch_backend() -> WatchBackend {
    WatchBackend::SubtreeExclusion
}
