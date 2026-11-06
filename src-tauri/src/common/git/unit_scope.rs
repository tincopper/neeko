//! 执行地址的**单元归属**（哪个 Workspace 单元拥有某个目录）。
//!
//! # 这条规则是什么
//!
//! 一个项目有 1+N 个执行上下文（主 checkout + 若干 linked worktree）。给定一条路径
//! （agent 会话的 cwd、搜索根、LSP 根……），它属于**包含它且最深**的那个单元根。
//! 这是 git 语义的直接推论，与调用方域（会话 / LSP / 任务）无关 —— 所以它住在这里，
//! 而不是住在任何一个消费方（消费方各写一份是 `agent/hooks/ingest/attribution.rs`、
//! `conversation::matches_project_path` 与本模块并存的那段历史）。
//!
//! # 为什么「前缀包含」不够
//!
//! Neeko 的 worktree **默认落在项目根之外**（`~/.neeko/worktrees/<name>`，
//! 见 `common/git/path_guard.rs`），此时两个单元根**互不包含**，前缀判定恰好够用。
//! 但还有两种合法布局会重叠：
//!
//! 1. 用户约定把 worktree 建在仓内（`<project>/.worktrees/<name>`，
//!    `git/commands/worktree.rs` 的注释点名了这个约定）；
//! 2. worktree 里再开 worktree（嵌套）。
//!
//! 重叠时，只看「属于项目根」会让主仓单元把 worktree 的会话一并列出 —— 而恢复出来的
//! 续写通道却建立在调用方当前单元，cwd 与 agent 的原生会话 origin 不一致（pi / opencode
//! 会直接拒绝跨目录 resume）。所以必须有「归属哪个单元」这一维。
//!
//! # 两种字母表，一个不变量
//!
//! 会话 cwd 来自各 agent 的存储（跨宿主形态），单元根来自 git。两边的**渲染必须一致**，
//! 否则同一个目录会有两种身份（红线 12 的同源要求）。字母表跟着**执行目标**走而不是
//! 宿主平台：远端（WSL / SSH）路径的消费侧是远端 Linux，用宿主规则渲染会把 `/` 变成 `\`。
//! [`UnitScope`] 把字母表和根绑在同一个值里 —— 让「拿错字母表」在类型上不成立。

use anyhow::Result;

use crate::common::executor::factory::ExecTarget;
use crate::common::git::checkout_path::CheckoutPath;
use crate::common::git::operations::worktree::list_linked_worktree_roots;
use crate::common::git::workspace_ref::WorkspaceRef;
use crate::platform::path_identity;

/// 路径字母表：同一批路径在身份空间里按哪套规则渲染。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathAlphabet {
    /// 宿主形态（Local 路径）—— 按宿主平台选规则（Windows 折叠反斜杠与设备前缀）。
    Host,
    /// POSIX 形态（WSL / SSH 远端路径）—— 与宿主平台无关。
    Posix,
}

impl PathAlphabet {
    /// 执行目标 → 字母表。远端路径的消费侧是远端 Linux，与宿主无关。
    #[must_use]
    pub const fn for_target(target: &ExecTarget) -> Self {
        match target {
            ExecTarget::Local => Self::Host,
            _ => Self::Posix,
        }
    }

    /// 渲染为身份串（幂等；只做字母表转换，不做 canonicalize —— 那是 [`CheckoutPath`] 的职责）。
    fn render(self, raw: &str) -> String {
        let trimmed = raw.trim();
        match self {
            Self::Host => path_identity::portable_render(trimmed),
            Self::Posix => path_identity::posix_render(trimmed),
        }
    }
}

/// 一个 Workspace 单元对路径的归属范围（纯值对象，无 IO）。
///
/// 构造只允许两条路：生产走 [`UnitScope::resolve`]（解析 + 取同级单元根，唯一校验入口），
/// 测试走 `pub(crate) new`。这样「拿任意字符串当单元根」不会成为生产代码的习惯 ——
/// 地址与根的铸造点仍然只有 `resolve_workspace_target` / [`CheckoutPath`]。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnitScope {
    /// 本单元的根（身份渲染）。
    owned: String,
    /// 同项目的其它单元根（linked worktree，身份渲染）——「最深根胜出」的候选。
    siblings: Vec<String>,
    /// 会话路径按哪套字母表渲染（见模块注释）。
    alphabet: PathAlphabet,
}

impl UnitScope {
    /// 由「本单元根 + 同级根 + 字母表」构造（测试与 [`UnitScope::resolve`] 用）。
    ///
    /// 入参是**原始路径**：渲染在这里发生，调用方不接触字母表选择。
    pub(crate) fn new(
        owned: &str,
        siblings: impl IntoIterator<Item = String>,
        alphabet: PathAlphabet,
    ) -> Self {
        Self {
            owned: alphabet.render(owned),
            siblings: siblings.into_iter().map(|s| alphabet.render(&s)).collect(),
            alphabet,
        }
    }

