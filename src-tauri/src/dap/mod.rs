//! Debug Adapter Protocol support.
//!
//! Layered design (high cohesion / low coupling):
//!
//! ```text
//! commands  →  manager  →  session
//!     ├──→ build (无头构建服务：校验 + 执行 + 双流截断)
//!     └──→ launch_support ←──┘        (shared launch helpers, no layer deps)
//!                            ├─ adapter/*   (language plugins, ExecTarget-aware)
//!                            ├─ process     (spawn via core::exec only)
//!                            ├─ transport   (stdio / TCP listen)
//!                            ├─ client      (DAP request/response)
//!                            └─ protocol    (Content-Length framing)
//! ```
//!
//! `commands`（控制层）只做参数接收 + 调度：会话/断点/配置编排在 `manager`，无头
//! 构建在 `build`，二者共用 `launch_support` 的纯逻辑 —— 编排层不得反向依赖控制层。
//!
//! All process existence checks and spawns go through [`crate::core::exec`]
//! with the project [`ExecTarget`] — never host-only shortcuts.

pub mod adapter;
mod build;
pub mod cleanup;
pub mod client;
pub mod commands;
pub mod config;
pub mod discover;
pub mod events;
mod external_source;
mod launch_support;
pub mod manager;
pub mod process;
pub mod protocol;
pub mod session;
pub mod transport;
pub mod types;

pub use manager::DapManager;
