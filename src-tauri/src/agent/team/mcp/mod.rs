//! MCP 工具面 —— 工具清单（[`schema`]）+ 调用调度（[`dispatch`]）。
//!
//! 本目录只做「模型说要做 X」到「`TeamManager` 的方法」之间的翻译、授权与入参校验。
//! 唯一会**阻塞**的工具是 `team_wait`（P2.4）：它的等待循环在
//! [`crate::agent::team::wait`]，本目录只负责入参校验与把结局包成 [`ToolReply::Wait`]。
//! 传输是 HTTP/JSON-RPC 端点（`POST /team/mcp`）：[`server`] 提供路由组与鉴权
//! （`server::route_group`），组合根在启动序列经 [`crate::agent::team::boot_endpoint`]
//! 把它 mount 到**独立 loopback listener**（`app/boot.rs`；为什么与 hooks 分开端口、
//! 门的活集合与凭证形状，见 `team-domain.md` §2.3）。stdio bridge **刻意不落**——
//! `admission::McpTransport` 的变体集合就是本仓已实现的传输集合（红线 14）。
//! 身份**签发**在 `identity::token`，本目录只做**解析后的使用**（`server::authenticate`）。
//!
//! # 生产入口只有 [`call_async`]
//!
//! 同步的 `dispatch::call` 是 `#[cfg(test)]`：它能在 async 上下文里被直接调用，留着就是
//! 「把 SQLite 写回 tokio worker」的后门（红线 3）。测试需要同步入口，生产不需要。
//!
//! [`call_async`] 同时负责两件事：`team_wait` 走 `.await`（它的循环只读内存快照），
//! 其余工具进阻塞池（它们是唯一写库的一类）。两条分支共用**同一份**翻译、授权与入参校验
//! —— 复制第二份授权矩阵会让「worker 能不能调 X」出现两个答案。

pub mod dispatch;
pub mod principals;
pub mod protocol;
pub mod schema;
pub mod server;

pub use dispatch::{call_async, ToolReply, DEFAULT_LEASE_TTL_SECS, WAIT_TIMEOUT_MAX_SECS};
// 视图属于团队域（[`crate::agent::team::view`]），MCP 只是**读者**之一。这里 re-export 是
// 为了让既有调用点不必知道它搬过家 —— 构造点仍然只有 `view` 那一处（本地命令共用同一个）。
pub use crate::agent::team::view::{MemberStatusView, TeamStatusView};
pub use principals::{principals_from, token_hashes};
pub use protocol::{ENDPOINT_PATH, TOKEN_HEADER};
pub use schema::{
    known_wires, lookup, spec_for, ToolName, ToolSpec, ALL_TOOL_NAMES, TOOLS, UPDATABLE_STATES,
};