    /// 执行目标 + 已解析的工作区 → 单元范围（唯一生产构造入口）。
    ///
    /// 单元根的**身份**由 [`CheckoutPath`] 铸造（唯一 identity 出口）：这里对
    /// [`WorkspaceRef::root`]（执行渲染）再解析一次，而不是让消费方自己去 canonicalize。
    /// 同级根清单失败时降级为「只有本单元根」—— 恢复列表是只读入口，不该因为一次
    /// git 失败变成空列表（详见各字段语义与 [`UnitScope::owns`]）。
    pub async fn resolve(target: &ExecTarget, repo: &WorkspaceRef) -> Result<Self> {
        let alphabet = PathAlphabet::for_target(target);
        let owned = CheckoutPath::resolve_async(target, repo.root())
            .await?
            .identity()
            .to_string();
        let siblings = match list_linked_worktree_roots(target, repo.root()).await {
            Ok(roots) => roots,
            Err(e) => {
                // 降级：只剩本单元根。方向是「单元自己的会话不漏」优先于「兄弟单元不串门」。
                log::warn!(
                    "[git] worktree list unavailable for unit `{owned}`, falling back to the unit root alone: {e:#}"
                );
                Vec::new()
            }
        };
        Ok(Self::new(&owned, siblings, alphabet))
    }

    /// 该路径是否属于本单元。
    ///
    /// 无路径（或空串）一律**不属于**任何单元：单元是 git 事实，缺 cwd 就无法判定
    /// （与 `conversation::matches_project_path` 对空路径的 fail-closed 一致）。
    #[must_use]
    pub fn owns(&self, session_project: Option<&str>) -> bool {
        let Some(raw) = session_project.map(str::trim).filter(|s| !s.is_empty()) else {
            return false;
        };
        let session = self.alphabet.render(raw);
        let unit_roots =
            std::iter::once(self.owned.as_str()).chain(self.siblings.iter().map(String::as_str));
        deepest_root(unit_roots, &session) == Some(self.owned.as_str())
    }
}

/// 在若干根里找**最深命中**的那一个；`None` = 没有任何根包含 `path`。
///
/// 这是「路径归属哪个单元」的完整规则，也是下一个域（LSP / 搜索 / 任务）的复用点 ——
/// 需要更宽的可见性时再提升，不要复制判定逻辑。
#[must_use]
pub(crate) fn deepest_root<'a, I>(roots: I, path: &str) -> Option<&'a str>
where
    I: IntoIterator<Item = &'a str>,
{
    let mut best: Option<&'a str> = None;
    for root in roots {
        if !contains(root, path) {
            continue;
        }
        // 相等深度不可能互相包含（否则两者相同），`>` 即可保证「最深」唯一。
        if best.is_none_or(|current| depth(root) > depth(current)) {
            best = Some(root);
        }
    }
    best
}

/// 路径包含，**按分量边界**（`/proj` 不含 `/proj-other`）。
///
/// 输入两侧都是身份串（`/` 字母表），分隔符**只有** `/`，因此这里不能借 `Path`：
/// `Path` 的分量规则跟**宿主平台**走，Windows 上会把 `\` 一并当分隔符 ——
/// 同一批远端路径（`PathAlphabet::Posix`）于是会在两端得到两种归属
/// （`/p\x` 被当成 `/p/x`）。手写分量比较同时天然处理两种前缀形态：普通根（`/a/b`）
/// 与**保留尾斜杠的驱动器根**（`C:/`）—— 后者若用字符串切片判定会恒假
/// （`"C:/proj"[3..]` 不以 `/` 开头）。
fn contains(root: &str, path: &str) -> bool {
    if root.is_empty() || path.is_empty() {
        return false;
    }
    // 绝对/相对必须同类：`/` 根不该认领相对路径（与 `Path::starts_with` 的既有语义一致）。
    if root.starts_with('/') != path.starts_with('/') {
        return false;
    }
    let mut path_parts = identity_parts(path);
    identity_parts(root).all(|root_part| path_parts.next() == Some(root_part))
}

/// 身份串按 `/` 切分量（空段已在渲染阶段折叠，这里只丢空段）。
fn identity_parts(path: &str) -> impl Iterator<Item = &str> + '_ {
    path.split('/').filter(|part| !part.is_empty())
}

