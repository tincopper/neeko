//! 团队域（协调基质）—— 见 `agent/team/`。
//!
//! P1 落地数据模型、租约、完成判定、store / manager；P2.1 落地身份 token 与工具面
//! （[`authorize`] 授权矩阵 + [`mcp`] 工具清单与调度）；P2.4 落地后端阻塞等待
//! （[`wait`]，`team_wait` 的实现）；P2.5a 落地准入表（[`admission`]，红线 15 的落点）
//! 与 `team_spawn` 的**决策部分**；P2.5b-α 落地成员投递入口（[`deliver`]，hooks 的第三路
//! 消费者）。P3.1（可观测）落地前端失效脉冲（[`events`]）与**只读视图的唯一构造点**
//! （[`view`]，MCP `team_status` 与本地命令共用一个）。传输（团队 MCP 独立 listener /
//! stdio bridge）不在本目录。

pub mod admission;
pub mod authorize;
pub mod boot;
pub mod bootstrap;
pub mod commands;
pub mod completion;
pub mod deliver;
pub mod delivery;
pub mod events;
pub mod execution;
#[cfg(test)]
pub(crate) mod fixtures;
pub mod identity;
pub mod lease;
pub mod manager;
pub mod mcp;
pub mod observe;
pub mod options;
pub mod reaper;
pub mod sentinel;
pub mod store;
pub mod types;
pub mod view;
pub mod wait;

pub use admission::{
    admission_for, admitted_agent_ids, launchable_agents, needs_credentials_env, refusal,
    render_argv, tier_of, AgentAdmission, ConfigDirSpec, LaunchableAgent, McpTransport,
    RenderContext, ADMISSIONS,
};
pub use authorize::authorize;
pub use boot::{boot as boot_endpoint, endpoint_url, TeamServer, TeamSurface};
pub use completion::advance;
pub use events::{TeamNotifier, TeamPulse, TEAM_EVENT};
pub use execution::{apply_reply, plan_member_spawn, ConfigDirPlan, MemberExecutor, SpawnPlan};
pub use lease::{lease_expired, next_reclaim_count, should_auto_release};
pub use manager::{TeamManager, TeamWake};
pub use options::{default_options, options_for, TeamDefaults, TeamOptions};
pub use store::{TeamEventRecord, TeamStore};
pub use view::{
    MemberStatusView, TaskCard, TaskDetail, TeamSnapshot, TeamStatusView, MAX_BOARD_TASKS,
};
pub use wait::{
    satisfied, WaitMemberRow, WaitOutcome, WaitSnapshot, WaitTargets, WaitTaskRow, WaitUntil,
};

// 时间驱动的团队迁移（租约回收）：与上面的纯函数 / 数据 re-export 不同，它是一个**后台循环**，
// 调用方只需要 start / stop 两个入口。单独成块而不是挤进上面那串，是让「谁在后台跑」在
// 模块门口一眼可见 —— 读 `mod.rs` 的人应该在 10 秒内知道本域有一个常驻任务。
pub use reaper::{TeamReaper, REAP_INTERVAL};
