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

/// 校验 worktree 绝对路径。
///
/// - 词法层：拒绝 NUL 与 `..` 分量（允许项目根外的合法位置）。
/// - canonical 层（仅 Local 且路径已存在）：canonicalize 规范化，消除符号链接
///   与 `..` 的二义性。
pub fn validate_worktree_path(target: &ExecTarget, path: &str) -> Result<()> {
    lexical_worktree_check(path)?;
    if matches!(target, ExecTarget::Local) {
        let p = std::path::Path::new(path);
        if p.exists() {
            p.canonicalize()
                .map_err(|e| anyhow::anyhow!("cannot canonicalize worktree path `{path}`: {e}"))?;
        }
    }
    Ok(())
}

/// `resolve_worktree_path` + 校验组合：前端传入的 worktree_path 为空时回落项目根
/// （项目根来自 resolve_project，属受信来源，不再校验）。
pub fn resolve_validated_work_dir<'a>(
    target: &ExecTarget,
    worktree_path: &'a Option<String>,
    wd: &'a str,
) -> Result<&'a str> {
    match worktree_path.as_deref() {
        Some(p) if !p.trim().is_empty() => {
            validate_worktree_path(target, p)?;
            Ok(p)
        }
        _ => Ok(wd),
    }
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

    // ── worktree 路径 ────────────────────────────────────────────────────

    #[test]
    fn worktree_rejects_traversal_and_nul() {
        let t = ExecTarget::Local;
        assert!(validate_worktree_path(&t, "/repo/../evil").is_err());
        assert!(validate_worktree_path(&t, "a\0b").is_err());
    }

    #[test]
    fn worktree_allows_outside_root_location() {
        // worktree 允许放在项目根之外（~/.neeko/worktrees/<name>）
        let t = ExecTarget::Local;
        let dir = tempfile::tempdir().unwrap();
        assert!(validate_worktree_path(&t, dir.path().to_str().unwrap()).is_ok());
    }

    #[test]
    fn worktree_nonexistent_path_passes_lexical_only() {
        // create_worktree 场景：路径尚不存在，词法校验后放行
        let t = ExecTarget::Local;
        assert!(validate_worktree_path(&t, "/tmp/definitely-not-exists-neeko/wt").is_ok());
    }

    #[test]
    fn worktree_remote_target_skips_local_fs() {
        // WSL/SSH 路径是远端 Linux 路径，不能本地 canonicalize
        let t = ExecTarget::Remote {
            host: "example.com".to_string(),
            port: 22,
            username: "user".to_string(),
            auth: crate::common::connection::types::AuthMethod::Password("x".to_string()),
        };
        assert!(validate_worktree_path(&t, "/home/user/proj").is_ok());
    }

    // ── resolve_validated_work_dir ───────────────────────────────────────

    #[test]
    fn resolves_empty_worktree_to_root() {
        let t = ExecTarget::Local;
        assert_eq!(
            resolve_validated_work_dir(&t, &None, "/repo").unwrap(),
            "/repo"
        );
        assert_eq!(
            resolve_validated_work_dir(&t, &Some(String::new()), "/repo").unwrap(),
            "/repo"
        );
        assert_eq!(
            resolve_validated_work_dir(&t, &Some("   ".to_string()), "/repo").unwrap(),
            "/repo"
        );
    }

    #[test]
    fn resolves_valid_worktree() {
        let t = ExecTarget::Local;
        let dir = tempfile::tempdir().unwrap();
        let wt = dir.path().to_str().unwrap().to_string();
        assert_eq!(
            resolve_validated_work_dir(&t, &Some(wt.clone()), "/repo").unwrap(),
            wt
        );
    }

    #[test]
    fn rejects_traversal_worktree() {
        let t = ExecTarget::Local;
        assert!(resolve_validated_work_dir(&t, &Some("../evil".to_string()), "/repo").is_err());
    }
}
