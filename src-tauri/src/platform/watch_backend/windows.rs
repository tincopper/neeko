//! Windows 文件监听后端能力：ReadDirectoryChangesW 整树订阅 + 回调过滤（降级态）。

use super::types::WatchBackend;

/// Windows：整树订阅，ignored 子树仍会送达本流，只能在回调层丢弃。
#[must_use]
pub const fn watch_backend() -> WatchBackend {
    WatchBackend::RecursiveFilterOnly
}
