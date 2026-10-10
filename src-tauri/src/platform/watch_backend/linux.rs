//! Linux 文件监听后端能力：inotify 支持逐目录注册，ignored 子树在内核层不产生事件。

use super::types::WatchBackend;

/// Linux inotify：逐目录注册，ignored 子树在注册层省略。
#[must_use]
pub const fn watch_backend() -> WatchBackend {
    WatchBackend::SelectiveRegistration
}
