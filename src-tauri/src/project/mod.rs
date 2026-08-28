//! Project management: lifecycle, metadata, and session restoration.

pub mod commands;
pub mod commands_ide;
mod manager;
/// Project types: Project, ProjectEnvironment, ViewMode, GitInfo.
pub mod types;

pub use commands_ide::*;
pub use manager::*;
