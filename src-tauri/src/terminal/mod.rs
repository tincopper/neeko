//! Terminal session and PTY management.

pub mod commands;
pub mod manager;
/// Process-tree reaping for PTY sessions (Unix).
pub mod process_reaper;
/// Bounded coalescing output pump (memory governance, see task
/// 08-25-terminal-memory-governance).
pub mod pump;
/// SSH remote terminal management (moved from `common::terminal::remote`
/// to its owning domain `terminal`).
pub mod remote;
/// 会话路由：按会话归属把操作分派到本地 PTY / SSH 后端（域私有路由表）。
pub mod router;
/// PTY creation, pipeline spawning, and terminal utilities.
pub mod services;

pub use crate::common::terminal::types::*;
pub use manager::TerminalManager;
#[allow(unused_imports)]
pub(crate) use manager::{
    PipelineConfig, PtyHandle, TerminalClosedPayload, PTY_CONFIG, WSL_CONFIG,
};
pub use router::TerminalRouter;
