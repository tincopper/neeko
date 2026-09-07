//! Linux watcher 注册策略：inotify 支持按目录排除 ignored 子树。

/// Linux 使用逐目录 NonRecursive 注册，可在注册层排除 ignored 子树。
#[must_use]
pub const fn watch_selectively() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_watches_selectively() {
        assert!(watch_selectively());
    }
}
