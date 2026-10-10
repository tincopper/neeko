//! git 语义忽略过滤器（`.gitignore` / `.git/info/exclude` + 平台硬过滤）。

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use ignore::WalkBuilder;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};

/// 平台/元数据硬噪声路径：不属于项目内容，任何场景都不应进入前端。
///
/// 这里与 Git 语义过滤分开建模：文件树仍需展示 ignored 灰色节点，但 `.git`
/// 与 `.DS_Store` 永远不是项目内容。
pub(super) fn is_hard_noise_path(path: &Path) -> bool {
    path.components().any(|component| {
        matches!(
            component,
            std::path::Component::Normal(name) if name == ".git" || name == ".DS_Store"
        )
    })
}

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
pub struct GitIgnoreFilter {
    root: PathBuf,
    /// 浅 → 深排序的规则层（根层恒为第 0 层）
    levels: Arc<RwLock<Vec<DirRules>>>,
    /// 用户级排除模式（D2）：root 锚定、gitignore 方言（支持 `**`）。空 = 与 `new` 等价。
    user_exclude_patterns: Vec<String>,
    /// 由 `user_exclude_patterns` 编译的 root 锚定 matcher（判定最先查）。
    user_excludes: Arc<RwLock<Gitignore>>,
}

impl GitIgnoreFilter {
    /// 构建并立即加载仓库根的分层忽略规则（含嵌套子包与 info/exclude），
    /// **不含任何用户级排除** —— 纯 gitignore 语义 / 测试专用。
    #[must_use]
    pub fn new(root: PathBuf) -> Self {
        Self::with_user_excludes(root, &[])
    }

    /// 构建过滤器并附加用户级 `watcherExclude` 模式（D2，VS Code `files.watcherExclude` 式）。
    ///
    /// `patterns` 为 root 锚定的 gitignore 方言 glob（支持 `**`）；空切片 = 纯 gitignore，
    /// 行为与 [`Self::new`] 逐字等价。用户排除**并入唯一忽略判定**，因此注册层
    /// （`WatchManifest::compute` → `should_ignore_own`）、事件分类（`should_ignore`）与读层
    /// 剪枝三处一致生效 —— 不再各自为政。
    #[must_use]
    pub fn with_user_excludes(root: PathBuf, patterns: &[String]) -> Self {
        let filter = Self {
            user_excludes: Arc::new(RwLock::new(build_user_excludes(&root, patterns))),
            user_exclude_patterns: patterns.to_vec(),
            root,
            levels: Arc::new(RwLock::new(Vec::new())),
        };
        filter.reload();
        filter
    }

    /// 过滤器根是否与给定根一致。
    ///
    /// 读层复用判断：watcher 共享过滤器根固定在主项目路径；当读取根是 linked
    /// worktree（主仓库之外）时根不匹配，必须现场构建以读取根为根的过滤器——
    /// 否则 `is_ignored_with` 的 `path.starts_with(level.dir)` 对 worktree 路径
    /// 永不命中，worktree 内 ignored 标注恒缺。
    #[must_use]
    pub fn same_root(&self, root: &Path) -> bool {
        self.root == root
    }
}

/// 解析仓库根的 `.git/info/exclude` 路径。
///
/// linked worktree 的 `.git` 是指针文件（内容形如 `gitdir: <主仓库>/.git/worktrees/<name>`），
/// 其 info/exclude 实际共享主仓库 `.git/info/exclude`；普通仓库为自身 `.git/info/exclude`。
/// 指针解析失败时回退到本地路径（`is_file()` 判定自然 miss，不加载）。
pub(super) fn resolve_info_exclude(root: &Path) -> PathBuf {
    let git = root.join(".git");
    if git.is_file() {
        if let Ok(content) = std::fs::read_to_string(&git) {
            for line in content.lines() {
                if let Some(path) = line.strip_prefix("gitdir: ") {
                    let gitdir = Path::new(path.trim());
                    // gitdir = <主仓库>/.git/worktrees/<name> → exclude 在 <主仓库>/.git/info
                    if let Some(worktrees) = gitdir.parent() {
                        if let Some(main_git) = worktrees.parent() {
                            return main_git.join("info").join("exclude");
                        }
                    }
                    break;
                }
            }
        }
    }
    git.join("info").join("exclude")
}

