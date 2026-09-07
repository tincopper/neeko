//! macOS watcher 注册策略：FSEvents 按前缀送达，需整树注册后过滤。

/// macOS 使用整树 Recursive 注册，ignored 子树由回调过滤。
#[must_use]
pub const fn watch_selectively() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_watches_recursively() {
        assert!(!watch_selectively());
    }
}
