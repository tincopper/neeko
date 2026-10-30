//! 团队域（协调基质）—— 见 `agent/team/`。
//!
//! 状态机只有一个写入口（[`TeamManager`]），迁移规则是纯函数（[`completion`]），
//! 租约算术是纯函数（[`lease`]），持久化在 [`store`]。数据形状全在 [`types`]。
//!
//! 本文件只做声明与 re-export（红线 9）。

pub mod completion;
pub mod lease;
pub mod manager;
pub mod store;
pub mod types;

pub use completion::advance;
pub use lease::{lease_expired, next_reclaim_count, should_auto_release};
pub use manager::{TeamManager, TeamWake};
pub use store::{TeamEventRecord, TeamStore};