/// 编译用户级排除 matcher：`root` 锚定、gitignore 方言（支持 `**`）。
///
/// 不做任何语言/目录名硬编码 —— 模式全部来自用户配置，未配置时为空 matcher
/// （判定恒 `None`），行为与纯 gitignore 完全一致。模式由组合根从配置域读取后注入
/// （见 `session::StorageManager::watcher_excludes`），本模块不感知配置文件路径。
fn build_user_excludes(root: &Path, patterns: &[String]) -> Gitignore {
    let mut builder = GitignoreBuilder::new(root);
    for pattern in patterns {
        if let Err(err) = builder.add_line(None, pattern) {
            log::warn!("[GitIgnoreFilter] invalid watcherExclude pattern {pattern:?}: {err}");
        }
    }
    builder.build().unwrap_or_else(|_| Gitignore::empty())
}

impl GitIgnoreFilter {
    /// 重载忽略规则：分层收集全仓 `.gitignore`（含 monorepo 子包），按目录
    /// 各自编译，`.git/info/exclude` 并入根层且排在根 `.gitignore` 之后
    /// （git 语义：本地排除规则覆盖 .gitignore）。`.gitignore` 文件变更
    /// （任意层级）时由 notify 回调触发。用户排除层随构造固化、在此一并重建
    /// （config 变更走「下次过滤重建」生效）。
    pub fn reload(&self) {
        // 用户排除层重建：模式集不可变（config 变更 ⇒ 新过滤器），此处仅保持与
        // `levels` 同一生命周期。
        if let Ok(mut guard) = self.user_excludes.write() {
            *guard = build_user_excludes(&self.root, &self.user_exclude_patterns);
        }
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
        // .git/info/exclude 并入根层（无根 .gitignore 也要建根层承载它）。
        // linked worktree 经 gitdir 指针解析共享主仓库 exclude。
        let info_exclude = resolve_info_exclude(&self.root);
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

    /// 路径自身是否命中忽略规则（不含祖先上行）。
    ///
    /// 读目录层专用（S5）：读前剪枝保证「不会访问被忽略目录的后代」，节点自身的
    /// 命中即完整判定；若沿用 `should_ignore` 的祖先上行，展开一个被忽略目录时
    /// 其子节点会因父链命中而被整体标记/剪枝，破坏「展开可见内容」的穿透语义。
    /// watcher 事件过滤仍用 `should_ignore`（FSEvents 等递归后端会送达被忽略
    /// 目录深处的事件，需要父链判定）。
    #[must_use]
    pub fn should_ignore_own(&self, path: &Path, is_dir: bool) -> bool {
        self.is_ignored_with(path, false, is_dir)
    }

    /// 路径是否应被忽略（git 分层语义 + 平台硬过滤，含祖先上行 —— watcher 事件用）。
    /// `is_dir` 由调用方传入时避免热路径内额外 stat；不确定时传 `None` 触发 stat。
    #[must_use]
    pub fn should_ignore(&self, path: &Path, is_dir: Option<bool>) -> bool {
        let is_dir = is_dir.unwrap_or_else(|| path.is_dir());
        self.is_ignored_with(path, true, is_dir)
    }

    /// 两个公开判定的共用实现（单一判定核心：硬过滤 → 分层裁定，深层优先）。
    /// `with_parents` 决定单层匹配是否含祖先上行
    /// （`matched_path_or_any_parents` vs `matched`）。
    fn is_ignored_with(&self, path: &Path, with_parents: bool, is_dir: bool) -> bool {
        if is_hard_noise_path(path) {
            return true;
        }
        // 用户级排除（D2）：唯一忽略判定的最先一层，纯「额外忽略」但允许 `!` 显式放行。
        // root 守卫：`matched_path_or_any_parents` 对根外路径会 panic，且用户排除本就只
        // 针对该单元根锚定。
        if path.starts_with(&self.root) {
            if let Ok(user) = self.user_excludes.read() {
                let verdict = if with_parents {
                    user.matched_path_or_any_parents(path, is_dir)
                } else {
                    user.matched(path, is_dir)
                };
                match verdict {
                    ignore::Match::Ignore(_) => return true,
                    ignore::Match::Whitelist(_) => return false,
                    ignore::Match::None => {}
                }
            }
        }
        let Ok(levels) = self.levels.read() else {
            return false;
        };
        // 深层 → 浅层：首个给出裁定（Ignore/Whitelist）的层获胜
        for level in levels.iter().rev() {
            if !path.starts_with(&level.dir) {
                continue;
            }
            let verdict = if with_parents {
                level.gitignore.matched_path_or_any_parents(path, is_dir)
            } else {
                level.gitignore.matched(path, is_dir)
            };
            match verdict {
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
        assert!(filter.should_ignore(&base.join("dist").join("foo.js"), None));
        assert!(filter.should_ignore(&base.join("build").join("index.html"), None));
        assert!(filter.should_ignore(&base.join(".next").join("cache.json"), None));
        assert!(filter.should_ignore(&base.join("out").join("bundle.js"), None));
        assert!(filter.should_ignore(&base.join("coverage").join("lcov.info"), None));

        // 非忽略的兄弟路径仍应通过
        assert!(!filter.should_ignore(&base.join("src").join("main.rs"), None));
    }

    /// 平台硬过滤：.git / .DS_Store 无论 .gitignore 内容如何都必须忽略。
    #[test]
    fn git_ignore_filter_always_ignores_git_meta_and_ds_store() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        let filter = GitIgnoreFilter::new(base.to_path_buf());

        assert!(filter.should_ignore(&base.join(".git").join("HEAD"), None));
        assert!(filter.should_ignore(&base.join(".DS_Store"), None));
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
            filter.should_ignore(&app.join("dist").join("bundle.js"), None),
            "packages/app/.gitignore 的 dist/ 规则应生效"
        );
        assert!(
            filter.should_ignore(&lib.join("coverage").join("lcov.info"), None),
            "packages/lib/.gitignore 的 coverage/ 规则应生效"
        );
        // 子包规则不得泄漏到兄弟包
        assert!(!filter.should_ignore(&lib.join("dist").join("x.js"), None));
        // 根规则不受影响
        assert!(filter.should_ignore(&base.join("target").join("x.rs"), None));
        // 未忽略路径仍通过
        assert!(!filter.should_ignore(&app.join("src").join("main.rs"), None));
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
            !filter.should_ignore(&app.join("keep.log"), None),
            "子包否定规则应覆盖根规则"
        );
        assert!(filter.should_ignore(&app.join("other.log"), None));
        assert!(filter.should_ignore(&base.join("root.log"), None));
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
        assert!(!filter.should_ignore(&base.join("build").join("x.js"), None));
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
        assert!(!filter.should_ignore(&base.join("dist").join("app.ts"), None));
        assert!(!filter.should_ignore(&base.join("out").join("main.go"), None));
        assert!(!filter.should_ignore(&base.join("build").join("CMakeLists.txt"), None));
        // node_modules / target 同样只在 .gitignore 声明时忽略
        assert!(!filter.should_ignore(&base.join("node_modules").join("react"), None));
        assert!(!filter.should_ignore(&base.join("target").join("debug"), None));
    }

