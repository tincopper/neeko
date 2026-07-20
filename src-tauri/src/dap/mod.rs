//! Debug Adapter Protocol support.
//!
//! Layered design (high cohesion / low coupling):
//!
//! ```text
//! commands  →  manager  →  session
//!                            ├─ adapter/*   (language plugins, ExecTarget-aware)
//!                            ├─ process     (spawn via core::exec only)
//!                            ├─ transport   (stdio / TCP listen)
//!                            ├─ client      (DAP request/response)
//!                            └─ protocol    (Content-Length framing)
//! ```
//!
//! All process existence checks and spawns go through [`crate::core::exec`]
//! with the project [`ExecTarget`] — never host-only shortcuts.

pub mod adapter;
pub mod client;
pub mod commands;
pub mod config;
pub mod discover;
pub mod manager;
pub mod process;
pub mod protocol;
pub mod session;
pub mod transport;
pub mod types;

pub use manager::DapManager;
