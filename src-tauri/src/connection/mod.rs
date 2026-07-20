//! WSL and SSH remote connection management.

/// Tauri command handlers for connection operations.
pub mod commands;
/// Connection service layer for SSH and WSL session lifecycle.
pub mod services;

pub use commands::*;
