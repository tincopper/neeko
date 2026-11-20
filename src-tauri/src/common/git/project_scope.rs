//! 一个**项目**对路径的归属范围（主 checkout + 全部 linked worktree + 团队记录过的根）。
//!
//! # 与 [`crate::common::git::UnitScope`] 的分工
//!
//! | 类型 | 回答的问题 | 规则 |
//! | --- | --- | --- |
//! | `UnitScope` | 这条路径属于哪个**单元**（执行上下文） | 最深根胜出 |
//! | `ProjectScope` | 属不属于这个**项目** | 任一注册根包含即是 |
//!
//! History 面板要的是后者：「这个项目的历史」应当包含它所有工作区的会话，包括按设计落在
//! 项目目录**之外**的工作树（`~/.neeko/worktrees/<name>`）。用「单元」那套最深根规则会让
//! 主仓单元把工作树的会话排除掉 —— 那不是缺陷，是它回答的另一个问题。
//!
//! # 为什么需要这个类型（缺陷形态）
//!
//! History 的「这条会话属于哪个项目」曾经是**一个裸路径字符串的前缀匹配**
//! （`ConversationListScope::Project { path }`），而扫描（discovery）也被同一个字符串收窄。
//! 于是团队在 `~/.neeko/worktrees/<name>` 里跑出来的转录：路径编码的适配器**根本扫不到**
//! （编码目录不是项目根编码的 `prefix-` 扩展），非编码适配器扫到了也会被前缀判据滤掉。
//! 项目的**注册事实**（自己的 checkout + `git worktree list`）一直存在，缺的是把它当成
//! 「范围」来用。
//!
//! # 两个字段：发现期要原始串，归属期要身份串
//!
//! - [`ProjectScope::roots`] 是**登记时的原始字符串**：CLI 把 cwd 编码成目录名
//!   （`-Users-tomgs-RustroverProjects-neeko`），编码输入必须逐字等于进程 cwd —— 对
//!   `/var` ↔ `/private/var` 这类平台别名，canonicalize 会让编码名对不上。
//! - [`ProjectScope::identities`] 是**身份渲染**（[`PathAlphabet`]），与 `UnitScope` 同一
//!   字母表。会话 cwd 来自转录内容，两侧都过同一渲染才能比较（红线 12：不为路径→身份
//!   再发明一套字符串规则）。

use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::common::executor::factory::ExecTarget;
use crate::common::git::operations::worktree::list_linked_worktree_roots;
use crate::common::git::unit_scope::{deepest_root, PathAlphabet};
/// 一个**项目**对路径的归属范围（纯值对象，构造后无 IO）。
///
/// 生产构造只有 [`ProjectScope::resolve`]（注册事实的唯一读取点）；测试走
/// `for_test`。这样「拿任意字符串当项目根」不会成为生产代码的习惯。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectScope {
    /// 发现期（scan）用的**原始根**：CLI 目录编码的输入必须是登记时的字符串。
    roots: Vec<PathBuf>,
    /// 归属期（list / search）用的身份串（[`PathAlphabet`] 渲染）。
    identities: Vec<String>,
    /// 会话路径按哪套字母表渲染（跟随执行目标，不是宿主平台）。
    alphabet: PathAlphabet,
}

