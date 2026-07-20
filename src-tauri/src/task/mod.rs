//! Task configuration management: discovery, persistence, and execution of project/app-level tasks.

pub mod commands;
pub mod discover;
mod services;

pub use discover::{discover_tasks, to_task_config, DiscoveredTask};
pub use services::*;
