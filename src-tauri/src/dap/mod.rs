//! Debug Adapter Protocol support.
//!
//! Spawns language-specific debug adapters (dlv, lldb-dap) via the unified
//! executor so Local / WSL / SSH projects share one path. UI never branches
//! on environment type.

pub mod commands;
pub mod config;
pub mod discover;
pub mod manager;
pub mod plugin;
pub mod protocol;
pub mod session;
pub mod types;

pub use manager::DapManager;
