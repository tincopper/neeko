//! Project management: lifecycle, metadata, and session restoration.

pub mod clone;
pub mod commands;
pub mod commands_clone;
pub mod commands_ide;
/// Clone progress event names and payloads.
pub mod events;
mod manager;
/// Project types: Project, ProjectEnvironment, ViewMode, GitInfo.
pub mod types;

pub use commands_ide::*;
pub use manager::*;
