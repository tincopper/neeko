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
/// PTY creation, pipeline spawning, and terminal utilities.
pub mod services;

pub use crate::common::terminal::types::*;
pub use manager::TerminalManager;
#[allow(unused_imports)]
pub(crate) use manager::{
    PipelineConfig, PtyHandle, TerminalClosedPayload, PTY_CONFIG, WSL_CONFIG,
};
