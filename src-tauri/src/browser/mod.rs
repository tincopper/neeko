//! Browser webview creation, navigation, and URI scheme handling.

/// Tauri command handlers for browser operations.
pub mod commands;
/// URI scheme interception and custom protocol handling.
pub mod uri_scheme;

pub use commands::*;
pub use uri_scheme::*;
