//! High-level git operations (push, pull, clone, etc.) using the transport abstraction.
//!
//! 按 services.rs 模式拆分：`operations.rs` 原为 2400+ 行 God File，违反高内聚低耦合。
//! 现按职责拆为子模块；`mod.rs` 仅保留 mod 声明与 pub use（AGENTS.md 规则 #9）。

mod support;

pub mod branch;
pub mod commit;
pub mod diff;
pub mod files;
pub mod info;
pub mod log;
pub mod stage;
pub mod stash;
pub mod sync;
pub mod worktree;

pub use support::resolve_worktree_path;
pub(crate) use support::{invalidate_caches, readonly_opts, READONLY_ENV};

pub use branch::*;
pub use commit::*;
pub use diff::*;
pub use files::*;
pub use info::*;
pub use log::*;
pub use stage::*;
pub use stash::*;
pub use sync::*;
pub use worktree::*;

#[cfg(test)]
mod tests;
