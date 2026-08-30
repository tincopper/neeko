//! Unified file reading core: one `read_file` with an explicit access scope,
//! parameterized channel (`ExecTarget`) and guards.
//!
//! 三个历史读取入口（`read_file_content` / `read_file_blocking` /
//! `lsp_read_preauthorized_file`）的差异只有三个维度：安全边界（scope）、
//! 目标机器（ExecTarget）、防护参数（大小上限/二进制检测）。本模块将其
//! 参数化为单一实现，调用方各自保留对外契约（IPC 命令名不变）。
//!
//! 安全边界：
//! - `InProject`：canonicalize 后必须位于 root 之内（防路径穿越，pillar 8）；
//! - `Trusted`：调用方已完成授权/信任校验（LSP 授权白名单、后端内部信任链），
//!   reader 仍执行 canonicalize（防 symlink）与可选大小上限——fail-closed。
//!
//! 行为保持说明：WSL/Remote 通道的 `InProject` 沿用现状（无远程 root 强校验），
//! 补齐远程 `realpath` 校验单独立项。

use std::path::{Path, PathBuf};

use crate::common::executor::factory::ExecTarget;
use crate::common::executor::sync::exec_on;
use crate::common::utils::command::local::safe_path;
use crate::project::types::FileContent;
use crate::AppError;

/// 访问策略：决定 scope 校验的强度。
#[derive(Debug, Clone)]
pub enum FileAccessScope {
    /// 项目根内：canonicalize 后必须位于 root 之内。
    InProject {
        /// 项目根（canonicalize 前的原始路径亦可，reader 内部会 canonicalize）。
        root: PathBuf,
    },
    /// 信任通道：调用方已完成授权/信任校验，reader 仅做 canonicalize 与防护。
    Trusted,
}

/// 读取请求。`base`/`path` 拼接规则与既有 services 逐字一致：
/// Local 为 `Path::join`（绝对 path 自动替换 base），shell 为 `{base}/{path}`。
#[derive(Clone)]
pub struct FileReadRequest {
    /// 目标执行环境（决定 fs / shell 通道）。
    pub target: ExecTarget,
    /// 基准目录（相对 path 的拼接基准；空字符串 = path 为完整路径）。
    pub base: String,
    /// 相对 base 的文件路径，或完整路径。
    pub path: String,
    /// 大小上限（字节）；超限报 `AppError::File`。None = 不限。
    pub max_bytes: Option<u64>,
    /// 二进制检测：命中 NUL 字节时返回空 content（不向调用方泄二进制乱码）。
    pub detect_binary: bool,
}

/// 统一文件读取核心。Local 走 `std::fs`（spawn_blocking 隔离），
/// WSL/Remote 走 shell（stat + cat，经统一 exec 通道）。
pub async fn read_file(
    scope: FileAccessScope,
    req: FileReadRequest,
) -> Result<FileContent, AppError> {
    match req.target {
        ExecTarget::Local => {
            let FileReadRequest {
                base,
                path,
                max_bytes,
                detect_binary,
                ..
            } = req;
            tokio::task::spawn_blocking(move || {
                read_file_local_blocking(&scope, &base, &path, max_bytes, detect_binary)
            })
            .await
            .map_err(|e| AppError::File(format!("file read join error: {e}")))?
        }
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => read_file_shell(scope, req).await,
    }
}

/// Local 通道阻塞实现（仅由 `spawn_blocking` 调用）。
fn read_file_local_blocking(
    scope: &FileAccessScope,
    base: &str,
    path: &str,
    max_bytes: Option<u64>,
    detect_binary: bool,
) -> Result<FileContent, AppError> {
    let full = join_path(base, path);
    let canonical =
        std::fs::canonicalize(&full).map_err(|e| AppError::File(format!("Invalid path: {}", e)))?;
    apply_scope(&canonical, scope)?;

    let size = std::fs::metadata(&canonical)
        .map_err(|e| AppError::File(format!("Failed to read metadata: {}", e)))?
        .len();
    if let Some(cap) = max_bytes {
        if size > cap {
            return Err(AppError::File(format!(
                "File size {size} exceeds the {cap} byte limit"
            )));
        }
    }

    let is_binary = detect_binary && is_binary_file(&canonical)?;
    let content = if is_binary {
        String::new()
    } else {
        std::fs::read_to_string(&canonical)
            .map_err(|e| AppError::File(format!("Failed to read file: {}", e)))?
    };

    Ok(FileContent {
        path: path.to_string(),
        content,
        size,
        is_binary,
    })
}

