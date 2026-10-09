//! 仓库工作树身份（`WorkspaceRef`）—— git 状态的**唯一**寻址单位。
//!
//! **为什么需要它（第一性原理）**：`git status = f(HEAD, index, workdir)`，而 linked
//! worktree 的这三者全都独立（只共享 object DB）。所以一个 Neeko project 在 git 语义
//! 下是 `1 + N` 个Workspace。此前整条链路（status 生产者、事件载荷、前端槽位、version
//! gate）只以 `project_id` 为身份，缺的那一维导致：worktree 视图没有权威生产者（列表
//! 不更新）、与主仓共用一个槽（串 main 内容）。症状是身份缺失的投影，因此修法是补上
//! 身份，而不是在消费侧加「谁该丢弃事件」的守卫。
//!
//! **key 的形态**：`{project_id}\0{identity(worktree_path)}`，主仓的 path 段为空。
//! 分隔符选 NUL 而非 `:` / `:wt:` —— NUL 是 POSIX 与 Windows 文件名里唯一绝对不允许
//! 出现的字符，因此 key 在任何真实路径下都不歧义。key 只由本文件产出（前端只做透传与
//! map 键；`src/shared/utils/workspaceRef.ts` 有与本文件 golden 用例逐字对齐的测试）。
//!
//! **路径是 [`CheckoutPath`]（一个值两个渲染）**：key / IPC 用**身份渲染**（平台无关字母表），
//! `-C` / 文件系统用**执行渲染**（宿主形态）。两个渲染的判据与不变量见
//! [`crate::common::git::checkout_path`]。构造期即拒绝非 UTF-8 路径（git CLI 参数与 IPC 都
//! 需要 UTF-8），因此 [`WorkspaceRef::root`] 返回 `&str` 不存在失败分支，也不需要任何
//! `unwrap_or(".")` 式的静默兜底。

use std::fmt;
use std::path::{Path, PathBuf};

use crate::common::executor::factory::ExecTarget;
use crate::common::git::checkout_path::CheckoutPath;

/// 分隔符：见模块级注释（NUL 不可能出现在合法路径中 → key 无歧义）。
pub const KEY_SEP: char = '\0';

/// 一个仓库工作树的引用。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Checkout {
    /// 主工作树（项目根目录本身，`.git` 为目录）。
    Main,
    /// linked worktree。`path` 的**身份渲染**即 key 的路径分量（Local 由
    /// [`CheckoutPath::resolve`] 保证平台无关形态；WSL/SSH 为远端 POSIX 形态）。
    Linked {
        /// 工作树根目录（身份形态 + 宿主形态，见 [`CheckoutPath`]）
        path: CheckoutPath,
    },
}

/// 一个Workspace = 项目 + 该项目的某个工作树。
///
/// **不含执行环境**：环境（Local / WSL / SSH）是项目记录的属性，由调用方经
/// `resolve_project` 取用。混进身份会让 `WorkspaceRef` 无法 `Hash/Eq`（`ExecTarget` 未实现
/// 这两个 trait），并诱导「按环境分叉」的写法。
///
/// **`Eq` / `Hash` 与 [`WorkspaceRef::key`] 同一定义**（手写实现，见下方 `impl`）：
/// 身份只由「项目 + 工作树」决定，`project_root` 只是解析细节（`Main` 的 `root`
/// 需要它），**不参与身份**。若让它进 `derive(Eq, Hash)`，`WorkspaceRef::main("p1", "/a/")`
/// 与 canonical 形态的同一单元会 `Eq` 不等却产出同一个 `key()` —— 那就是「同一实体两种
/// 身份表示」，正是本模块要消灭的形态。
#[derive(Debug, Clone)]
pub struct WorkspaceRef {
    project_id: String,
    /// 项目根的**执行渲染**（宿主形态）。用于把「传入路径其实等于项目根」归一成
    /// [`Checkout::Main`]（按身份比较，见 [`WorkspaceRef::resolve`]），并作为 `Main` 的工作目录。
    project_root: String,
    worktree: Checkout,
}

