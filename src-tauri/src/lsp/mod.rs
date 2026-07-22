//! LSP (Language Server Protocol) integration: session management, transport, and diagnostics.

/// Tauri command handlers for LSP operations.
pub mod commands;
/// Diagnostic pub/sub event bus.
pub mod diag_bus;
pub mod inflight;
pub mod installer;
pub mod manager;
pub mod plugin;
pub mod process;
pub mod profile;
pub mod server_request;
pub mod session;
pub mod symbol;
pub mod transport;
/// Serializable types for LSP IPC with the frontend.
pub mod types;

pub use manager::LspManager;
pub use plugin::{
    CustomLspServerConfig, LspAutoStart, LspExtensionConflict, LspExtensionMapEntry, LspPlugin,
    LspPluginRegistry, LspSettings,
};
pub use profile::{detect_project_profile, ProjectLanguageProfile};
pub use types::*;
