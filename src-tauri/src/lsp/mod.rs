//! LSP (Language Server Protocol) integration: session management, transport, and diagnostics.

/// Tauri command handlers for LSP operations.
pub mod commands;
/// Diagnostic pub/sub event bus.
pub mod diag_bus;
pub mod inflight;
pub mod installer;
pub mod java_debug_bundle;
pub mod java_debug_probe;
pub mod java_source_materializer;
pub mod manager;
pub mod plugin;
pub mod plugin_manager;

/// Pre-authorized external reads for definition targets.
pub mod preauth;
pub mod process;
pub mod profile;
pub mod server_request;
pub mod session;
pub mod session_store;
pub mod symbol;
pub mod transport;
/// Serializable types for LSP IPC with the frontend.
pub mod types;

pub use java_debug_bundle::{ensure_bundle_blocking, existing_bundle};
pub use java_debug_probe::LspJavaDebugCapability;
pub use java_source_materializer::LspJavaSourcePath;
pub use manager::LspManager;
pub use plugin::{
    CustomLspServerConfig, LspAutoStart, LspExtensionConflict, LspExtensionMapEntry, LspPlugin,
    LspPluginRegistry, LspSettings,
};
pub use plugin_manager::LspPluginManager;
pub use profile::{detect_project_profile, ProjectLanguageProfile};
pub use session_store::LspSessionStore;
pub use types::*;
