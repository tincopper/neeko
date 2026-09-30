//! Git 路径安全校验（AGENTS.md 红线 8：前端传入的路径在 Rust 端消费前必须校验）。
//!
//! 两类路径、两种策略：
//! 1. **仓库内相对路径**（stage/unstage/discard/diff 的 `file_path`）：必须落在
//!    项目根之内 —— 词法拒绝 `..` 分量 + Local 下 canonicalize 前缀校验（参照
//!    `common/file/services.rs` 的既有范式）。
//! 2. **worktree 绝对路径**：由用户自选位置（可在项目根之外，如
//!    `~/.neeko/worktrees/<name>`），不能强制 containment；做词法校验（拒绝
//!    `..` 分量与 NUL），Local 下存在时 canonicalize 规范化。
//!
//! WSL/SSH 路径是远端 Linux 路径，无法本地 canonicalize，仅做词法校验。

use crate::common::executor::factory::ExecTarget;
use anyhow::{bail, Result};

/// 校验仓库内相对路径，防止 `..` 穿越。
///
/// - 词法层（所有 ExecTarget）：拒绝空路径、NUL、绝对路径、含 `..` 分量。
/// - canonical 层（仅 Local，且父目录存在时）：canonicalize 后必须位于
///   canonicalize(项目根) 之内。文件可能尚不存在（新建文件场景），此时跳过
///   canonical 层（词法层已兜底）。
pub fn validate_repo_relative_path(target: &ExecTarget, root: &str, rel: &str) -> Result<()> {
    lexical_check(rel)?;
    if matches!(target, ExecTarget::Local) {
        let canonical_root = std::path::Path::new(root)
            .canonicalize()
            .map_err(|e| anyhow::anyhow!("invalid project root `{root}`: {e}"))?;
        canonical_containment_check(root, &canonical_root, rel)?;
    }
    Ok(())
}

/// 校验一批仓库内相对路径（任一非法即失败，错误信息带上下文）。
///
/// Local 下项目根只 canonicalize 一次后复用（批量 stage 几十上百个文件时，
/// 逐文件 canonicalize(root) 是无谓的重复 syscall）。
pub fn validate_repo_relative_paths(
    target: &ExecTarget,
    root: &str,
    paths: &[String],
) -> Result<()> {
    let canonical_root = if matches!(target, ExecTarget::Local) {
        Some(
            std::path::Path::new(root)
                .canonicalize()
                .map_err(|e| anyhow::anyhow!("invalid project root `{root}`: {e}"))?,
        )
    } else {
        None
    };
    for p in paths {
        lexical_check(p).map_err(|e| e.context(format!("file path `{p}`")))?;
        if let Some(canonical_root) = &canonical_root {
            canonical_containment_check(root, canonical_root, p)
                .map_err(|e| e.context(format!("file path `{p}`")))?;
        }
    }
    Ok(())
}

/// 归一化并校验 worktree / 项目根绝对路径，返回可用作**身份**的字符串形态。
///
/// - 词法层（所有 ExecTarget）：拒绝 NUL 与 `..` 分量（允许项目根之外的合法位置 ——
///   worktree 由用户自选位置，如 `~/.neeko/worktrees/<name>`）；
/// - canonical 层（仅 Local）：路径存在 → `canonicalize()`（解析符号链接、`.`、
///   尾分隔符）；不存在 → 词法归一（`git worktree add` 之前目标目录尚不存在）；
/// - WSL / SSH：**纯字符串**词法归一（远端 Linux 路径，绝不能经宿主 `std::path` —— 见下方分支注释）；
/// - 非 UTF-8 可表示的路径一律拒绝：git CLI 参数与 IPC 都需要 UTF-8。
///
/// **为什么不「校验完返回原串」**：旧实现正是这样，于是同一个工作树可以以符号链接
/// 形态、realpath 形态、带尾分隔符形态分别进入 watcher 表 / diff 缓存键 / 前端槽位，
/// 各自成为一份独立身份 —— worktree 场景 changes 列表串数据的一维根因。归一化结果
/// 必须被返回并向上贯穿，身份才有单一实现处（配 [`crate::common::git::RepoRef`]）。
///
/// [`crate::common::git::RepoRef`]: crate::common::git::RepoRef
pub fn canonicalize_worktree_path(target: &ExecTarget, path: &str) -> Result<String> {
    lexical_worktree_check(path)?;
    if matches!(target, ExecTarget::Local) {
        let p = std::path::Path::new(path);
        let normalized = if p.exists() {
            p.canonicalize()
                .map_err(|e| anyhow::anyhow!("cannot canonicalize worktree path `{path}`: {e}"))?
        } else {
            lexical_normalize(p)
        };
        return normalized
            .to_str()
            .map(std::string::ToString::to_string)
            .ok_or_else(|| anyhow::anyhow!("worktree path `{path}` is not UTF-8"));
    }
    // WSL / SSH：远端 Linux 路径，本地无法 canonicalize，只做词法归一。
    //
    // **绝不能经 `PathBuf`**：那不是「同一份逻辑换个输入」，而是换了物理语义 —— 路径分隔符
    // 属于宿主 OS（`std::path` 的文档语义），而这条路径的消费者是**远端 Linux**。Windows 宿主上
    // `Path::components("/home/u/p")` 把前导 `/` 当作 `RootDir` 再 push 回去，结果是 `\home\u\p`。
    // 后果有两层：① 身份（`RepoRef::key()`）在不同宿主上分叉；② 该字符串直接进 `git -C` /
    // WSL 登录脚本的 `cd`（`common/executor/wsl.rs`），远端根本没有这个路径 —— 远端单元的
    // status 与文件读全部失效。纯字符串归一与宿主 OS 无关。
    Ok(lexical_normalize_posix(path))
}