impl ProjectScope {
    /// 生产构造。`project_root` 是项目域的事实；`recorded` 是团队行记录过的工作区根
    /// （`team.workspace_worktree`，可能已被 git 忘掉但转录还在）。
    ///
    /// `git worktree list` 失败 ⇒ 只少 worktree 那一份 + `log::warn`，**不**降级成
    /// 「什么都收」：一个全收的范围会把别的项目的会话显示成本项目的，比少列几条难排查
    /// 得多（与 `UnitScope::resolve` 同方向：宁可漏，不可串）。
    ///
    /// # Errors
    /// 只在阻塞渲染任务无法调度时失败（渲染本身不会失败：身份是纯字符串结果）。
    pub async fn resolve(
        target: &ExecTarget,
        project_root: &Path,
        recorded: &[PathBuf],
    ) -> Result<Self> {
        let alphabet = PathAlphabet::for_target(target);
        let mut roots: Vec<PathBuf> = vec![project_root.to_path_buf()];

        match list_linked_worktree_roots(target, &project_root.to_string_lossy()).await {
            Ok(linked) => roots.extend(linked.into_iter().map(PathBuf::from)),
            Err(e) => {
                log::warn!(
                    "[git] worktree list unavailable for project `{}`, project scope covers the \
                     main checkout only: {e:#}",
                    project_root.display()
                );
            }
        }

        // 团队记录过的根：git 忘掉的工作树仍然拥有它自己的转录（历史不该因为一次
        // `git worktree remove` 就消失）。
        roots.extend(recorded.iter().cloned());

        // 身份渲染要 `canonicalize`（阻塞 fs）⇒ 一次阻塞池任务把整批根算完（红线 3）。
        let (roots, identities) =
            tokio::task::spawn_blocking(move || collect_identities(roots, alphabet, true))
                .await
                .map_err(|e| anyhow::anyhow!("rendering the project scope failed: {e}"))?;

        Ok(Self {
            roots,
            identities,
            alphabet,
        })
    }

    /// 会话 cwd 是否属于本项目：`None` / 空 / 空白 ⇒ `false`（fail-closed）。
    ///
    /// 判据是**任一注册根包含它**（分量边界，`/proj` 不含 `/proj-other`）。规则体只有一份：
    /// [`deepest_root`]（`UnitScope` 用的同一个函数），这里只把「最深等于本根」放宽成
    /// 「任意根命中」。
    #[must_use]
    pub fn owns(&self, session_cwd: Option<&str>) -> bool {
        let Some(raw) = session_cwd.map(str::trim).filter(|s| !s.is_empty()) else {
            return false;
        };
        let session = self.alphabet.render(raw);
        deepest_root(self.identities.iter().map(String::as_str), &session).is_some()
    }

    /// 发现期根清单（编码用，原始形态）。
    #[must_use]
    pub fn roots(&self) -> &[PathBuf] {
        &self.roots
    }

    /// 测试构造：把给定字符串当作**已注册**的根（生产只有 [`Self::resolve`]）。
    #[cfg(test)]
    pub(crate) fn for_test(roots: &[&str]) -> Self {
        let alphabet = PathAlphabet::Host;
        // `canonicalize = false`：夹具路径多数**不存在**（`/projects/alpha`），也没有 fs。
        let (roots, identities) =
            collect_identities(roots.iter().map(PathBuf::from).collect(), alphabet, false);
        Self {
            roots,
            identities,
            alphabet,
        }
    }
}

