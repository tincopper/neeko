//! Workspace路径：**一个值，两个渲染**（identity / exec）。
//!
//! # 契约（φ 的唯一定义）
//!
//! `WorkspaceRef::key()` 承诺「同一Workspace → 同一字节串」。这要求存在函数 φ 满足：
//!
//! - **I1 写法无关**：a、b 指同一文件系统对象 ⟹ φ(a) = φ(b)
//! - **I2 区分性**：不同对象 ⟹ 不同串（因此**不**做大小写折叠、**不**做 Unicode 归一 ——
//!   在大小写敏感文件系统上折叠会把两个对象并成一个身份）
//! - **I3 时刻无关**：φ(创建 p 之前) = φ(创建 p 之后)（尚不存在的路径是对「将要存在的
//!   对象」的承诺）
//!
//! φ 的定义（唯一实现处）：
//!
//! ```text
//! Local  存在   → φ(p) = identity(canonicalize(p))
//! Local  不存在 → φ(p) = identity(canonicalize(最深已存在祖先)) ⊕ 尾分量
//! WSL/SSH       → φ(p) = posix_render(p)        // 消费侧是远端 Linux，绝不进宿主 std::path
//! ```
//!
//! **为什么不存在时要锚定到祖先**：不锚定就只是「把输入拼法换成宿主分隔符」，那不是对象的
//! 不变量 —— 符号链接根（macOS `/var` ↔ `/private/var`）上「创建前」与「创建后」会算出两个
//! 身份，同一单元因此有两个 key（watcher 表 / diff 缓存 / 前端槽位各记一份）。
//!
//! # 两个渲染，两个消费角色
//!
//! | 渲染 | 形态 | 消费者 |
//! |------|------|--------|
//! | [`CheckoutPath::identity`] | **平台无关字母表**：`/` 分隔、无 `\\?\`/`\\.\` 前缀、盘符 ASCII 大写、UNC → `//server/share/…`、无尾分隔符 | `WorkspaceRef::key()` / `worktree_path()`、IPC `Worktree.path`、`canonical_worktree_path` 命令、watcher·diff·status 槽位、前端 `WorkspaceKey` |
//! | [`CheckoutPath::exec`] | **宿主形态**（与本次改造前逐字相同） | git argv、`std::fs`、notify 根、`strip_prefix`、gitignore `same_root`、缓存键前缀、file 域命令（`resolve_workspace_target` → `WorkspaceRef::root()`） |
//!
//! 两个渲染允许不同：不存在路径的 `exec` 是「将要被创建的字节」（调用者的拼写，语义正确），
//! `identity` 是「对象的等价类」（必须锚定到已存在祖先）。这不是权宜 —— 是角色的语义差异。
//!
//! **身份只允许由本模块产出**（红线 12）：其余模块与前端都不得自造等价串。
//!
//! **显式非目标**：Unicode NFD/NFC 归一；大小写不敏感文件系统上输入大小写的折叠；
//! `\\?\Volume{GUID}` 形态（原样保留）。

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};

use crate::common::executor::factory::ExecTarget;
use crate::common::git::path_guard;
use crate::platform::path_identity;

/// Workspace路径：一个值，两个渲染。相等 / 定序 / 哈希一律按 [`Self::identity`]（红线 12：
/// 同一对象一个等价类）。
#[derive(Debug, Clone)]
pub struct CheckoutPath {
    identity: String,
    exec: String,
}

