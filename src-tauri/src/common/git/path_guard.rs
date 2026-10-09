//! Git 路径安全校验（AGENTS.md 红线 8：前端传入的路径在 Rust 端消费前必须校验）。
//!
//! 两类路径、两种策略：
//! 1. **仓库内相对路径**（stage/unstage/discard/diff 的 `file_path`）：必须落在
//!    项目根之内 —— 词法拒绝 `..` 分量 + Local 下 canonicalize 前缀校验（参照
//!    `common/file/services.rs` 的既有范式）。
//! 2. **worktree 绝对路径**：由用户自选位置（可在项目根之外，如
//!    `~/.neeko/worktrees/<name>`），不能强制 containment；做词法校验（拒绝
//!    `..` 分量与 NUL）。
//!
//! WSL/SSH 路径是远端 Linux 路径，无法本地 canonicalize，仅做词法校验。
//!
//! **本模块只负责「校验」**：归一化与身份（identity / exec 双渲染）在
//! [`crate::common::git::checkout_path`]。校验与归一分开是有意的 —— 校验的判据是「能不能安全消费」，
//! 归一的判据是「是不是同一个对象」，两者的例外集不同（例如不存在的路径归一是合法的，
//! 但不能假设它可被消费）。

use anyhow::{bail, Result};

/// 校验仓库内相对路径，防止 `..` 穿越。
///
/// - 词法层（所有 ExecTarget）：拒绝空路径、NUL、绝对路径、含 `..` 分量。
/// - canonical 层（仅 Local，且父目录存在时）：canonicalize 后必须位于
///   canonicalize(项目根) 之内。文件可能尚不存在（新建文件场景），此时跳过
///   canonical 层（词法层已兜底）。
pub fn validate_repo_relative_path(
    target: &crate::common::executor::factory::ExecTarget,
    root: &str,
    rel: &str,
) -> Result<()> {
    lexical_check(rel)?;
    if matches!(target, crate::common::executor::factory::ExecTarget::Local) {
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
    target: &crate::common::executor::factory::ExecTarget,
    root: &str,
    paths: &[String],
) -> Result<()> {
    let canonical_root = if matches!(target, crate::common::executor::factory::ExecTarget::Local) {
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

/// worktree 路径的词法校验（所有 ExecTarget）：拒绝 NUL 与 `..` 分量。
///
/// 只做「分量恰好等于 `..`」的判定：`a..b` / `..name` 是合法文件名，不得误杀。
/// 这里是 [`crate::common::git::checkout_path::CheckoutPath::resolve`] 的第一道闸门。
pub(crate) fn lexical_worktree_check(path: &str) -> Result<()> {
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
    use crate::common::executor::factory::ExecTarget;

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

    // ── worktree 词法校验（归一前的第一道闸门）───────────────────────────

    #[test]
    fn worktree_lexical_check_rejects_traversal_and_nul() {
        assert!(lexical_worktree_check("/repo/../evil").is_err());
        assert!(lexical_worktree_check("C:\\repo\\..\\evil").is_err());
        assert!(lexical_worktree_check("a\0b").is_err());
    }

    #[test]
    fn worktree_lexical_check_does_not_kill_legitimate_dot_names() {
        // 只有「分量恰好等于 `..`」才是穿越：`a..b` / `..name` 是合法文件名
        assert!(lexical_worktree_check("/repo/a..b").is_ok());
        assert!(lexical_worktree_check("/repo/..name").is_ok());
        assert!(lexical_worktree_check("/repo/.hidden").is_ok());
    }
}
