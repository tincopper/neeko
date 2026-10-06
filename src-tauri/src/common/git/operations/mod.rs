//! High-level git operations (push, pull, clone, etc.) using the transport abstraction.
//!
//! 按 services.rs 模式拆分：`operations.rs` 原为 2400+ 行 God File，违反高内聚低耦合。
//! 现按职责拆为子模块；`mod.rs` 仅保留 mod 声明与 pub use（AGENTS.md 规则 #9）。

mod support;

/// 分支：切换 / 创建 / 删除 / 重命名 / detached checkout。
pub mod branch;
/// 提交与历史改写：提交选中文件、cherry-pick、revert、打 tag。
pub mod commit;
/// Diff 读取：staged / 单文件 / 变更统计。
pub mod diff;
pub mod discard;
/// 文件 / status 查询（porcelain 单一引擎）与近期提交消息。
pub mod files;
/// 仓库信息（分支、provider 检测）。
pub mod info;
/// 提交历史与 ahead-behind。
pub mod log;
/// 暂存区：stage / unstage（单文件与全量）。
pub mod stage;
/// Stash 栈操作。
pub mod stash;
/// 远端同步（fetch / pull / push）。
pub mod sync;
/// Linked worktree 管理。
pub mod worktree;

pub(crate) use support::invalidate_caches;
pub use support::resolve_worktree_path;

pub use branch::*;
pub use commit::*;
pub use diff::*;
pub use discard::*;
pub use files::*;
pub use info::*;
pub use log::*;
pub use stage::*;
pub use stash::*;
pub use sync::*;
pub use worktree::*;

#[cfg(test)]
mod tests;
