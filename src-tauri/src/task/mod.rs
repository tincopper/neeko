pub mod commands;
pub mod discover;
mod services;

pub use discover::{discover_tasks, to_task_config, DiscoveredTask};
pub use services::*;