impl PartialEq for WorkspaceRef {
    fn eq(&self, other: &Self) -> bool {
        self.project_id == other.project_id && self.worktree == other.worktree
    }
}

impl Eq for WorkspaceRef {}

impl std::hash::Hash for WorkspaceRef {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.project_id.hash(state);
        self.worktree.hash(state);
    }
}

impl WorkspaceRef {
    /// 由前端传入的 worktree 路径构造（**唯一**构造入口）。
    ///
    /// - `worktree_path` 为 `None` / 全空白 / **身份等于项目根** → [`Checkout::Main`]；
    /// - 否则为 [`Checkout::Linked`]。
    ///
    /// 校验与归一化同处发生（红线 8）：调用方拿不到未归一化的形态，也就无法用两种字符
    /// 串指代同一个仓库（旧现实：`path_guard` 校验时 canonicalize、返回时丢弃结果）。
    /// 「等于项目根」按**身份渲染**比较：两个渲染各自可能随调用时刻/平台变化，
    /// 身份才是对象的等价类（见 [`crate::common::git::checkout_path`]）。
    ///
    /// # Errors
    /// 路径含 `..` / NUL、或非 UTF-8 可表示时返回错误。路径**不存在**不报错 ——
    /// `git worktree add` 之前目标目录尚不存在，属合法输入。
    pub fn resolve(
        project_id: &str,
        project_root: &str,
        worktree_path: Option<&str>,
        target: &ExecTarget,
    ) -> Result<Self, anyhow::Error> {
        let root = CheckoutPath::resolve(target, project_root)?;
        let Some(raw) = worktree_path.map(str::trim).filter(|s| !s.is_empty()) else {
            return Ok(Self::new(
                project_id,
                root.exec().to_string(),
                Checkout::Main,
            ));
        };
        let path = CheckoutPath::resolve(target, raw)?;
        if path.identity() == root.identity() {
            return Ok(Self::new(
                project_id,
                root.exec().to_string(),
                Checkout::Main,
            ));
        }
        Ok(Self::new(
            project_id,
            root.exec().to_string(),
            Checkout::Linked { path },
        ))
    }

    /// 主仓单元（项目根本身）。`project_root` 由调用方保证为受信形态（来自项目登记表）。
    #[must_use]
    pub fn main(project_id: &str, project_root: &str) -> Self {
        Self::new(project_id, project_root.to_string(), Checkout::Main)
    }

    fn new(project_id: &str, project_root: String, worktree: Checkout) -> Self {
        Self {
            project_id: project_id.to_string(),
            project_root,
            worktree,
        }
    }

    /// 所属项目 ID。
    #[must_use]
    pub fn project_id(&self) -> &str {
        &self.project_id
    }

    /// 工作树引用（主仓 or linked）。
    #[must_use]
    pub const fn worktree(&self) -> &Checkout {
        &self.worktree
    }

    /// 是否主仓单元。
    #[must_use]
    pub const fn is_main(&self) -> bool {
        matches!(self.worktree, Checkout::Main)
    }

    /// 该单元的工作目录 = 一切 git 调用（`-C`）与文件监听的根（**执行渲染**，宿主形态）。
    #[must_use]
    pub fn root(&self) -> &str {
        match &self.worktree {
            Checkout::Main => &self.project_root,
            Checkout::Linked { path } => path.exec(),
        }
    }

    /// 工作目录的 `Path` 形态（文件系统操作用）。
    #[must_use]
    pub fn root_path(&self) -> &Path {
        Path::new(self.root())
    }

