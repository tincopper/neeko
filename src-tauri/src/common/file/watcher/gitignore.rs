//! git 语义忽略过滤器（`.gitignore` / `.git/info/exclude` + 平台硬过滤）。

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use ignore::WalkBuilder;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};

/// 分层加载的 .gitignore 文件数上限（公理：随仓库规模增长的结构必须有界；
/// 正常仓库远低于此值，超限多为异常嵌套，截断仅损失事件过滤精度、不损失正确性）。
const MAX_GITIGNORE_FILES: usize = 100;

/// 单目录层级的规则集：`dir` 下的 `.gitignore`（根层还并入 `.git/info/exclude`）
/// 编译成的独立匹配器。`Gitignore` 的 glob 不感知来源目录（`from` 字段只有
/// WalkBuilder 的分层栈会消费），必须按目录分 matcher 才能把
/// `packages/app/.gitignore` 的 `dist/` 限定在其子树内。
struct DirRules {
    /// 该层 .gitignore 所在目录（绝对路径，含仓库根）
    dir: PathBuf,
    gitignore: Gitignore,
}

/// 判断路径是否应该被忽略。
///
/// 第一性原理：与 git 自身行为一致 —— 被 `.gitignore`（含嵌套子包层级与
/// `.git/info/exclude`）忽略的路径不产生事件，同时保留两类硬过滤：
/// - `.git` 元数据目录（git 内部文件，HEAD watcher 单独绕过此过滤监听分支切换）
/// - `.DS_Store`（macOS 平台噪声，不属于项目内容）
///
/// 匹配语义（git 分层规则）：**最深层的裁定优先** —— 路径先交由其祖先链中最深的
/// 规则层匹配，`Ignore` 即忽略、`Whitelist` 即放行（深层否定规则覆盖浅层忽略）、
/// `None` 再向浅层回退；同层内后一条规则覆盖前一条（单 matcher 内建语义）。
/// 规则在 watcher 启动时编译，任意层级的 `.gitignore` 变更时自动重载（见 `reload`）。
#[derive(Clone)]
pub(super) struct GitIgnoreFilter {
    root: PathBuf,
    /// 浅 → 深排序的规则层（根层恒为第 0 层）
    levels: Arc<RwLock<Vec<DirRules>>>,
}

impl GitIgnoreFilter {
    pub(super) fn new(root: PathBuf) -> Self {
        let filter = Self {
            root,
            levels: Arc::new(RwLock::new(Vec::new())),
        };
        filter.reload();
        filter
    }

    /// 重载忽略规则：分层收集全仓 `.gitignore`（含 monorepo 子包），按目录
    /// 各自编译，`.git/info/exclude` 并入根层且排在根 `.gitignore` 之后
    /// （git 语义：本地排除规则覆盖 .gitignore）。`.gitignore` 文件变更
    /// （任意层级）时由 notify 回调触发。
    pub(super) fn reload(&self) {
        // WalkBuilder 关闭 hidden 过滤（.gitignore 是隐藏文件），显式过滤 .git
        // 元数据目录；ignored 子树由其内置 gitignore 栈剪枝，遍历成本与可见树成正比
        let mut gitignore_files: Vec<PathBuf> = Vec::new();
        for entry in WalkBuilder::new(&self.root)
            .hidden(false)
            .filter_entry(|e| e.file_name() != ".git")
            .build()
            .flatten()
        {
            let is_gitignore =
                entry.file_type().is_some_and(|t| t.is_file()) && entry.file_name() == ".gitignore";
            if is_gitignore {
                gitignore_files.push(entry.into_path());
                if gitignore_files.len() >= MAX_GITIGNORE_FILES {
                    log::warn!(
                        "[GitIgnoreFilter] nested .gitignore files exceeded cap {} at {}",
                        MAX_GITIGNORE_FILES,
                        self.root.display()
                    );
                    break;
                }
            }
        }

        // 按目录分组：dir → 该目录的 .gitignore 列表（同目录多文件极罕见，保序）
        let mut groups: Vec<(PathBuf, Vec<PathBuf>)> = Vec::new();
        for file in gitignore_files {
            let dir = file.parent().unwrap_or(Path::new("")).to_path_buf();
            match groups.iter_mut().find(|(d, _)| *d == dir) {
                Some((_, files)) => files.push(file),
                None => groups.push((dir, vec![file])),
            }
        }
        // .git/info/exclude 并入根层（无根 .gitignore 也要建根层承载它）
        let info_exclude = self.root.join(".git").join("info").join("exclude");
        if info_exclude.is_file() {
            match groups.iter_mut().find(|(d, _)| *d == self.root) {
                Some((_, files)) => files.push(info_exclude),
                None => groups.push((self.root.clone(), vec![info_exclude])),
            }
        }

        // 每目录独立编译；按路径深度浅 → 深排序（深层的裁定优先）
        let mut levels: Vec<DirRules> = groups
            .into_iter()
            .map(|(dir, files)| {
                let mut builder = GitignoreBuilder::new(&dir);
                for file in &files {
                    // GitignoreBuilder::add 返回 Option<Error>（None = 成功）
                    if let Some(err) = builder.add(file) {
                        log::warn!("[GitIgnoreFilter] add {}: {}", file.display(), err);
                    }
                }
                DirRules {
                    dir,
                    gitignore: builder.build().unwrap_or_else(|_| Gitignore::empty()),
                }
            })
            .collect();
        levels.sort_by_key(|l| l.dir.components().count());

        if let Ok(mut guard) = self.levels.write() {
            *guard = levels;
        }
    }

