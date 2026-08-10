//! Shared utility modules for command execution, fonts, and path resolution.

pub mod command;
pub mod fonts;
#[cfg(windows)]
/// Windows job object management for process tree cleanup.
pub mod job_object;
pub mod path_resolver;
