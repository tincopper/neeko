//! Debug Adapter Protocol support.
//!
//! Layered design (high cohesion / low coupling):
//!
//! ```text
//! commands  →  manager  →  session
//!     └──→ launch_support ←──┘        (shared launch helpers, no layer deps)
//!                            ├─ adapter/*   (language plugins, ExecTarget-aware)
//!                            ├─ process     (spawn via core::exec only)
//!                            ├─ transport   (stdio / TCP listen)
//!                            ├─ client      (DAP request/response)
//!                            └─ protocol    (Content-Length framing)
//! ```
//!
//! `commands`（控制层）与 `manager`（编排层）共用 `launch_support` 的纯逻辑，
//! 二者都依赖它 —— 编排层不得反向依赖控制层。
//!
//! All process existence checks and spawns go through [`crate::core::exec`]
//! with the project [`ExecTarget`] — never host-only shortcuts.

pub mod adapter;
pub mod cleanup;
pub mod client;
pub mod commands;
pub mod config;
pub mod discover;
pub mod events;
mod java_debuggee;
mod launch_support;
pub mod manager;
pub mod process;
pub mod protocol;
pub mod session;
pub mod transport;
pub mod types;

pub use manager::DapManager;