impl CheckoutPath {
    /// 归一化并校验一个 worktree / 项目根绝对路径。
    ///
    /// **阻塞**（`exists` / `canonicalize` 是同步 fs）：异步上下文请用
    /// [`Self::resolve_async`]（红线 3），本入口只允许出现在同步上下文或已在阻塞池内的代码里。
    ///
    /// - 词法层（所有 target）：拒绝 NUL 与 `..` 分量；
    /// - Local：存在 → `canonicalize`；不存在 → `identity` 锚定到最深已存在祖先、`exec`
    ///   保持调用者拼写；
    /// - WSL / SSH：纯字符串词法归一（与宿主 OS 无关）；
    /// - 非 UTF-8 可表示的路径一律拒绝：git argv 与 IPC 都需要 UTF-8。
    pub fn resolve(target: &ExecTarget, raw: &str) -> Result<Self> {
        path_guard::lexical_worktree_check(raw)?;

        match target {
            ExecTarget::Local => Self::resolve_local(raw),
            // WSL / SSH：远端 Linux 路径。**绝不能经 `PathBuf`** —— 分隔符属于宿主 OS，
            // 而这串的消费者是远端 Linux：Windows 宿主上 `Path::components("/home/u/p")`
            // 会把前导 `/` 当 `RootDir` 再 push 成 `\home\u\p`，于是 ① 身份在不同宿主上分叉；
            // ② 该串直接进 `git -C` / WSL 登录脚本的 `cd` ⇒ 远端单元 status 与文件读全失效。
            ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
                let posix = path_identity::posix_render(raw);
                Ok(Self {
                    identity: posix.clone(),
                    exec: posix,
                })
            }
        }
    }

    /// 异步入口（红线 3）：把 [`Self::resolve`] 的阻塞 fs 隔离到阻塞池。
    ///
    /// **命令层（`#[tauri::command] async fn`）一律用这个**：`canonicalize` 在网络盘 /
    /// 未响应挂载点上可以阻塞到秒级，直接跑在 Tokio worker 上会挂起事件循环。
    /// 校验错误与渲染错误原样穿过异步边界（不被 `JoinError` 吞并）。
    pub async fn resolve_async(target: &ExecTarget, raw: &str) -> Result<Self> {
        let target = target.clone();
        let raw = raw.to_string();
        tokio::task::spawn_blocking(move || Self::resolve(&target, &raw))
            .await
            .map_err(|e| anyhow!("worktree path resolution task failed: {e}"))?
    }

    /// 身份渲染（**平台无关字母表**）：跨端契约，前端 `WorkspaceKey` 与后端所有槽位都用它。
    #[must_use]
    pub fn identity(&self) -> &str {
        &self.identity
    }

    /// 执行渲染（**宿主形态**）：交给 git / `std::fs` / notify 的形态。
    #[must_use]
    pub fn exec(&self) -> &str {
        &self.exec
    }

    /// 执行渲染的 `Path` 视图（宿主语义：`parent()` / `join` / `strip_prefix` 等）。
    #[must_use]
    pub fn exec_path(&self) -> &Path {
        Path::new(&self.exec)
    }

    fn resolve_local(raw: &str) -> Result<Self> {
        let path = Path::new(raw);

        // exec 逐字保持改造前的行为：存在 → canonicalize 原样（Windows 含 `\\?\`）；
        // 不存在 → 调用者拼写（那正是将要被创建的字节）。
        let (exec, identity_source) = if path.exists() {
            let canonical = path
                .canonicalize()
                .map_err(|e| anyhow!("cannot canonicalize worktree path `{raw}`: {e}"))?;
            (canonical.clone(), canonical)
        } else {
            (lexical_normalize(path), anchor_to_existing_ancestor(path))
        };

        let identity = render_local(&identity_source, raw)?;
        let exec = exec
            .to_str()
            .map(std::string::ToString::to_string)
            .ok_or_else(|| anyhow!("worktree path `{raw}` is not UTF-8"))?;

        Ok(Self { identity, exec })
    }
}

impl PartialEq for CheckoutPath {
    fn eq(&self, other: &Self) -> bool {
        self.identity == other.identity
    }
}

impl Eq for CheckoutPath {}

impl std::hash::Hash for CheckoutPath {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.identity.hash(state);
    }
}

impl PartialOrd for CheckoutPath {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for CheckoutPath {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.identity.cmp(&other.identity)
    }
}

impl std::fmt::Display for CheckoutPath {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.identity)
    }
}

// ─── 内部实现 ───────────────────────────────────────────────────────────────