/// WSL/Remote 通道：stat 拿大小、（可选）head 检测二进制、cat 读内容。
async fn read_file_shell(
    scope: FileAccessScope,
    req: FileReadRequest,
) -> Result<FileContent, AppError> {
    let full = join_path(&req.base, &req.path);
    let safe = safe_path(full.to_string_lossy().as_ref());
    let shell = match req.target {
        ExecTarget::Wsl { .. } => "bash",
        _ => "sh",
    };

    // scope 校验：Trusted 信任调用方；InProject 的远程 root 校验为已知欠账
    //（现状 read_file_content_shell 同样没有），补齐需远程 realpath，单独立项。
    let _ = scope;

    let size: u64 = exec_on(
        &req.target,
        shell,
        &[
            "-c",
            &format!("stat -c '%s' '{safe}' 2>/dev/null || echo 0"),
        ],
    )
    .await
    .ok()
    .and_then(|s| s.trim().parse().ok())
    .unwrap_or(0);
    if let Some(cap) = req.max_bytes {
        if size > cap {
            return Err(AppError::File(format!(
                "File size {size} exceeds the {cap} byte limit"
            )));
        }
    }

    let is_binary = if req.detect_binary {
        let cmd =
            format!("head -c 8192 '{safe}' | grep -ql '\\x00' 2>/dev/null && echo 1 || echo 0");
        exec_on(&req.target, shell, &["-c", &cmd])
            .await
            .map(|out| out.trim() == "1")
            .unwrap_or(false)
    } else {
        false
    };

    let content = if is_binary {
        String::new()
    } else {
        exec_on(&req.target, shell, &["-c", &format!("cat '{safe}'")])
            .await
            .map_err(|e| AppError::File(format!("Failed to read file content: {}", e)))?
    };

    Ok(FileContent {
        path: req.path.clone(),
        content,
        size,
        is_binary,
    })
}

/// 与既有 services 逐字一致的路径拼接（Local join / shell 字符串拼接）。
fn join_path(base: &str, path: &str) -> PathBuf {
    if base.is_empty() {
        PathBuf::from(path)
    } else {
        Path::new(base).join(path)
    }
}

fn apply_scope(canonical: &Path, scope: &FileAccessScope) -> Result<(), AppError> {
    match scope {
        FileAccessScope::InProject { root } => {
            let canonical_root = root
                .canonicalize()
                .map_err(|e| AppError::File(format!("Invalid root path: {}", e)))?;
            if !canonical.starts_with(&canonical_root) {
                return Err(AppError::File("Path is outside root directory".to_string()));
            }
            Ok(())
        }
        FileAccessScope::Trusted => Ok(()),
    }
}