/// 词法归一：去掉 `.` 分量与尾分隔符（`..` 已被 [`lexical_worktree_check`] 拒绝）。
///
/// 仅用于 **Local**：`PathBuf` 的分隔符即宿主平台的分隔符，本地语义成立。
fn lexical_normalize(path: &std::path::Path) -> std::path::PathBuf {
    let mut out = std::path::PathBuf::new();
    for comp in path.components() {
        match comp {
            std::path::Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// 远端（WSL / SSH）POSIX 路径的词法归一：去 `.` 与空段、去尾分隔符，保留前导 `/`。
///
/// 全字符串实现（不碰 `PathBuf`）：归一结果必须在 macOS / Windows / Linux 三端逐字相同，
/// 因为它就是远端 `git -C` / `cd` 的参数与仓库单元身份的一部分。判据与理由见
/// [`canonicalize_worktree_path`] 的 WSL / SSH 分支。
fn lexical_normalize_posix(path: &str) -> String {
    let joined = path
        .split('/')
        .filter(|seg| !seg.is_empty() && *seg != ".")
        .collect::<Vec<_>>()
        .join("/");
    if path.starts_with('/') {
        // `/` 本身（或全被裁掉的 `/./`）归一为根：保留「根」这一事实，不返回空串 ——
        // 空串与「没传路径」同形，会让身份与报错信息失去可读性。
        return format!("/{joined}");
    }
    joined
}

// ─── 内部实现 ───────────────────────────────────────────────────────────────

fn lexical_check(rel: &str) -> Result<()> {
    if rel.trim().is_empty() {
        bail!("empty file path");
    }
    if rel.contains('\0') {
        bail!("file path contains NUL byte");
    }
    if rel.starts_with('/') || rel.starts_with('\\') {
        bail!("absolute path is not a repo-relative path");
    }
    // Windows 盘符
    if rel.len() >= 2 && rel.as_bytes()[1] == b':' {
        bail!("absolute path is not a repo-relative path");
    }
    if rel.split(['/', '\\']).any(|seg| seg == "..") {
        bail!("path traversal (`..`) is not allowed");
    }
    Ok(())
}

fn lexical_worktree_check(path: &str) -> Result<()> {
    if path.contains('\0') {
        bail!("worktree path contains NUL byte");
    }
    if path.split(['/', '\\']).any(|seg| seg == "..") {
        bail!("path traversal (`..`) is not allowed in worktree path");
    }
    Ok(())
}

fn canonical_containment_check(
    root: &str,
    canonical_root: &std::path::Path,
    rel: &str,
) -> Result<()> {
    let full = std::path::Path::new(root).join(rel);
    let Some(parent) = full.parent() else {
        return Ok(());
    };
    if !parent.exists() {
        return Ok(());
    }
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| anyhow::anyhow!("invalid parent of `{rel}`: {e}"))?;
    if !canonical_parent.starts_with(canonical_root) {
        bail!("file path is outside the project root");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Local 校验要求项目根真实存在（与生产语义一致：resolve_project 保证根存在）。
    /// 测试统一用 tempdir 代替虚构的 `/tmp/repo`。
    fn temp_root() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("repo");
        std::fs::create_dir_all(&root).unwrap();
        let root = root.to_string_lossy().to_string();
        (dir, root)
    }

    // ── 项目根本身不合法 ─────────────────────────────────────────────────

    #[test]
    fn nonexistent_root_is_rejected_under_local() {
        let t = ExecTarget::Local;
        let err =
            validate_repo_relative_path(&t, "/tmp/definitely-not-neeko-repo", "a.txt").unwrap_err();
        assert!(err.to_string().contains("invalid project root"));
    }

    // ── lexical_check：拒绝 ──────────────────────────────────────────────

    #[test]
    fn rejects_dotdot_traversal() {
        let t = ExecTarget::Local;
        let (_d, root) = temp_root();
        let err = validate_repo_relative_path(&t, &root, "../secret.txt").unwrap_err();
        assert!(err.to_string().contains(".."));

        let err = validate_repo_relative_path(&t, &root, "src/../../etc/passwd").unwrap_err();
        assert!(err.to_string().contains(".."));
    }

    #[test]
    fn rejects_absolute_path() {
        let t = ExecTarget::Local;
        let (_d, root) = temp_root();
        assert!(validate_repo_relative_path(&t, &root, "/etc/passwd").is_err());
        assert!(validate_repo_relative_path(&t, &root, "\\Windows\\system32").is_err());
        assert!(validate_repo_relative_path(&t, &root, "C:\\Windows").is_err());
    }

    #[test]
    fn rejects_empty_and_nul() {
        let t = ExecTarget::Local;
        let (_d, root) = temp_root();
        assert!(validate_repo_relative_path(&t, &root, "").is_err());
        assert!(validate_repo_relative_path(&t, &root, "  ").is_err());
        assert!(validate_repo_relative_path(&t, &root, "a\0b").is_err());
    }

    // ── lexical_check：放行合法相对路径 ──────────────────────────────────

    #[test]
    fn accepts_normal_relative_paths() {
        let t = ExecTarget::Local;
        let (_d, root) = temp_root();
        assert!(validate_repo_relative_path(&t, &root, "src/main.rs").is_ok());
        assert!(validate_repo_relative_path(&t, &root, "a/b/c.txt").is_ok());
        assert!(validate_repo_relative_path(&t, &root, "./x").is_ok());
        assert!(validate_repo_relative_path(&t, &root, "file with space.txt").is_ok());
    }

    // ── canonical containment（Local，父目录存在时）─────────────────────

    #[test]
    fn rejects_symlink_escape_via_canonical_check() {
        let t = ExecTarget::Local;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("repo");
        let outside = dir.path().join("outside");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        // src/link -> outside：词法合法但 canonical 层应拒绝
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, root.join("src/link")).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&outside, root.join("src/link")).unwrap();

        let err = validate_repo_relative_path(&t, root.to_str().unwrap(), "src/link/evil.txt")
            .unwrap_err();
        assert!(err.to_string().contains("outside the project root"));
    }

    #[test]
    fn accepts_existing_file_inside_root() {
        let t = ExecTarget::Local;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("repo");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/main.rs"), "fn main() {}").unwrap();

        assert!(
            validate_repo_relative_path(&t, root.to_str().unwrap(), "src/main.rs").is_ok(),
            "existing in-root file should pass"
        );
    }

    #[test]
    fn skips_canonical_layer_for_nonexistent_file() {
        let t = ExecTarget::Local;
        // 新建文件场景：文件与父目录均不存在，词法层已兜底，不应报错
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("repo");
        std::fs::create_dir_all(&root).unwrap();
        assert!(
            validate_repo_relative_path(&t, root.to_str().unwrap(), "new/nested/file.txt").is_ok()
        );
    }

    // ── 批量校验 ─────────────────────────────────────────────────────────

    #[test]
    fn batch_validation_reports_offending_path() {
        let t = ExecTarget::Local;
        let (_d, root) = temp_root();
        let paths = vec!["ok.txt".to_string(), "../bad.txt".to_string()];
        let err = validate_repo_relative_paths(&t, &root, &paths).unwrap_err();
        assert!(err.to_string().contains("../bad.txt"), "got: {err}");
    }

    #[test]
    fn batch_validation_passes_clean_paths() {
        let t = ExecTarget::Local;
        let (_d, root) = temp_root();
        let paths = vec!["a.txt".to_string(), "src/b.rs".to_string()];
        assert!(validate_repo_relative_paths(&t, &root, &paths).is_ok());
    }

    // ── worktree 路径归一化 ──────────────────────────────────────────────

    #[test]
    fn worktree_rejects_traversal_and_nul() {
        let t = ExecTarget::Local;
        assert!(canonicalize_worktree_path(&t, "/repo/../evil").is_err());
        assert!(canonicalize_worktree_path(&t, "a\0b").is_err());
    }

    #[test]
    fn worktree_allows_outside_root_location() {
        // worktree 允许放在项目根之外（~/.neeko/worktrees/<name>）
        let t = ExecTarget::Local;
        let dir = tempfile::tempdir().unwrap();
        let got = canonicalize_worktree_path(&t, dir.path().to_str().unwrap()).unwrap();
        assert_eq!(
            got,
            dir.path()
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .to_string(),
            "存在的目录必须返回 canonical 形态（而非原串）"
        );
    }

    #[test]
    fn worktree_nonexistent_path_is_lexically_normalized() {
        // create_worktree 场景：路径尚不存在 → 词法归一后放行（不得 canonicalize 失败即拒）
        let t = ExecTarget::Local;
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().canonicalize().unwrap();
        let missing = format!("{}/new-wt/", base.to_string_lossy());
        let got = canonicalize_worktree_path(&t, &missing).unwrap();
        assert_eq!(got, format!("{}/new-wt", base.to_string_lossy()));
    }

    #[test]
    fn symlink_and_trailing_separator_collapse() {
        let t = ExecTarget::Local;
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real");
        std::fs::create_dir_all(&real).unwrap();
        let link = dir.path().join("link");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&real, &link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&real, &link).unwrap();
        assert_eq!(
            canonicalize_worktree_path(&t, &format!("{}/", link.to_string_lossy())).unwrap(),
            canonicalize_worktree_path(&t, &real.to_string_lossy()).unwrap()
        );
    }

    #[test]
    fn worktree_remote_target_skips_local_fs() {
        // WSL/SSH 路径是远端 Linux 路径，不能本地 canonicalize，只做词法归一
        let t = ExecTarget::Remote {
            host: "example.com".to_string(),
            port: 22,
            username: "user".to_string(),
            auth: crate::common::connection::types::AuthMethod::Password("x".to_string()),
        };
        assert_eq!(
            canonicalize_worktree_path(&t, "/home/user/proj/").unwrap(),
            "/home/user/proj"
        );
        assert!(canonicalize_worktree_path(&t, "/home/user/../etc").is_err());
    }

    /// 远端路径的归一结果**必须与宿主 OS 无关**。
    ///
    /// 回归：旧实现把远端路径交给 `PathBuf` 归一，Windows 宿主上 `Path::components("/home/u/p")`
    /// 的 `RootDir` 分量会被 push 成 `\` ⇒ 结果是 `\home\u\p`。身份字符串（`RepoRef::key()`）因此
    /// 跨宿主分叉，且该字符串直接进远端 `git -C` / WSL 登录脚本的 `cd` —— 远端单元直接失效。
    ///
    /// 本用例的断言是**纯字符串语义**（不含路径敏感 API，不硬编码"存在的"宿主路径），
    /// 因此在三端逐字成立；这正是修复的判据本身。
    #[test]
    fn remote_posix_path_is_never_rewritten_with_host_separators() {
        let ssh = ExecTarget::Remote {
            host: "example.com".to_string(),
            port: 22,
            username: "user".to_string(),
            auth: crate::common::connection::types::AuthMethod::Password("x".to_string()),
        };
        let wsl = ExecTarget::Wsl {
            distro: "Ubuntu-22.04".to_string(),
        };
        for t in [&ssh, &wsl] {
            // 前导 `/` 与分段必须是 POSIX 形态（宿主为 Windows 时也不得变 `\`）
            assert_eq!(
                canonicalize_worktree_path(t, "/home/user/proj/.worktrees/dev").unwrap(),
                "/home/user/proj/.worktrees/dev"
            );
            // `.` 与尾分隔符仍按与 Local 相同的语义收敛
            assert_eq!(
                canonicalize_worktree_path(t, "/home/user/proj/./x/").unwrap(),
                "/home/user/proj/x"
            );
            // 相对形态保留相对性（远端 worktree 路径允许相对写法）
            assert_eq!(canonicalize_worktree_path(t, "sub/wt/").unwrap(), "sub/wt");
            // 根仍是根（不塌成空串 —— 空串与「没传路径」同形）
            assert_eq!(canonicalize_worktree_path(t, "/./").unwrap(), "/");
        }
    }
}
