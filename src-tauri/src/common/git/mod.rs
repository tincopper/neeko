//! Git operations, caching, credential management, transport abstraction,
//! PR provider integration, and status-watching utilities.

pub mod cache;
pub mod credential;
pub mod gh;
pub mod local;
pub mod operations;
pub mod parsers;
pub mod path_guard;
pub mod perf;
pub mod pr;
pub mod provider;
pub mod refs;
/// 仓库工作树身份（git 状态的唯一寻址单位）。
pub mod repo_ref;
pub mod status_worker;
pub mod transport;
pub mod types;
/// 仓库单元路径（身份 / 执行双渲染，红线 12）。
pub mod unit_path;
/// WSL-specific git operations and IDE launch helpers.
#[cfg(target_os = "windows")]
pub mod wsl;

pub use cache::*;
pub use parsers::*;
pub use pr::*;
pub use provider::*;
pub use refs::*;
pub use repo_ref::{RepoRef, WorktreeRef};
pub use types::*;
pub use unit_path::UnitPath;
#[cfg(target_os = "windows")]
pub use wsl::*;
