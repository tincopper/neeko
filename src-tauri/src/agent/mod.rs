//! Agent lifecycle management, commands, configuration, and plugin system.
//!
//! Chat is one interaction mode of an agent (alongside the terminal TUI); the
//! `chat` submodule holds the adapters, event protocol, and session registry that
//! power the Agent Chat surface.

pub mod chat;

pub mod commands;
pub mod commands_commit;
pub mod deployer;
pub mod ids;
pub mod manager;
pub mod model_discovery;
pub mod path_resolver;
pub mod plugin;
pub mod plugin_commands;
pub mod registry;
pub mod resource_deployer;
pub mod schema_validator;

pub use manager::AgentManager;
