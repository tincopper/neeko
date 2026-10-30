//! MCP 工具面 —— 工具清单（[`schema`]）+ 调用调度（[`dispatch`]）。
//!
//! 本目录只做「模型说要做 X」到「`TeamManager` 的方法」之间的翻译、授权与入参校验。
//! 唯一会**阻塞**的工具是 `team_wait`（P2.4）：它的等待循环在
//! [`crate::agent::team::wait`]，本目录只负责入参校验与把结局包成 [`ToolReply::Wait`]。
//! 传输分两半：[`server`] 是**已落地**的 HTTP/JSON-RPC 端点（`POST /team/mcp`，独立 listener
//! 由组合根起）；stdio bridge 仍未落。身份**签发**在 `identity::token`，本目录只做**解析后的
//! 使用**（`server::authenticate`）。PTY 投递属 P2.5。
//!
//! # 两个入口（同步 / 异步）是刻意的
//!
//! [`call`] 拒绝 `team_wait`（要阻塞就得 `.await`），[`call_async`] 负责它；两者共用
//! **同一份**翻译、授权与同步分支 —— 复制第二份授权矩阵会让「worker 能不能调 X」出现两个答案。

pub mod dispatch;
pub mod schema;
pub mod server;

pub use dispatch::{
    call_async, MemberStatusView, TeamStatusView, ToolReply, DEFAULT_LEASE_TTL_SECS,
    WAIT_TIMEOUT_MAX_SECS,
};
pub use schema::{
    known_wires, lookup, spec_for, ToolName, ToolSpec, ALL_TOOL_NAMES, TOOLS, UPDATABLE_STATES,
};
