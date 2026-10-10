//! Watch manifest：监听边界的一等表示（L1）。
//!
//! **第一性原理**：`gitignore` 回答的是「git 是否跟踪/展示」，而「监听边界」要回答的是
//! 「我拒绝观察哪些子树」。两者在 Linux 恰好重合（都逐目录剪枝），在 macOS 必然分叉。
//! 本模块把边界抽成**显式集合**：由「可见目录集合」生成，gitignore 只是它的输入之一，
//! 从而使边界可被物理实现（W2 的 exclusion）而不只是事后过滤。
//!
//! 生成规则（顺序即优先级，语义与改造前的 `compute_watch_dirs` 完全等价）：
//! 1. `.git` 元数据恒排除（既有硬噪声语义，git_meta watcher 单独负责）；
//! 2. **可见性剪枝**：沿可见树遍历，`should_ignore_own()` 命中即不进入，并把该目录收进
//!    `ignored_roots`（其父必为可见目录 ⇒ 天然是「顶层」ignored 根）。复用既有匹配语义，
//!    **不新增任何黑名单**；
//! 3. `max_dirs` 上限：可见目录数触顶即截止，并置 `degraded`（I3 的可观测位）。
//!
//! W0（本工作流）只生成 manifest，`ignored_roots` 与 `root` 供 W2 的物理排除消费；注册行为
//! 与改造前逐条等价（事件面 / 注册面 / 降级面均不变）。

use super::gitignore::GitIgnoreFilter;
use std::path::{Path, PathBuf};

/// 监听边界清单：`visible_dirs ⊆ 可见目录集合 ∪ {ignored 根存在性}`（I2 上界）。
#[derive(Debug, Clone)]
pub(super) struct WatchManifest {
    /// 清单生成时的根目录（日志 + W2 的 exclusion 相对换算）。
    root: PathBuf,
    /// 需要注册/订阅的可见目录（含 root 自身），按 DFS 遍历序（父先于子）。
    visible_dirs: Vec<PathBuf>,
    /// 被剪枝的**顶层** ignored 子树（父必为可见目录）；W2 用作物理排除集合。
    ignored_roots: Vec<PathBuf>,
    /// 是否因触及 `max_dirs` 上限而截断（I3 可观测位：边界可能不完整）。
    degraded: bool,
}

impl WatchManifest {
    /// 生成监听清单（纯计算）。`max_dirs` 为可见目录上限；触顶即截断并置 `degraded`。
    ///
    /// 遍历用显式栈做 DFS（父先于子，但同层顺序不保证）；顺序只影响注册顺序，
    /// 不影响集合语义。
    pub(super) fn compute(root: &Path, filter: Option<&GitIgnoreFilter>, max_dirs: usize) -> Self {
        let mut visible_dirs = Vec::new();
        let mut ignored_roots = Vec::new();
        let mut stack = vec![root.to_path_buf()];
        while let Some(dir) = stack.pop() {
            if visible_dirs.len() >= max_dirs {
                break;
            }
            visible_dirs.push(dir.clone());
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                if !file_type.is_dir() {
                    continue;
                }
                let path = entry.path();
                // .git 元数据：既不是可见目录，也不是 gitignore 意义上的 ignored 根
                if path.file_name().and_then(|n| n.to_str()) == Some(".git") {
                    continue;
                }
                // ignored 子树剪枝：不进入可见树，收进顶层 ignored 根集合
                if filter.is_some_and(|f| f.should_ignore_own(&path, true)) {
                    ignored_roots.push(path);
                    continue;
                }
                stack.push(path);
            }
        }
        // 与既有 `plan.len() >= MAX_WATCH_DIRS ⇒ degrade` 判据逐字等价。
        let degraded = visible_dirs.len() >= max_dirs;
        Self {
            root: root.to_path_buf(),
            visible_dirs,
            ignored_roots,
            degraded,
        }
    }

    /// 清单根目录。
    #[must_use]
    pub(super) fn root(&self) -> &Path {
        &self.root
    }

    /// 需注册/订阅的可见目录（含根）。
    #[must_use]
    pub(super) fn visible_dirs(&self) -> &[PathBuf] {
        &self.visible_dirs
    }

    /// 被剪枝的顶层 ignored 子树（W2 物理排除集合）。
    #[must_use]
    pub(super) fn ignored_roots(&self) -> &[PathBuf] {
        &self.ignored_roots
    }

    /// 是否因上限截断而降级（边界可能不完整）。
    #[must_use]
    pub(super) const fn is_degraded(&self) -> bool {
        self.degraded
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 可见目录全部进入 manifest（浅 → 深），`.git` 与 ignored 子树被剪枝且
    /// ignored 根被单独收集。
    #[test]
    fn manifest_includes_visible_dirs_and_collects_ignored_roots() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("src/deep")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::create_dir_all(root.join(".git/objects")).unwrap();
        std::fs::write(root.join(".gitignore"), "node_modules/\n").unwrap();

        let filter = GitIgnoreFilter::new(root.to_path_buf());
        let manifest = WatchManifest::compute(root, Some(&filter), 100);

        let names: Vec<String> = manifest
            .visible_dirs()
            .iter()
            .map(|p| {
                p.strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect();
        assert!(names.contains(&String::new()), "根目录必须进入清单");
        assert!(names.contains(&"src".to_string()) && names.contains(&"src/deep".to_string()));
        assert!(
            !names.iter().any(|n| n.contains("node_modules")),
            "ignored 子树不进入可见清单"
        );
        assert!(!names.iter().any(|n| n.contains(".git")), ".git 不进入清单");

        // ignored 根被收集（W2 的物理排除输入），顶层 ignored 子树的内部不入列
        let ignored: Vec<PathBuf> = manifest.ignored_roots().to_vec();
        assert_eq!(
            ignored,
            vec![root.join("node_modules")],
            "仅顶层 ignored 根"
        );
        assert_eq!(manifest.root(), root);
        assert!(!manifest.is_degraded());
    }

    /// 无 filter（非 git 项目）：所有目录可见（仅 `.git` 硬排除），无 ignored 根。
    #[test]
    fn manifest_without_filter_includes_all_but_git() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("a/b")).unwrap();
        std::fs::create_dir_all(root.join(".git/x")).unwrap();

        let manifest = WatchManifest::compute(root, None, 100);
        assert_eq!(
            manifest.visible_dirs().len(),
            3,
            "根 + a + a/b（.git 排除）"
        );
        assert!(manifest.ignored_roots().is_empty());
        assert!(!manifest.is_degraded());
    }

    /// 触顶截断：可见目录数达上限即截止并置 `degraded`（调用方据此降级整树）。
    #[test]
    fn manifest_marks_degraded_at_cap() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        for i in 0..20 {
            std::fs::create_dir_all(root.join(format!("d{i}"))).unwrap();
        }
        let manifest = WatchManifest::compute(root, None, 5);
        assert_eq!(manifest.visible_dirs().len(), 5);
        assert!(manifest.is_degraded());
    }
}