fn is_binary_file(path: &Path) -> Result<bool, AppError> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)
        .map_err(|e| AppError::File(format!("Failed to open file: {}", e)))?;
    let mut buffer = vec![0u8; 8192];
    let bytes_read = file
        .read(&mut buffer)
        .map_err(|e| AppError::File(e.to_string()))?;
    Ok(buffer[..bytes_read].contains(&0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn local_target() -> ExecTarget {
        ExecTarget::Local
    }

    fn req(path: &Path, max_bytes: Option<u64>, detect_binary: bool) -> FileReadRequest {
        FileReadRequest {
            target: local_target(),
            base: String::new(),
            path: path.to_string_lossy().to_string(),
            max_bytes,
            detect_binary,
        }
    }

    struct Fixture {
        _dir: TempDir,
        root: PathBuf,
        outside: PathBuf,
    }

    fn fixture() -> Fixture {
        // root 与 outside 同 TempDir 但分离目录：并行测试安全，且 outside 确在 root 外
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("root");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("inner.rs"), "fn main() {}\n").unwrap();
        fs::write(root.join("bin.dat"), [0u8, 1, 2, 0, 3]).unwrap();
        let outside_dir = dir.path().join("outside");
        fs::create_dir_all(&outside_dir).unwrap();
        fs::write(outside_dir.join("outer.rs"), "outside").unwrap();
        Fixture {
            _dir: dir,
            root,
            outside: outside_dir.join("outer.rs"),
        }
    }

    #[tokio::test]
    async fn in_project_reads_file_within_root() {
        let fx = fixture();
        let out = read_file(
            FileAccessScope::InProject {
                root: fx.root.clone(),
            },
            req(&fx.root.join("inner.rs"), None, true),
        )
        .await
        .unwrap();
        assert_eq!(out.content, "fn main() {}\n");
        assert!(!out.is_binary);
    }

    #[tokio::test]
    async fn in_project_rejects_path_outside_root() {
        let fx = fixture();
        let err = read_file(
            FileAccessScope::InProject {
                root: fx.root.clone(),
            },
            req(&fx.outside, None, true),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::File(ref m) if m.contains("outside root")));
    }

    #[tokio::test]
    async fn trusted_reads_outside_root_without_root_check() {
        let fx = fixture();
        let out = read_file(FileAccessScope::Trusted, req(&fx.outside, None, true))
            .await
            .unwrap();
        assert_eq!(out.content, "outside");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn trusted_still_canonicalizes_symlink() {
        let fx = fixture();
        std::os::unix::fs::symlink(fx.root.join("inner.rs"), fx.root.join("link.rs")).unwrap();
        let out = read_file(
            FileAccessScope::Trusted,
            req(&fx.root.join("link.rs"), None, true),
        )
        .await
        .unwrap();
        assert_eq!(out.content, "fn main() {}\n");
    }

    #[tokio::test]
    async fn max_bytes_caps_read() {
        let fx = fixture();
        let err = read_file(
            FileAccessScope::Trusted,
            req(&fx.root.join("inner.rs"), Some(4), false),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::File(ref m) if m.contains("exceeds")));
    }

    #[tokio::test]
    async fn detect_binary_returns_empty_content_for_binary_file() {
        let fx = fixture();
        let out = read_file(
            FileAccessScope::Trusted,
            req(&fx.root.join("bin.dat"), None, true),
        )
        .await
        .unwrap();
        assert!(out.is_binary);
        assert_eq!(out.content, "");
    }

    #[tokio::test]
    async fn detect_binary_off_reads_binary_as_text() {
        let fx = fixture();
        let out = read_file(
            FileAccessScope::Trusted,
            req(&fx.root.join("bin.dat"), None, false),
        )
        .await
        .unwrap();
        assert!(out.content.contains('\u{0}'));
        assert!(!out.is_binary);
    }

    #[tokio::test]
    async fn missing_file_is_file_error() {
        let fx = fixture();
        let err = read_file(
            FileAccessScope::InProject {
                root: fx.root.clone(),
            },
            req(&fx.root.join("missing.rs"), None, true),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, AppError::File(_)));
    }

    #[tokio::test]
    async fn base_relative_path_resolves_against_base() {
        let fx = fixture();
        let out = read_file(
            FileAccessScope::InProject {
                root: fx.root.clone(),
            },
            FileReadRequest {
                target: local_target(),
                base: fx.root.to_string_lossy().to_string(),
                path: "inner.rs".to_string(),
                max_bytes: None,
                detect_binary: false,
            },
        )
        .await
        .unwrap();
        assert_eq!(out.content, "fn main() {}\n");
    }
}
