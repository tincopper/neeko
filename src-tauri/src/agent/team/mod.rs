//! 团队域（协调基质）—— 见 `agent/team/`。
//!
//! P1 落地数据模型、租约、完成判定、store / manager；P2.1 落地身份 token 与工具面
//! （[`authorize`] 授权矩阵 + [`mcp`] 工具清单与调度）；P2.4 落地后端阻塞等待
//! （[`wait`]，`team_wait` 的实现）；P2.5a 落地准入表（[`admission`]，红线 15 的落点）
//! 与 `team_spawn` 的**决策部分**；P2.5b-α 落地成员投递入口（[`deliver`]，hooks 的第三路
//! 消费者）。传输（团队 MCP 独立 listener / stdio bridge）不在本目录。

pub mod admission;
pub mod authorize;
pub mod boot;
pub mod bootstrap;
pub mod commands;
pub mod completion;
pub mod deliver;
pub mod delivery;
pub mod execution;
#[cfg(test)]
pub(crate) mod fixtures;
pub mod identity;
pub mod lease;
pub mod manager;
pub mod mcp;
pub mod observe;
pub mod reaper;
pub mod sentinel;
pub mod store;
pub mod types;
pub mod wait;

pub use admission::{admission_for, refusal, tier_of, AgentAdmission, McpTransport, ADMISSIONS};
pub use authorize::authorize;
pub use boot::{boot as boot_endpoint, endpoint_url, TeamServer, TeamSurface};
pub use completion::advance;
pub use execution::{apply_reply, plan_member_spawn, MemberExecutor, SpawnPlan};
pub use lease::{lease_expired, next_reclaim_count, should_auto_release};
pub use manager::{TeamManager, TeamWake};
pub use store::{TeamEventRecord, TeamStore};
pub use wait::{
    satisfied, WaitMemberRow, WaitOutcome, WaitSnapshot, WaitTargets, WaitTaskRow, WaitUntil,
};

// 时间驱动的团队迁移（租约回收）：与上面的纯函数 / 数据 re-export 不同，它是一个**后台循环**，
// 调用方只需要 start / stop 两个入口。单独成块而不是挤进上面那串，是让「谁在后台跑」在
// 模块门口一眼可见 —— 读 `mod.rs` 的人应该在 10 秒内知道本域有一个常驻任务。
pub use reaper::{TeamReaper, REAP_INTERVAL};