    /// 工作树路径的 IPC 形态（**身份渲染**，平台无关字母表）：主仓为 `None`，
    /// linked worktree 为身份串 —— 前端拿它拼 `WorkspaceKey`，前端不做任何归一。
    #[must_use]
    pub fn worktree_path(&self) -> Option<&str> {
        match &self.worktree {
            Checkout::Main => None,
            Checkout::Linked { path } => Some(path.identity()),
        }
    }

    /// 双端共用的寻址 key（见模块级注释）。
    #[must_use]
    pub fn key(&self) -> String {
        format!(
            "{}{KEY_SEP}{}",
            self.project_id,
            self.worktree_path().unwrap_or("")
        )
    }

    /// 从 key 反解出 `(project_id, Option<worktree_path>)`。
    ///
    /// 只用于日志与测试断言：生产代码持 `WorkspaceRef` 本体，不从字符串逆向拼装身份。
    #[must_use]
    pub fn parse_key(key: &str) -> Option<(&str, Option<&str>)> {
        let (project_id, rest) = key.split_once(KEY_SEP)?;
        if rest.is_empty() {
            return Some((project_id, None));
        }
        Some((project_id, Some(rest)))
    }

    /// [`WorkspaceRef::key`] 的**诊断标签**形态：分隔符换成 `|`。
    ///
    /// 后台线程用单元身份命名，而 `std::thread` 拒绝含 interior NUL 的名字
    /// （`Builder::name` 会把 `spawn()` 直接判失败）—— key 恰恰以 NUL 作分隔符。
    /// 因此凡是要把身份塞进**线程名**的地方都必须走这里；它只影响诊断标签，
    /// 不参与任何身份判定与寻址（那些一律用 [`WorkspaceRef::key`]）。
    #[must_use]
    pub fn thread_tag(&self) -> String {
        self.key().replace(KEY_SEP, "|")
    }

    /// 该单元的路径分量（用于 key 的稳定性断言）。
    #[must_use]
    pub fn root_pathbuf(&self) -> PathBuf {
        PathBuf::from(self.root())
    }
}

