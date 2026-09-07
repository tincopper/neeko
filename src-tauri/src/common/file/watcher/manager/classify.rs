//! watcher 事件路径分类：内容/普通事件过滤与文件树结构事件过滤。

use super::super::gitignore::{is_hard_noise_path, GitIgnoreFilter};
use std::path::PathBuf;

/// 内容/普通事件路径过滤：git 项目遵循 .gitignore，非 git 项目仅排除硬噪声。
pub(super) fn relevant_event_paths(
    paths: &[PathBuf],
    filter: Option<&GitIgnoreFilter>,
) -> Vec<PathBuf> {
    match filter {
        Some(filter) => paths
            .iter()
            .filter(|path| !filter.should_ignore(path, None))
            .cloned()
            .collect(),
        None => paths
            .iter()
            .filter(|path| !is_hard_noise_path(path))
            .cloned()
            .collect(),
    }
}

/// 文件树结构事件路径过滤：ignored 节点本身仍在文件树展示，因此结构变更
/// 不能因 .gitignore 被丢弃；仅排除 .git / .DS_Store 这类元数据与平台噪声。
pub(super) fn structure_event_paths(paths: &[PathBuf], is_structure_change: bool) -> Vec<PathBuf> {
    if !is_structure_change {
        return Vec::new();
    }
    paths
        .iter()
        .filter(|path| !is_hard_noise_path(path))
        .cloned()
        .collect()
}
