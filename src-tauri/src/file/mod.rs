//! File system operations and file change watcher.

/// Tauri command handlers for file operations.
pub mod commands;

pub use crate::common::file::watcher::{FileChangedEvent, FileTreeChangedEvent, WatcherManager};
pub use commands::*;