    /// 用户编辑 .gitignore 后 reload 立即生效。
    #[test]
    fn git_ignore_filter_reloads_after_gitignore_change() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        std::fs::write(base.join(".gitignore"), "").unwrap();
        let filter = GitIgnoreFilter::new(base.to_path_buf());
        assert!(!filter.should_ignore(&base.join("dist").join("foo.js"), None));

        // 模拟用户向 .gitignore 追加 dist/ 规则
        std::fs::write(base.join(".gitignore"), "dist/\n").unwrap();
        filter.reload();
        assert!(filter.should_ignore(&base.join("dist").join("foo.js"), None));
    }

    /// 普通仓库：info/exclude 解析到自身 `.git/info/exclude`。
    #[test]
    fn resolve_info_exclude_points_to_local_git_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        assert_eq!(
            resolve_info_exclude(base),
            base.join(".git").join("info").join("exclude"),
            "普通仓库应解析到自身 exclude"
        );
    }

    /// linked worktree：`.git` 是指针文件（`gitdir: <主仓库>/.git/worktrees/<name>`），
    /// info/exclude 实际共享主仓库 `.git/info/exclude` —— 否则 worktree 过滤器的
    /// exclude 规则缺失。
    #[test]
    fn resolve_info_exclude_follows_worktree_gitdir_pointer() {
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("main");
        let main_git = main.join(".git");
        std::fs::create_dir_all(main_git.join("info")).unwrap();
        std::fs::write(main_git.join("info/exclude"), "*.tmp\n").unwrap();
        // worktree .git 是指针文件
        let wt = tmp.path().join("wt");
        std::fs::create_dir_all(&wt).unwrap();
        let gitdir = main_git.join("worktrees").join("dev");
        std::fs::create_dir_all(&gitdir).unwrap();
        std::fs::write(wt.join(".git"), format!("gitdir: {}\n", gitdir.display())).unwrap();

        assert_eq!(
            resolve_info_exclude(&wt),
            main_git.join("info").join("exclude"),
            "worktree 应解析到主仓库 exclude"
        );

        // 过滤器应真正加载主仓库 exclude 规则并命中
        let filter = GitIgnoreFilter::new(wt.clone());
        assert!(
            filter.should_ignore_own(&wt.join("cache.tmp"), false),
            "worktree 过滤器必须命中主仓库 exclude 规则"
        );
    }

    /// 用户级排除（D2）：命中子树内部路径在两条判定路径（own / with_parents）都为真。
    #[test]
    fn user_excludes_ignore_matching_subtree() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        std::fs::create_dir_all(base.join("target").join("debug")).unwrap();
        std::fs::create_dir_all(base.join("src")).unwrap();

        let filter = GitIgnoreFilter::with_user_excludes(base.to_path_buf(), &["target/".into()]);

        // 注册层剪枝判定（should_ignore_own）：ignored 根目录自身即命中
        assert!(filter.should_ignore_own(&base.join("target"), true));
        // 事件过滤判定（should_ignore，含祖先上行）：内部文件命中
        assert!(filter.should_ignore(&base.join("target/debug/foo.o"), None));
        // 未命中路径不受影响
        assert!(!filter.should_ignore_own(&base.join("src/main.rs"), false));
        assert!(!filter.should_ignore(&base.join("src/main.rs"), None));
    }

    /// 用户排除支持 gitignore 方言 `**`：嵌套任意深度的目标子树命中。
    #[test]
    fn user_excludes_support_double_star_glob() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        std::fs::create_dir_all(base.join("packages/app/node_modules/react")).unwrap();
        std::fs::create_dir_all(base.join("packages/app/src")).unwrap();

        let filter =
            GitIgnoreFilter::with_user_excludes(base.to_path_buf(), &["**/node_modules/**".into()]);

        assert!(filter.should_ignore(&base.join("packages/app/node_modules/react/index.js"), None));
        assert!(!filter.should_ignore(&base.join("packages/app/src/index.ts"), None));
    }

    /// 默认空模式集 == `new`：不引入任何硬编码目录名黑名单，真实源码目录不得被误伤。
    #[test]
    fn user_excludes_default_behaves_like_new() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        std::fs::write(base.join(".gitignore"), "").unwrap();

        let filter = GitIgnoreFilter::with_user_excludes(base.to_path_buf(), &[]);
        assert!(!filter.should_ignore(&base.join("target/debug/x.o"), None));
        assert!(!filter.should_ignore(&base.join("node_modules/react"), None));
        assert!(!filter.should_ignore(&base.join("dist/app.js"), None));
    }

    /// 用户排除与 gitignore 迭加：两者命中的子树都忽略，硬噪声恒忽略，未命中不受影响。
    #[test]
    fn user_excludes_combine_with_gitignore_and_hard_noise() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        std::fs::write(base.join(".gitignore"), "dist/\n").unwrap();
        std::fs::create_dir_all(base.join("target")).unwrap();

        let filter = GitIgnoreFilter::with_user_excludes(base.to_path_buf(), &["target/".into()]);

        assert!(filter.should_ignore(&base.join("dist/app.js"), None));
        assert!(filter.should_ignore(&base.join("target/debug/x.o"), None));
        assert!(filter.should_ignore(&base.join(".git/HEAD"), None));
        assert!(!filter.should_ignore(&base.join("src/main.rs"), None));
    }

    /// 负向 `!` 模式在用户层显式放行：白名单命中的路径在两条判定下都不忽略。
    #[test]
    fn user_exclude_negation_whitelists_path() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        std::fs::create_dir_all(base.join("target")).unwrap();

        let filter = GitIgnoreFilter::with_user_excludes(
            base.to_path_buf(),
            &["target/".into(), "!target/keep".into()],
        );

        // 目录自身仍被忽略，其余内容仍被忽略
        assert!(filter.should_ignore_own(&base.join("target"), true));
        assert!(filter.should_ignore(&base.join("target/other.tmp"), None));
        // 显式放行者不被忽略
        assert!(!filter.should_ignore(&base.join("target/keep"), None));
    }

    /// reload（.gitignore 变更）后用户排除仍然生效（同一过滤器实例内不丢失）。
    #[test]
    fn user_excludes_survive_reload() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        std::fs::write(base.join(".gitignore"), "").unwrap();
        std::fs::create_dir_all(base.join("target")).unwrap();

        let filter = GitIgnoreFilter::with_user_excludes(base.to_path_buf(), &["target/".into()]);
        assert!(filter.should_ignore(&base.join("target/x.o"), None));

        std::fs::write(base.join(".gitignore"), "dist/\n").unwrap();
        filter.reload();

        assert!(filter.should_ignore(&base.join("target/x.o"), None));
        assert!(filter.should_ignore(&base.join("dist/app.js"), None));
    }

    // `watcherExclude` 纯解析已随配置域收敛到 `session::manager`（见其单测）。
}
