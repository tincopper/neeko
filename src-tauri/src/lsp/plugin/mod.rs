//! Language server plugin system.
//!
//! - [`types`] — descriptors & settings (no language table)
//! - [`registry`] — registration + extension routing
//! - [`builtins`] — one module per language / family (extensible inventory)

pub mod builtins;
pub mod registry;
pub mod types;

pub use registry::LspPluginRegistry;
pub use types::{
    CustomLspServerConfig, LspAutoStart, LspExtensionConflict, LspExtensionMapEntry,
    LspInstallMethod, LspPlugin, LspSettings,
};