impl fmt::Display for WorkspaceRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.key())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 建一个真实存在的目录（Local canonicalize 需要路径存在）。
    fn existing(dir: &tempfile::TempDir, name: &str) -> PathBuf {
        let p = dir.path().join(name);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn remote_target() -> ExecTarget {
        ExecTarget::Remote {
            host: "h".to_string(),
            port: 22,
            username: "u".to_string(),
            auth: crate::common::connection::types::AuthMethod::Password("x".to_string()),
        }
    }

    #[test]
    fn missing_worktree_path_yields_main_with_empty_tail() {
        let tmp = tempfile::tempdir().unwrap();
        let root = existing(&tmp, "repo");
        let t = ExecTarget::Local;
        let main = WorkspaceRef::resolve("p1", &root.to_string_lossy(), None, &t).unwrap();
        assert!(main.is_main());
        assert_eq!(main.key(), format!("p1{KEY_SEP}"));
        assert_eq!(main.worktree_path(), None);
        assert_eq!(
            main.root(),
            root.canonicalize().unwrap().to_string_lossy().as_ref(),
            "Local 构造入口必须返回 canonical 工作目录（macOS tempdir 是符号链接形态）"
        );
    }

    #[test]
    fn whitespace_worktree_path_is_main() {
        let tmp = tempfile::tempdir().unwrap();
        let root = existing(&tmp, "repo");
        let t = ExecTarget::Local;
        let main = WorkspaceRef::resolve("p1", &root.to_string_lossy(), Some("   "), &t).unwrap();
        assert!(main.is_main());
    }

    #[test]
    fn path_equal_to_project_root_normalizes_to_main() {
        let tmp = tempfile::tempdir().unwrap();
        let root = existing(&tmp, "repo");
        let t = ExecTarget::Local;
        let as_main = WorkspaceRef::resolve("p1", &root.to_string_lossy(), None, &t).unwrap();
        let as_wt = WorkspaceRef::resolve(
            "p1",
            &root.to_string_lossy(),
            Some(&root.to_string_lossy()),
            &t,
        )
        .unwrap();
        assert_eq!(
            as_main.key(),
            as_wt.key(),
            "同一仓库的两种写法必须收敛为同一身份"
        );
    }

    #[test]
    fn distinct_worktrees_get_distinct_keys() {
        let tmp = tempfile::tempdir().unwrap();
        let root = existing(&tmp, "repo");
        let wt_a = existing(&tmp, "wt-a");
        let wt_b = existing(&tmp, "wt-b");
        let t = ExecTarget::Local;
        let a = WorkspaceRef::resolve(
            "p1",
            &root.to_string_lossy(),
            Some(&wt_a.to_string_lossy()),
            &t,
        )
        .unwrap();
        let b = WorkspaceRef::resolve(
            "p1",
            &root.to_string_lossy(),
            Some(&wt_b.to_string_lossy()),
            &t,
        )
        .unwrap();
        assert_ne!(a.key(), b.key());
        // 身份渲染必须指向同一对象（不是比对字符串形态：形态是平台细节）
        let identity = a.worktree_path().expect("linked checkout has a path");
        assert_eq!(
            std::fs::canonicalize(identity).unwrap(),
            wt_a.canonicalize().unwrap(),
            "身份渲染必须与真实目录同对象"
        );
        assert!(!a.is_main());
    }

    #[test]
    fn trailing_separator_and_dot_segments_collapse_to_same_key() {
        let tmp = tempfile::tempdir().unwrap();
        let root = existing(&tmp, "repo");
        let wt = existing(&tmp, "wt");
        std::fs::create_dir_all(wt.join("sub")).unwrap();
        let t = ExecTarget::Local;
        let plain = wt.to_string_lossy().to_string();
        let with_trailing = format!("{plain}/");
        // `.` 成分必须指向**同一个**目录才算「同一种身份的第二种写法」；
        // `wt/sub/.` 指的是 sub，本来就是另一个单元（不该折叠）。
        let with_dot = format!("{plain}/./");
        let with_inner_dot = format!("{plain}/sub/./");
        let a = WorkspaceRef::resolve("p1", &root.to_string_lossy(), Some(&plain), &t).unwrap();
        let b =
            WorkspaceRef::resolve("p1", &root.to_string_lossy(), Some(&with_trailing), &t).unwrap();
        let c = WorkspaceRef::resolve("p1", &root.to_string_lossy(), Some(&with_dot), &t).unwrap();
        let d = WorkspaceRef::resolve("p1", &root.to_string_lossy(), Some(&with_inner_dot), &t)
            .unwrap();
        assert_eq!(a.key(), b.key(), "尾分隔符不得产生第二种身份");
        assert_eq!(a.key(), c.key(), "`.` 成分不得产生第二种身份");
        assert_ne!(
            a.key(),
            d.key(),
            "指向子目录是另一个Workspace，不得被归一化吞掉"
        );
    }

    #[test]
    fn symlinked_form_resolves_to_same_identity() {
        let tmp = tempfile::tempdir().unwrap();
        let root = existing(&tmp, "repo");
        let real_wt = existing(&tmp, "real-wt");
        let link = tmp.path().join("link-wt");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&real_wt, &link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&real_wt, &link).unwrap();

        let t = ExecTarget::Local;
        let via_real = WorkspaceRef::resolve(
            "p1",
            &root.to_string_lossy(),
            Some(&real_wt.to_string_lossy()),
            &t,
        )
        .unwrap();
        let via_link = WorkspaceRef::resolve(
            "p1",
            &root.to_string_lossy(),
            Some(&link.to_string_lossy()),
            &t,
        )
        .unwrap();
        assert_eq!(
            via_real.key(),
            via_link.key(),
            "符号链接与 realpath 必须折叠为同一身份（否则同一工作树两个槽）"
        );
    }

    #[test]
    fn parse_key_roundtrip_for_both_variants() {
        let tmp = tempfile::tempdir().unwrap();
        let root = existing(&tmp, "repo");
        let wt = existing(&tmp, "wt");
        let t = ExecTarget::Local;
        let main = WorkspaceRef::resolve("p1", &root.to_string_lossy(), None, &t).unwrap();
        assert_eq!(WorkspaceRef::parse_key(&main.key()), Some(("p1", None)));
        let linked = WorkspaceRef::resolve(
            "p1",
            &root.to_string_lossy(),
            Some(&wt.to_string_lossy()),
            &t,
        )
        .unwrap();
        let linked_key = linked.key();
        let (pid, path) = WorkspaceRef::parse_key(&linked_key).expect("key must parse");
        assert_eq!(pid, "p1");
        assert_eq!(path, linked.worktree_path());
    }

    /// 线程名不允许 interior NUL，而 key 以 NUL 分隔 —— 诊断标签必须可命名。
    /// （回归：`WatcherManager::watch` 曾因用 key 直接命名 debounce 线程而使
    /// `spawn()` 失败，任何单元的挂载都在 expect 处 panic。）
    #[test]
    fn thread_tag_is_usable_as_a_thread_name_for_both_variants() {
        let tmp = tempfile::tempdir().unwrap();
        let root = existing(&tmp, "repo");
        let wt = existing(&tmp, "wt");
        let t = ExecTarget::Local;
        let main = WorkspaceRef::resolve("p1", &root.to_string_lossy(), None, &t).unwrap();
        let linked = WorkspaceRef::resolve(
            "p1",
            &root.to_string_lossy(),
            Some(&wt.to_string_lossy()),
            &t,
        )
        .unwrap();
        assert!(!main.thread_tag().contains(KEY_SEP));
        assert!(!linked.thread_tag().contains(KEY_SEP));
        assert!(linked.thread_tag().contains('|'));
        assert_ne!(
            main.thread_tag(),
            linked.thread_tag(),
            "标签仍须区分两个单元（否则日志里看不出是谁）"
        );
        // 真的能建线程（std 的校验才是最终判据）
        let handle = std::thread::Builder::new()
            .name(format!("file-debounce-{}", linked.thread_tag()))
            .spawn(|| {})
            .expect("thread_tag must be accepted as a thread name");
        let _ = handle.join();
    }

    #[test]
    fn traversal_path_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let root = existing(&tmp, "repo");
        let t = ExecTarget::Local;
        let bad = format!("{}/../escape", root.to_string_lossy());
        assert!(
            WorkspaceRef::resolve("p1", &root.to_string_lossy(), Some(&bad), &t).is_err(),
            "含 `..` 成分的路径必须被拒绝（红线 8）"
        );
    }

    /// I3（时刻无关）在 **key 层**的回归钉：同一路径在创建前后必须是同一单元。
    ///
    /// 这正是 CI（Windows）报错那一类的正确断言层次 —— 断言身份不变量，而不是字符串表示。
    /// 夹具**刻意不做** canonicalize：macOS 的 tempdir 是符号链接根，锚定到 canonical
    /// 祖先之前，创建前会算出 `/var/…` 而创建后是 `/private/var/…`（两个 key）。
    #[test]
    fn key_is_stable_across_worktree_creation() {
        let tmp = tempfile::tempdir().unwrap();
        let root = existing(&tmp, "repo");
        let missing = tmp.path().join("new-wt");
        let t = ExecTarget::Local;

        let before = WorkspaceRef::resolve(
            "p1",
            &root.to_string_lossy(),
            Some(&missing.to_string_lossy()),
            &t,
        )
        .unwrap();
        std::fs::create_dir_all(&missing).unwrap();
        let after = WorkspaceRef::resolve(
            "p1",
            &root.to_string_lossy(),
            Some(&missing.to_string_lossy()),
            &t,
        )
        .unwrap();

        assert_eq!(
            before.key(),
            after.key(),
            "同一工作树创建前后必须是同一单元 key"
        );
    }

    /// key 的路径分量是**身份渲染**，工作目录是**执行渲染**：两者可不同（Windows），
    /// 但必须指向同一对象。
    #[test]
    fn key_carries_identity_rendering_while_root_carries_exec_rendering() {
        let tmp = tempfile::tempdir().unwrap();
        let root = existing(&tmp, "repo");
        let wt = existing(&tmp, "wt");
        let t = ExecTarget::Local;

        let linked = WorkspaceRef::resolve(
            "p1",
            &root.to_string_lossy(),
            Some(&wt.to_string_lossy()),
            &t,
        )
        .unwrap();

        let identity = linked.worktree_path().expect("linked checkout has a path");
        assert_eq!(linked.key(), format!("p1{KEY_SEP}{identity}"));
        assert_eq!(
            std::fs::canonicalize(linked.root()).unwrap(),
            std::fs::canonicalize(identity).unwrap(),
            "两个渲染（执行 / 身份）必须指向同一对象"
        );
    }

    #[test]
    fn remote_target_keeps_remote_path() {
        let t = remote_target();
        let wt =
            WorkspaceRef::resolve("p1", "/home/user/proj", Some("/home/user/proj-wt"), &t).unwrap();
        assert_eq!(wt.worktree_path(), Some("/home/user/proj-wt"));
        assert_ne!(wt.key(), WorkspaceRef::main("p1", "/home/user/proj").key());
    }

    /// golden：与前端 `src/shared/utils/__tests__/workspaceRef.test.ts` 的同名用例逐字对齐。
    #[test]
    fn golden_key_format_matches_frontend_contract() {
        let t = remote_target();
        let main = WorkspaceRef::main("proj-1", "/srv/app");
        let linked =
            WorkspaceRef::resolve("proj-1", "/srv/app", Some("/srv/app/.worktrees/dev"), &t)
                .unwrap();
        assert_eq!(main.key(), "proj-1\0");
        assert_eq!(linked.key(), "proj-1\0/srv/app/.worktrees/dev");
    }

    /// **#3 的回归钉**：`Eq`/`Hash` 必须与 `key()` 同一定义。
    ///
    /// `project_root` 是解析细节（`Main` 的 `root` 需要它），不是身份：若它进
    /// `Hash/Eq`，`main()`（调用方给的受信形态）与 `resolve()`（canonical 形态）在
    /// 同一个单元上会 `Eq` 不等 —— 同一实体两种身份表示，且 `HashMap<WorkspaceRef>` 与
    /// 按 `key()` 寻址的表会各记一份。
    #[test]
    fn equality_and_hash_follow_key_not_project_root_form() {
        let tmp = tempfile::tempdir().unwrap();
        let root = existing(&tmp, "repo");
        let t = ExecTarget::Local;

        // 同一单元、`project_root` 两种形态：canonical 与「尾分隔符 + `.`」写法
        let canonical = WorkspaceRef::resolve("p1", &root.to_string_lossy(), None, &t).unwrap();
        let other_form =
            WorkspaceRef::resolve("p1", &format!("{}/./", root.to_string_lossy()), None, &t)
                .unwrap();

        assert_eq!(canonical, other_form);
        assert_eq!(canonical.key(), other_form.key());

        let mut a = std::collections::HashSet::new();
        a.insert(canonical.clone());
        assert!(
            a.contains(&other_form),
            "Hash 也必须按身份（key）定义，否则 HashSet/HashMap 会记成两份"
        );

        // 反向：身份不同则必须不等（防止把 Eq 写成恒真）
        let linked = WorkspaceRef::resolve(
            "p1",
            &root.to_string_lossy(),
            Some(&existing(&tmp, "wt").to_string_lossy()),
            &t,
        )
        .unwrap();
        assert_ne!(canonical, linked);
    }
}
