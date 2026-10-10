//! watcher 事件路径分类：内容/普通事件过滤与文件树结构事件过滤。

use super::super::gitignore::{is_hard_noise_path, GitIgnoreFilter};
use std::path::{Path, PathBuf};

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

/// 文件树结构事件路径过滤。
///
/// 监听层**不订阅 ignored 子树内部**（R1 / D3）：结构事件里位于 ignored 子树内部
/// 的路径一律丢弃；只有 **ignored 根自身**的出现/消失/改名才保留（AC2：灰节点更新），
/// 由其父目录（可见）捕获。
///
/// 为什么不能「上溯到 ignored 根」了：下游 `debounce::push_parent_dir` 取路径的**父目录**，
/// 一个塌缩后的 `target` 会变成 `dirs=[""]`（仓库根 reload）——每个构建 debounce 窗口
/// 都触发一次根目录重载，违反 AC1「ignored 内部写入不产生任何事件」。因此这里直接丢弃内部路径。
///
/// - 非结构事件 → 空；
/// - `.git` / `.DS_Store` 硬噪声 → 丢弃；
/// - 位于 ignored 子树内（非 ignored 根自身）→ 丢弃；
/// - 其余路径（含 ignored 根自身、未忽略路径）原样保留、去重。
pub(super) fn structure_event_paths(
    paths: &[PathBuf],
    is_structure_change: bool,
    filter: Option<&GitIgnoreFilter>,
) -> Vec<PathBuf> {
    if !is_structure_change {
        return Vec::new();
    }
    let mut result: Vec<PathBuf> = Vec::new();
    // 去重集合：典型 notify 批次很小，但一次可见路径大批量事件时避免 O(n²)。
    let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    for path in paths {
        if is_hard_noise_path(path) {
            continue;
        }
        let keep = match filter {
            Some(filter) if filter.should_ignore(path, None) => {
                // ignored 子树：仅保留「ignored 根自身」的边界事件
                path == &topmost_ignored_ancestor(path, filter)
            }
            _ => true,
        };
        if keep && seen.insert(path.clone()) {
            result.push(path.clone());
        }
    }
    result
}

/// 自 `path` 向上回溯到**最顶层**被忽略的目录。
///
/// 调用方保证 `path` 已被忽略（`should_ignore(path)` 为真），因此祖先链上必然存在
/// 一段连续的 ignored 前缀；回溯停在「父目录不再被忽略」的那一层 —— 即读层
/// 「第一个被剪枝的目录」，也就是灰节点本身。
///
/// 祖先链上的每一层都是目录，显式传 `Some(true)` 避免逐层 `stat`
/// （`matched_path_or_any_parents` 对父级目录按目录语义匹配）。
fn topmost_ignored_ancestor(path: &Path, filter: &GitIgnoreFilter) -> PathBuf {
    let mut candidate = path.to_path_buf();
    while let Some(parent) = candidate.parent() {
        if !filter.should_ignore(parent, Some(true)) {
            break;
        }
        candidate = parent.to_path_buf();
    }
    candidate
}
