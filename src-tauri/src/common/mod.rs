//! Common types, utilities, and shared modules used across the Neeko application.
//!
//! This crate provides error types, file-system utilities, git operations,
//! terminal management, command execution abstractions, and agent configuration
//! types that are consumed by both backend and frontend-facing code.

pub mod agent;
pub mod connection;
pub mod db;
/// Application error types and conversions.
pub mod error;
pub mod executor;
pub mod file;
pub mod git;
pub mod logger;
pub mod runtime;
pub mod terminal;
pub mod theme_types;
pub mod types;
pub mod utils;

/// Re-exported runtime helpers for blocking async execution.
pub use runtime::{run_blocking, run_blocking_result, AppRuntime};