    /// 路径是否应被忽略（git 分层语义 + 平台硬过滤）
    pub(super) fn should_ignore(&self, path: &Path) -> bool {
        if path.components().any(
            |c| matches!(c, std::path::Component::Normal(n) if n == ".git" || n == ".DS_Store"),
        ) {
            return true;
        }
        let is_dir = path.is_dir();
        let Ok(levels) = self.levels.read() else {
            return false;
        };
        // 深层 → 浅层：首个给出裁定（Ignore/Whitelist）的层获胜
        for level in levels.iter().rev() {
            if !path.starts_with(&level.dir) {
                continue;
            }
            match level.gitignore.matched_path_or_any_parents(path, is_dir) {
                ignore::Match::Ignore(_) => return true,
                ignore::Match::Whitelist(_) => return false,
                ignore::Match::None => {}
            }
        }
        false
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

    /// G5/P5：嵌套 .gitignore 分层加载——monorepo 子包规则必须生效。
    /// 读侧剪枝走 CLI `--ignored`（嵌套语义正确），此处治理的是 watcher
    /// 事件过滤层：子包 ignored 目录的事件不应洪峰进回调。
    #[test]
    fn git_ignore_filter_loads_nested_gitignore_rules() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        // 根规则只忽略 /target（锚定根，不覆盖子包 dist）
        std::fs::write(base.join(".gitignore"), "/target/\n").unwrap();
        let app = base.join("packages").join("app");
        let lib = base.join("packages").join("lib");
        std::fs::create_dir_all(&app).unwrap();
        std::fs::create_dir_all(&lib).unwrap();
        // 子包各自的 .gitignore
        std::fs::write(app.join(".gitignore"), "dist/\n").unwrap();
        std::fs::write(lib.join(".gitignore"), "coverage/\n").unwrap();

        let filter = GitIgnoreFilter::new(base.to_path_buf());

        // 子包规则生效
        assert!(
            filter.should_ignore(&app.join("dist").join("bundle.js")),
            "packages/app/.gitignore 的 dist/ 规则应生效"
        );
        assert!(
            filter.should_ignore(&lib.join("coverage").join("lcov.info")),
            "packages/lib/.gitignore 的 coverage/ 规则应生效"
        );
        // 子包规则不得泄漏到兄弟包
        assert!(!filter.should_ignore(&lib.join("dist").join("x.js")));
        // 根规则不受影响
        assert!(filter.should_ignore(&base.join("target").join("x.rs")));
        // 未忽略路径仍通过
        assert!(!filter.should_ignore(&app.join("src").join("main.rs")));
    }

    /// 深层规则覆盖浅层（git 语义：更深的 .gitignore 后加载、优先级更高），
    /// 含否定规则（!pattern）。
    #[test]
    fn git_ignore_filter_nested_rules_override_shallow() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        std::fs::write(base.join(".gitignore"), "*.log\n").unwrap();
        let app = base.join("packages").join("app");
        std::fs::create_dir_all(&app).unwrap();
        std::fs::write(app.join(".gitignore"), "!keep.log\n").unwrap();

        let filter = GitIgnoreFilter::new(base.to_path_buf());

        assert!(
            !filter.should_ignore(&app.join("keep.log")),
            "子包否定规则应覆盖根规则"
        );
        assert!(filter.should_ignore(&app.join("other.log")));
        assert!(filter.should_ignore(&base.join("root.log")));
    }

    /// .git/info/exclude 优先级高于 .gitignore（git 语义：后加载者胜），
    /// 重构加载顺序后不得回退。
    #[test]
    fn git_ignore_filter_info_exclude_overrides_gitignore() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        std::fs::write(base.join(".gitignore"), "build/\n").unwrap();
        let git_dir = base.join(".git").join("info");
        std::fs::create_dir_all(&git_dir).unwrap();
        std::fs::write(git_dir.join("exclude"), "!build/\n").unwrap();

        let filter = GitIgnoreFilter::new(base.to_path_buf());
        assert!(!filter.should_ignore(&base.join("build").join("x.js")));
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