/// 原始根 → (去重后的原始根, 身份串集合)。
///
/// 去重按**身份**而不是按 `PathBuf`：项目根与团队记录很可能是同一个目录的两种写法
/// （带尾分隔符 / 不带）。保留首次出现 = 优先项目域的登记形态（发现期要用它编码）。
///
/// `canonicalize = true` 时每个根还额外收一份 canonical 形态的身份：会话 cwd 由各 CLI
/// 自己记录，而 macOS 的 `/var` ↔ `/private/var`、用户家目录的符号链接会让「同一个目录」
/// 有两种字符串写法。两侧都按同一字母表渲染、且**两种形态都算本项目的根**，归属就不会
/// 因为一次 canonicalize 在一侧生效而在另一侧失效。代价只在构造期付一次（不在每个会话上
/// 做 fs）—— 它因此必须在阻塞池里调（红线 3）。
fn collect_identities(
    roots: Vec<PathBuf>,
    alphabet: PathAlphabet,
    canonicalize: bool,
) -> (Vec<PathBuf>, Vec<String>) {
    let mut kept: Vec<PathBuf> = Vec::with_capacity(roots.len());
    let mut identities: Vec<String> = Vec::with_capacity(roots.len());
    for root in roots {
        let mut candidates = vec![alphabet.render(&root.to_string_lossy())];
        if canonicalize {
            if let Ok(canonical) = std::fs::canonicalize(&root) {
                let rendered = alphabet.render(&canonical.to_string_lossy());
                if !candidates.contains(&rendered) {
                    candidates.push(rendered);
                }
            }
        }
        if candidates.iter().any(|c| identities.contains(c)) {
            continue;
        }
        identities.extend(candidates);
        kept.push(root);
    }
    (kept, identities)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    /// 跑一条 git 命令（夹具）：与 `common/git/local/worktree.rs` 的测试辅助同形。
    ///
    /// 测试代码不受红线 1 约束（`check_command_execution` 的 `in_test_block` 豁免），
    /// 而 `git2` 没有创建 worktree 的 API —— 夹具只能走 CLI。
    fn git_in(dir: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .expect("git must be installed");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    /// 真实 linked worktree 夹具：主仓（1 次提交）+ `git worktree add` 的第二工作树。
    ///
    /// 路径全部由 `tempdir()` 推导（红线 13）。
    fn repo_with_worktree(tmp: &Path) -> (PathBuf, PathBuf) {
        let main = tmp.join("repo");
        std::fs::create_dir_all(&main).expect("create main repo dir");
        git_in(&main, &["init"]);
        git_in(&main, &["config", "user.email", "test@test.com"]);
        git_in(&main, &["config", "user.name", "Test"]);
        std::fs::write(main.join("README.md"), "# Test\n").expect("write README");
        git_in(&main, &["add", "."]);
        git_in(&main, &["commit", "-m", "init"]);

        let worktree = tmp.join("repo-wt");
        git_in(
            &main,
            &[
                "worktree",
                "add",
                "-b",
                "feature",
                &worktree.to_string_lossy(),
            ],
        );
        (main, worktree)
    }

    /// 项目的**每一个**工作区都属于这个项目：主 checkout 与外部工作树各在自己的根下。
    ///
    /// 夹具刻意用**原始** tempdir 路径当项目根（= 用户在登记表里的写法），而会话 cwd 用
    /// **canonical** 形态（= CLI 进程实际的 cwd）：平台别名（macOS `/var` ↔ `/private/var`）
    /// 让两者字符串不同，归属必须仍然成立。
    #[tokio::test]
    async fn the_project_root_and_every_linked_worktree_belong_to_the_project() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (main, worktree) = repo_with_worktree(tmp.path());
        let canonical = |p: &Path| {
            std::fs::canonicalize(p)
                .expect("canonical")
                .to_string_lossy()
                .to_string()
        };

        let scope = ProjectScope::resolve(&ExecTarget::Local, &main, &[])
            .await
            .expect("resolve");

        assert!(scope.owns(Some(&canonical(&main))), "项目根本身");
        assert!(
            scope.owns(Some(&format!("{}/src", canonical(&main)))),
            "项目根的后代"
        );
        assert!(
            scope.owns(Some(&canonical(&worktree))),
            "外部工作树的工作区根（`~/.neeko/worktrees/<name>` 的形态）"
        );
        assert!(
            scope.owns(Some(&format!("{}/crates", canonical(&worktree)))),
            "工作树的后代"
        );
        assert_eq!(scope.roots().len(), 2, "项目根 + 一个 linked worktree");
        assert_eq!(
            scope.roots()[0],
            main,
            "第一个根是项目域的登记形态（发现期要用它编码）"
        );
    }

    /// 同级的另一个项目目录**不属于**本项目（分量边界，不是字符串前缀）。
    #[tokio::test]
    async fn a_sibling_projects_directory_does_not_belong() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let main = tmp.path().join("proj");
        std::fs::create_dir_all(&main).expect("mkdir");
        let sibling = tmp.path().join("proj-other");
        std::fs::create_dir_all(&sibling).expect("mkdir sibling");

        // 不是 git 仓库 ⇒ worktree list 失败，只覆盖项目根（降级方向必须仍然是一次拒绝）。
        let scope = ProjectScope::resolve(&ExecTarget::Local, &main, &[])
            .await
            .expect("resolve");

        assert!(scope.owns(Some(&main.to_string_lossy())));
        assert!(
            !scope.owns(Some(&sibling.to_string_lossy())),
            "`proj-other` 不是 `proj` 的后代"
        );
        assert!(!scope.owns(Some(&sibling.join("src").to_string_lossy())));
    }

    /// git 忘掉的工作树仍然归属本项目：团队记录过它的根，而转录还在。
    #[tokio::test]
    async fn a_recorded_root_that_git_forgot_still_belongs() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (main, worktree) = repo_with_worktree(tmp.path());
        // 会话 cwd 是进程的实际 cwd（canonical 形态，见上一个用例的说明）。
        let cwd = std::fs::canonicalize(&worktree)
            .expect("canonical")
            .to_string_lossy()
            .to_string();

        // 前提：没有记录时它靠 `git worktree list` 归属。
        let before = ProjectScope::resolve(&ExecTarget::Local, &main, &[])
            .await
            .expect("resolve");
        assert!(before.owns(Some(&cwd)));

        // git 忘掉它（`git worktree remove` 会连目录一起删）—— 之后把目录建回来：
        // 会话转录里的 cwd 仍然指向它，而 git 已经不认识它了。
        git_in(&main, &["worktree", "remove", &worktree.to_string_lossy()]);
        git_in(&main, &["worktree", "prune"]);
        std::fs::create_dir_all(&worktree).expect("recreate worktree dir");

        let after = ProjectScope::resolve(&ExecTarget::Local, &main, &[])
            .await
            .expect("resolve");
        assert!(
            !after.owns(Some(&cwd)),
            "前提：git 已经不认识它了（否则本用例证明不了 `recorded` 的作用）"
        );

        let recorded =
            ProjectScope::resolve(&ExecTarget::Local, &main, std::slice::from_ref(&worktree))
                .await
                .expect("resolve");
        assert!(recorded.owns(Some(&cwd)), "团队记录过的根仍属于本项目");
        assert!(
            recorded.owns(Some(&format!("{cwd}/src"))),
            "记录过的根的后代同样归属"
        );
    }

    /// 缺 cwd / 空串 / 空白一律不属于任何项目（fail-closed）。
    #[tokio::test]
    async fn a_missing_or_empty_cwd_belongs_to_nothing() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let main = tmp.path().join("proj");
        std::fs::create_dir_all(&main).expect("mkdir");
        let scope = ProjectScope::resolve(&ExecTarget::Local, &main, &[])
            .await
            .expect("resolve");

        assert!(!scope.owns(None));
        assert!(!scope.owns(Some("")));
        assert!(!scope.owns(Some("   ")));
    }

    /// 发现期根清单是**登记时的原始串**：不经 canonicalize。
    ///
    /// 判据是一条带冗余成分的根（`…/proj/./`）：canonicalize 会把它折叠成规范形态，
    /// 而 CLI 的目录编码用的是进程 cwd 的逐字形态 —— 归一过一次，编码名就对不上。
    #[tokio::test]
    async fn discovery_roots_are_the_raw_registered_paths() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let main = tmp.path().join("proj");
        std::fs::create_dir_all(&main).expect("mkdir");
        // 同一个目录的「另一种写法」：身份渲染会折叠 `.` 与尾分隔符，原始串不会。
        let raw = PathBuf::from(format!("{}/./", main.to_string_lossy()));

        let scope = ProjectScope::resolve(&ExecTarget::Local, &raw, &[])
            .await
            .expect("resolve");

        assert_eq!(
            scope.roots(),
            std::slice::from_ref(&raw),
            "根必须原样保留（canonicalize 会让编码名对不上）"
        );
        assert_ne!(
            raw.to_string_lossy(),
            main.to_string_lossy(),
            "前提：两种写法的字符串不同"
        );
        // 归属按**身份**比较：两种写法是同一个目录。
        assert!(scope.owns(Some(&raw.to_string_lossy())));
        assert!(scope.owns(Some(&main.to_string_lossy())));
    }

    /// 去重：同一个根以两种写法出现（项目根也在 `recorded` 里）只保留一份原始形态。
    #[tokio::test]
    async fn duplicated_roots_are_collapsed() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let main = tmp.path().join("proj");
        std::fs::create_dir_all(&main).expect("mkdir");
        let trailing = PathBuf::from(format!("{}/", main.to_string_lossy()));

        let scope = ProjectScope::resolve(&ExecTarget::Local, &main, &[main.clone(), trailing])
            .await
            .expect("resolve");

        assert_eq!(scope.roots(), &[main], "同一个目录只出现一次");
    }
}
