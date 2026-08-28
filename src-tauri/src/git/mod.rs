//! Git operations module: Tauri command handlers and commit agent services.

/// Tauri command handlers for Git operations.
pub mod commands;
/// Commit agent integration services.
pub mod services;

// Re-export from common::git for backward compatibility.
// 显式列出（不再 glob）：门面只暴露真实有调用方的符号，避免 local（git2 本地
// 实现）与 operations（transport 实现）同名函数二义性 —— 曾导致调用方误选实现。
pub use crate::common::git::cache::invalidate_repo_caches;
pub use crate::common::git::local::{
    get_changed_files_diff_stats, get_file_diff, get_git_info, is_git_repo,
};
pub use crate::common::git::parsers::*;
pub use crate::common::git::pr::*;
pub use crate::common::git::refs::*;
pub use crate::common::git::remote::*;
pub use crate::common::git::types::*;
#[cfg(target_os = "windows")]
pub use crate::common::git::wsl::*;
