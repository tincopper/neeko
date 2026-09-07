//! Windows watcher 注册策略：逐目录句柄内存成本过高，需整树注册后过滤。

/// Windows 使用整树 Recursive 注册，避免万级目录句柄压力。
#[must_use]
pub const fn watch_selectively() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_watches_recursively() {
        assert!(!watch_selectively());
    }
}
