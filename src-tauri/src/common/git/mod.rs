//! Git operations, caching, credential management, transport abstraction,
//! PR provider integration, and status-watching utilities.

pub mod cache;
/// Workspace路径（身份 / 执行双渲染，红线 12）。
pub mod checkout_path;
/// Git 冲突读路径的纯语义层（index unmerged stages 真值 + 载荷预算）。
pub mod conflict;
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
pub mod status_worker;
pub mod transport;
pub mod types;
/// 执行地址的单元归属（哪个 Workspace 单元拥有某个目录）。
pub mod unit_scope;
/// 仓库工作树身份（git 状态的唯一寻址单位）。
pub mod workspace_ref;
/// WSL-specific git operations and IDE launch helpers.
#[cfg(target_os = "windows")]
pub mod wsl;

pub use cache::*;
pub use checkout_path::CheckoutPath;
pub use conflict::types::{
    ConflictKind, ConflictResolution, ConflictSide, ConflictStages, MergeRegion, RegionTake,
    TakeSide,
};
pub use parsers::*;
pub use pr::*;
pub use provider::*;
pub use refs::*;
pub use types::*;
pub use unit_scope::{PathAlphabet, UnitScope};
pub use workspace_ref::{Checkout, WorkspaceRef, WorkspaceSession};
#[cfg(target_os = "windows")]
pub use wsl::*;
