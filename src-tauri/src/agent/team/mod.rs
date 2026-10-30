//! 团队域（协调基质）—— 见 `agent/team/`。
//!
//! P1 落地数据模型、租约、完成判定、store / manager；P2.1 落地身份 token 与工具面
//! （[`authorize`] 授权矩阵 + [`mcp`] 工具清单与调度）；P2.4 落地后端阻塞等待
//! （[`wait`]，`team_wait` 的实现）。传输（stdio bridge）与成员投递不在本目录。

pub mod authorize;
pub mod completion;
pub mod identity;
pub mod lease;
pub mod manager;
pub mod mcp;
pub mod observe;
pub mod sentinel;
pub mod store;
pub mod types;
pub mod wait;

pub use authorize::authorize;
pub use completion::advance;
pub use lease::{lease_expired, next_reclaim_count, should_auto_release};
pub use manager::{TeamManager, TeamWake};
pub use store::{TeamEventRecord, TeamStore};
pub use wait::{
    satisfied, WaitMemberRow, WaitOutcome, WaitSnapshot, WaitTargets, WaitTaskRow, WaitUntil,
};
