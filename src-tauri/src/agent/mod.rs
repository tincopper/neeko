//! Agent lifecycle management, commands, configuration, and plugin system.

pub mod commands;
pub mod commands_commit;
pub mod deployer;
pub mod manager;
pub mod path_resolver;
pub mod plugin;
pub mod plugin_commands;
pub mod registry;

pub use manager::AgentManager;