/// 词法归一去 `.` 分量与尾分隔符（宿主语义）。仅用于**不存在的**路径的 exec 渲染：
/// 那是「将要被创建的字节」，`PathBuf` 的分隔符即宿主平台的分隔符，本地语义成立。
fn lexical_normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            std::path::Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// 不存在路径的身份锚点：沿父链找到最深的**已存在**祖先并 canonicalize，再把剩余分量原样接回。
///
/// 找不到任何可 canonicalize 的祖先（理论上只在虚构根上发生）→ 原样返回，由渲染层兜底。
fn anchor_to_existing_ancestor(path: &Path) -> PathBuf {
    let mut tail: Vec<&OsStr> = Vec::new();
    let mut cursor = path;

    loop {
        if let Ok(canonical) = cursor.canonicalize() {
            let mut out = canonical;
            for seg in tail.iter().rev() {
                out.push(seg);
            }
            return out;
        }
        match (cursor.parent(), cursor.file_name()) {
            (Some(parent), Some(name)) => {
                tail.push(name);
                cursor = parent;
            }
            _ => return path.to_path_buf(),
        }
    }
}

/// 宿主形态路径 → 身份渲染。非 UTF-8 一律拒绝（`to_string_lossy` 会把它悄悄换成 U+FFFD，
/// 那是同一对象的第二种身份表示）。
fn render_local(path: &Path, raw: &str) -> Result<String> {
    let text = path
        .to_str()
        .ok_or_else(|| anyhow!("worktree path `{raw}` is not UTF-8"))?;
    Ok(path_identity::portable_render(text))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::connection::types::AuthMethod;

    fn local() -> ExecTarget {
        ExecTarget::Local
    }

    fn ssh() -> ExecTarget {
        ExecTarget::Remote {
            host: "example.com".to_string(),
            port: 22,
            username: "user".to_string(),
            auth: AuthMethod::Password("x".to_string()),
        }
    }

    fn wsl() -> ExecTarget {
        ExecTarget::Wsl {
            distro: "Ubuntu-22.04".to_string(),
        }
    }

    /// 夹具一律由 `tempdir()` 推导（红线 13）：期望值只从 `resolve` 自身或 `PathBuf` 派生，
    /// 不写死任何分隔符/绝对路径。
    fn fixture(name: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(name);
        (dir, path)
    }

    // ── I1：写法无关 ─────────────────────────────────────────────────────

    #[test]
    fn identity_is_spelling_independent() {
        let (_d, root) = fixture("wt");
        std::fs::create_dir_all(&root).unwrap();
        let base = root.to_string_lossy().to_string();
        let expected = CheckoutPath::resolve(&local(), &base).unwrap();
        let sep = std::path::MAIN_SEPARATOR;

        for spelling in [
            base.clone(),
            format!("{base}{sep}"),       // 尾分隔符
            format!("{base}{sep}.{sep}"), // `.` + 尾分隔符
            format!("{base}/./"),         // 宿主外分隔符写法
            format!("{base}{sep}.{sep}./"),
        ] {
            let got = CheckoutPath::resolve(&local(), &spelling).unwrap();
            assert_eq!(
                got.identity(),
                expected.identity(),
                "写法 `{spelling}` 必须与 `{base}` 同身份"
            );
        }
    }

    #[test]
    fn identity_resolves_symlinked_ancestor() {
        let (_d, real) = fixture("real");
        std::fs::create_dir_all(&real).unwrap();
        let link = real.with_file_name("link");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&real, &link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&real, &link).unwrap();

        let via_link = CheckoutPath::resolve(&local(), &link.to_string_lossy()).unwrap();
        let via_real = CheckoutPath::resolve(&local(), &real.to_string_lossy()).unwrap();
        assert_eq!(
            via_link.identity(),
            via_real.identity(),
            "符号链接形态与 realpath 形态必须收敛为同一身份"
        );
    }

    // ── I3：时刻无关（CI 上 Windows 报错那条断言的正确层次）────────────────

    #[test]
    fn identity_is_stable_across_creation() {
        // 夹具**刻意**不做 canonicalize：macOS 的 tempdir 是符号链接根，
        // 「创建前」必须锚定到 canonical 祖先才能与「创建后」同身份。
        let (_d, missing) = fixture("new-wt");
        let input = format!("{}{}", missing.to_string_lossy(), std::path::MAIN_SEPARATOR);

        let before = CheckoutPath::resolve(&local(), &input).unwrap();
        std::fs::create_dir_all(&missing).unwrap();
        let after = CheckoutPath::resolve(&local(), &missing.to_string_lossy()).unwrap();

        assert_eq!(
            before.identity(),
            after.identity(),
            "同一路径创建前后必须是同一身份（否则同一单元有两个 key）"
        );
    }

    // ── 两个渲染的角色 ───────────────────────────────────────────────────

    #[test]
    fn exec_and_identity_refer_to_the_same_object() {
        let (_d, root) = fixture("wt");
        std::fs::create_dir_all(&root).unwrap();
        let resolved = CheckoutPath::resolve(&local(), &root.to_string_lossy()).unwrap();

        let canon = |s: &str| std::fs::canonicalize(s).unwrap();
        assert_eq!(
            canon(resolved.identity()),
            canon(resolved.exec()),
            "两个渲染必须指向同一对象"
        );
        // `exec_path()` 是 git 命令层（`create_worktree` 的父目录预创建）的入口视图
        assert_eq!(resolved.exec_path(), Path::new(resolved.exec()));
    }

    #[test]
    fn identity_carries_no_host_separators_nor_verbatim_prefix() {
        let (_d, root) = fixture("a b/wt");
        std::fs::create_dir_all(&root).unwrap();
        let resolved = CheckoutPath::resolve(&local(), &root.to_string_lossy()).unwrap();

        assert!(
            !resolved.identity().contains('\\'),
            "identity 不得含宿主分隔符：{}",
            resolved.identity()
        );
        assert!(
            !resolved.identity().contains("\\\\?"),
            "identity 不得含 verbatim 前缀：{}",
            resolved.identity()
        );
        assert!(resolved.identity().contains('/'));
    }

    #[test]
    fn exec_of_missing_path_keeps_caller_spelling() {
        // exec 是「将要被创建的字节」：不存在的路径保持调用者拼写（逐字保持改造前行为），
        // 只有尾分隔符按词法归一去。
        let (_d, missing) = fixture("new-wt");
        let input = format!("{}{}", missing.to_string_lossy(), std::path::MAIN_SEPARATOR);
        let resolved = CheckoutPath::resolve(&local(), &input).unwrap();
        assert_eq!(resolved.exec(), missing.to_string_lossy());
    }

    #[test]
    fn exec_of_existing_path_is_the_host_canonical_form() {
        // exec 的契约（用户决策：逐字保持改造前行为）= 宿主 `canonicalize` 的输出。
        // Windows 上这一条同时钉住 `\\?\` 前缀仍在 exec 里（长路径支持不退化）。
        let (_d, root) = fixture("wt");
        std::fs::create_dir_all(&root).unwrap();
        let resolved = CheckoutPath::resolve(&local(), &root.to_string_lossy()).unwrap();
        assert_eq!(
            resolved.exec(),
            root.canonicalize().unwrap().to_string_lossy()
        );
    }

    /// **回传不变量**：前端把 identity 原样回传当路径参数（`WorkspaceKey` → `worktreePath`），
    /// 后端必须收敛到同一身份 —— 否则每过一次 IPC 就多一种形态。
    #[test]
    fn identity_is_idempotent_when_fed_back() {
        let (_d, root) = fixture("wt");
        std::fs::create_dir_all(&root).unwrap();
        let first = CheckoutPath::resolve(&local(), &root.to_string_lossy()).unwrap();
        let again = CheckoutPath::resolve(&local(), first.identity()).unwrap();
        assert_eq!(again.identity(), first.identity());
        assert_eq!(again.exec(), first.exec());

        // 不存在的路径同样必须收敛（create/rename 的预览路径会经 IPC 往返）
        let (_d2, missing) = fixture("new-wt");
        let before = CheckoutPath::resolve(&local(), &missing.to_string_lossy()).unwrap();
        let round_trip = CheckoutPath::resolve(&local(), before.identity()).unwrap();
        assert_eq!(round_trip.identity(), before.identity());
    }

    /// 相对路径且全链不存在：锚点回退为原拼写，仍必须给出稳定身份（不 panic、不返回空串）。
    #[test]
    fn relative_missing_path_without_any_existing_ancestor_is_stable() {
        let raw = "neeko-definitely-missing-path/wt";
        let first = CheckoutPath::resolve(&local(), raw).unwrap();
        let second = CheckoutPath::resolve(&local(), raw).unwrap();
        assert!(!first.identity().is_empty());
        assert_eq!(first.identity(), second.identity());
    }

    /// 非 UTF-8 的真实路径必须被拒绝：`to_string_lossy` 会把它悄悄换成 U+FFFD，
    /// 那就是同一对象的第二种身份表示（不可 UTF-8 往返 = 不可作为 git argv / IPC 载荷）。
    ///
    /// 仅 Linux 可构造：macOS（APFS）拒绝创建含非法字节的文件名（EILSEQ），
    /// Windows 文件名是 UTF-16 不存在该形态 —— 该分支在另两端只作防御，由 Linux job 覆盖。
    #[cfg(target_os = "linux")]
    #[test]
    fn non_utf8_realpath_is_rejected() {
        use std::os::unix::ffi::OsStrExt;

        let dir = tempfile::tempdir().unwrap();
        // 入口串是合法 UTF-8（符号链接名），但 canonicalize 解出的真实路径含非法字节
        let target = dir.path().join(OsStr::from_bytes(b"t-\xff"));
        std::fs::create_dir_all(&target).unwrap();
        let link = dir.path().join("link-utf8");
        std::os::unix::fs::symlink(&target, &link).unwrap();

        let err = CheckoutPath::resolve(&local(), link.to_str().unwrap()).unwrap_err();
        assert!(
            err.to_string().contains("not UTF-8"),
            "必须拒绝而非产出 U+FFFD 身份，got: {err}"
        );
    }

    // ── 远端（WSL / SSH）：身份与执行同形，且与宿主 OS 无关 ────────────────

    #[test]
    fn remote_identity_is_posix_and_host_independent() {
        for target in [&ssh(), &wsl()] {
            let resolved = CheckoutPath::resolve(target, "/home/user/proj/.worktrees/dev").unwrap();
            assert_eq!(resolved.identity(), "/home/user/proj/.worktrees/dev");
            assert_eq!(resolved.exec(), resolved.identity());

            assert_eq!(
                CheckoutPath::resolve(target, "/home/user/proj/./x/")
                    .unwrap()
                    .identity(),
                "/home/user/proj/x"
            );
            // 相对形态保留相对性（远端 worktree 路径允许相对写法）
            assert_eq!(
                CheckoutPath::resolve(target, "sub/wt/").unwrap().identity(),
                "sub/wt"
            );
            // 根仍是根（不塌成空串 —— 空串与「没传路径」同形）
            assert_eq!(
                CheckoutPath::resolve(target, "/./").unwrap().identity(),
                "/"
            );
            // 反斜杠是 POSIX 的合法文件名字符：Windows 宿主上也不得改写
            assert_eq!(
                CheckoutPath::resolve(target, r"/home/u/a\b")
                    .unwrap()
                    .identity(),
                r"/home/u/a\b"
            );
        }
    }

    // ── 词法层拒绝 ───────────────────────────────────────────────────────

    #[test]
    fn traversal_and_nul_are_rejected_for_every_target() {
        for target in [&local(), &ssh(), &wsl()] {
            assert!(CheckoutPath::resolve(target, "/repo/../evil").is_err());
            assert!(CheckoutPath::resolve(target, "a\0b").is_err());
        }
    }

    // ── 异步入口（红线 3）────────────────────────────────────────────────

    /// 异步入口必须与同步入口逐字同结果（同一个 φ），且错误原样穿过异步边界。
    #[tokio::test]
    async fn async_entry_matches_sync_entry() {
        let (_d, root) = fixture("wt");
        std::fs::create_dir_all(&root).unwrap();
        let raw = root.to_string_lossy().to_string();

        let sync = CheckoutPath::resolve(&local(), &raw).unwrap();
        let via_task = CheckoutPath::resolve_async(&local(), &raw).await.unwrap();
        assert_eq!(via_task.identity(), sync.identity());
        assert_eq!(via_task.exec(), sync.exec());

        // 拒绝路径：错误类型与信息不得被 `JoinError` 覆盖
        let err = CheckoutPath::resolve_async(&local(), "/repo/../evil")
            .await
            .unwrap_err();
        assert!(err.to_string().contains(".."), "got: {err}");
    }
}
