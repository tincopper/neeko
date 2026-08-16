//! git 语义忽略过滤器（`.gitignore` / `.git/info/exclude` + 平台硬过滤）。

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};

/// 判断路径是否应该被忽略。
///
/// 第一性原理：与 git 自身行为一致 —— 被 `.gitignore`（含 `.git/info/exclude`）
/// 忽略的路径不产生事件，同时保留两类硬过滤：
/// - `.git` 元数据目录（git 内部文件，HEAD watcher 单独绕过此过滤监听分支切换）
/// - `.DS_Store`（macOS 平台噪声，不属于项目内容）
///
/// 规则在 watcher 启动时编译，`.gitignore` 文件变更时自动重载（见 `reload`）。
#[derive(Clone)]
pub(super) struct GitIgnoreFilter {
    root: PathBuf,
    rules: Arc<RwLock<Gitignore>>,
}

impl GitIgnoreFilter {
    pub(super) fn new(root: PathBuf) -> Self {
        let rules = Arc::new(RwLock::new(Gitignore::empty()));
        let filter = Self { root, rules };
        filter.reload();
        filter
    }

    /// 重载忽略规则：读取项目根 `.gitignore` 与 `.git/info/exclude`。
    /// `.gitignore` 自身变更（用户编辑）时由 notify 回调触发。
    pub(super) fn reload(&self) {
        let mut builder = GitignoreBuilder::new(&self.root);
        // 项目根 .gitignore
        let root_gitignore = self.root.join(".gitignore");
        if root_gitignore.is_file() {
            let _ = builder.add(&root_gitignore);
        }
        // .git/info/exclude（仓库本地忽略规则）
        let info_exclude = self.root.join(".git").join("info").join("exclude");
        if info_exclude.is_file() {
            let _ = builder.add(&info_exclude);
        }
        let built = builder.build().unwrap_or_else(|_| Gitignore::empty());
        if let Ok(mut rules) = self.rules.write() {
            *rules = built;
        }
    }

    /// 路径是否应被忽略（git 语义 + 平台硬过滤）
    pub(super) fn should_ignore(&self, path: &Path) -> bool {
        if path.components().any(
            |c| matches!(c, std::path::Component::Normal(n) if n == ".git" || n == ".DS_Store"),
        ) {
            return true;
        }
        let is_dir = path.is_dir();
        let matched = self
            .rules
            .read()
            .map(|rules| rules.matched_path_or_any_parents(path, is_dir).is_ignore())
            .unwrap_or(false);
        matched
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构建产物目录（dist / build / .next / out / coverage）在 .gitignore 中时
    /// 应被忽略——过滤语义与 git 自身一致，而不是硬编码目录名黑名单。
    #[test]
    fn git_ignore_filter_filters_gitignored_build_output_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        std::fs::write(
            base.join(".gitignore"),
            "dist/\nbuild/\n.next/\nout/\ncoverage/\n",
        )
        .unwrap();

        let filter = GitIgnoreFilter::new(base.to_path_buf());
        assert!(filter.should_ignore(&base.join("dist").join("foo.js")));
        assert!(filter.should_ignore(&base.join("build").join("index.html")));
        assert!(filter.should_ignore(&base.join(".next").join("cache.json")));
        assert!(filter.should_ignore(&base.join("out").join("bundle.js")));
        assert!(filter.should_ignore(&base.join("coverage").join("lcov.info")));

        // 非忽略的兄弟路径仍应通过
        assert!(!filter.should_ignore(&base.join("src").join("main.rs")));
    }

    /// 平台硬过滤：.git / .DS_Store 无论 .gitignore 内容如何都必须忽略。
    #[test]
    fn git_ignore_filter_always_ignores_git_meta_and_ds_store() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        let filter = GitIgnoreFilter::new(base.to_path_buf());

        assert!(filter.should_ignore(&base.join(".git").join("HEAD")));
        assert!(filter.should_ignore(&base.join(".DS_Store")));
    }

    /// 根因修复：名为 dist / out / build 的真实源码目录（未被 .gitignore 忽略）
    /// 不应再被硬编码黑名单误伤——git 语义过滤让它们正常产生事件。
    #[test]
    fn git_ignore_filter_does_not_hide_non_ignored_source_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        // .gitignore 为空：没有任何忽略规则
        std::fs::write(base.join(".gitignore"), "").unwrap();

        let filter = GitIgnoreFilter::new(base.to_path_buf());
        // 这些目录名过去被硬编码黑名单误过滤，现在按 git 语义不应被忽略
        assert!(!filter.should_ignore(&base.join("dist").join("app.ts")));
        assert!(!filter.should_ignore(&base.join("out").join("main.go")));
        assert!(!filter.should_ignore(&base.join("build").join("CMakeLists.txt")));
        // node_modules / target 同样只在 .gitignore 声明时忽略
        assert!(!filter.should_ignore(&base.join("node_modules").join("react")));
        assert!(!filter.should_ignore(&base.join("target").join("debug")));
    }

    /// 用户编辑 .gitignore 后 reload 立即生效。
    #[test]
    fn git_ignore_filter_reloads_after_gitignore_change() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        std::fs::write(base.join(".gitignore"), "").unwrap();
        let filter = GitIgnoreFilter::new(base.to_path_buf());
        assert!(!filter.should_ignore(&base.join("dist").join("foo.js")));

        // 模拟用户向 .gitignore 追加 dist/ 规则
        std::fs::write(base.join(".gitignore"), "dist/\n").unwrap();
        filter.reload();
        assert!(filter.should_ignore(&base.join("dist").join("foo.js")));
    }
}