/// 根的深度（分量数）。同一字母表内「嵌套 ⇒ 更深」恒成立。
fn depth(root: &str) -> usize {
    identity_parts(root).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(owned: &str, siblings: &[&str]) -> UnitScope {
        UnitScope::new(
            owned,
            siblings
                .iter()
                .map(|s| (*s).to_string())
                .collect::<Vec<String>>(),
            PathAlphabet::Host,
        )
    }

    #[test]
    fn main_unit_owns_project_root_and_subdirs() {
        let unit = scope("/proj", &["/proj/.worktrees/dev"]);
        assert!(unit.owns(Some("/proj")));
        assert!(unit.owns(Some("/proj/src")));
        assert!(unit.owns(Some("/proj/")));
        assert!(unit.owns(Some("  /proj/src  ")), "首尾空白不影响判定");
    }

    /// 主症状：worktree 在仓内时，会话路径同时落在两个根下 —— 更深者胜出。
    #[test]
    fn main_unit_rejects_in_repo_worktree_sessions() {
        let unit = scope("/proj", &["/proj/.worktrees/dev"]);
        assert!(!unit.owns(Some("/proj/.worktrees/dev")));
        assert!(!unit.owns(Some("/proj/.worktrees/dev/src")));
    }

    #[test]
    fn worktree_unit_owns_only_its_own_subtree() {
        let unit = scope("/proj/.worktrees/dev", &["/proj", "/proj/.worktrees/feat"]);
        assert!(unit.owns(Some("/proj/.worktrees/dev")));
        assert!(unit.owns(Some("/proj/.worktrees/dev/crates")));
        assert!(!unit.owns(Some("/proj")));
        assert!(!unit.owns(Some("/proj/src")));
        assert!(!unit.owns(Some("/proj/.worktrees/feat")));
    }

    /// 默认布局（worktree 在项目根之外）：两个根互不包含，同级根不干扰归属。
    #[test]
    fn out_of_repo_worktree_is_owned_by_itself_only() {
        let main = scope("/proj", &["/home/.neeko/worktrees/dev"]);
        let wt = scope("/home/.neeko/worktrees/dev", &["/proj"]);
        assert!(main.owns(Some("/proj/src")));
        assert!(!main.owns(Some("/home/.neeko/worktrees/dev")));
        assert!(wt.owns(Some("/home/.neeko/worktrees/dev/src")));
        assert!(!wt.owns(Some("/proj/src")));
    }

    #[test]
    fn nested_worktree_wins_by_depth() {
        let unit = scope("/proj/.worktrees/dev", &["/proj/.worktrees/dev/nested"]);
        assert!(unit.owns(Some("/proj/.worktrees/dev/src")));
        assert!(!unit.owns(Some("/proj/.worktrees/dev/nested")));
    }

    #[test]
    fn missing_or_empty_session_path_never_matches() {
        let unit = scope("/proj", &[]);
        assert!(!unit.owns(None));
        assert!(!unit.owns(Some("")));
        assert!(!unit.owns(Some("   ")));
    }

    #[test]
    fn sibling_directory_with_shared_prefix_is_not_owned() {
        let unit = scope("/proj", &[]);
        assert!(!unit.owns(Some("/proj-other")));
        assert!(!unit.owns(Some("/proj-other/src")));
    }

    /// 驱动器根：身份字母表**故意**保留尾斜杠（否则 `C:` 与驱动器相对路径同形）——
    /// 用字符串切片判定会恒假（`"C:/proj"[3..]` 不以 `/` 开头），分量比较必须仍然成立。
    #[test]
    fn drive_root_still_owns_its_subtree() {
        let unit = scope("C:/", &[]);
        assert!(unit.owns(Some("C:/proj")));
        assert!(!unit.owns(Some("D:/proj")));
    }

    /// 反斜杠**不是**身份字母表的分隔符：它在 POSIX 宿主上是普通文件名字符，
    /// 在 Windows 形态则应在渲染阶段就被折叠 —— 两种情况下都不能当成分隔符。
    #[test]
    fn backslash_is_not_a_separator_in_the_identity_alphabet() {
        let posix = UnitScope::new("/p", std::iter::empty(), PathAlphabet::Posix);
        assert!(!posix.owns(Some("/p\\x")));
        assert!(posix.owns(Some("/p/x")));
    }

    /// 远端路径走 POSIX 字母表：`\` 是合法文件名字符，不得被当成分隔符改写。
    #[test]
    fn remote_paths_use_posix_letters() {
        let unit = UnitScope::new("/home/u/proj", std::iter::empty(), PathAlphabet::Posix);
        assert!(unit.owns(Some("/home/u/proj/")));
        assert!(unit.owns(Some("/home/u/proj/sub")));
        assert!(!unit.owns(Some("/home/u/proj-x")));
        assert!(
            !unit.owns(Some("/home/u/proj\\sub")),
            "反斜杠不是远端分隔符"
        );
    }

    #[test]
    fn deepest_root_picks_the_deepest_containing_root() {
        let roots = ["/a", "/a/b", "/a/b/c", "/x"];
        assert_eq!(deepest_root(roots, "/a/b/c/d"), Some("/a/b/c"));
        assert_eq!(deepest_root(roots, "/a/b/d"), Some("/a/b"));
        assert_eq!(deepest_root(roots, "/z"), None);
        assert_eq!(deepest_root([""], "/z"), None, "空根不算命中");
    }
}
