//! Browser webview creation, navigation, and URI scheme handling.

/// Tauri command handlers for browser operations (thin entry layer).
pub mod commands;
/// DevTools platform-specific adaptation (macOS/Linux detach polling).
pub mod devtools;
/// Browser event name constants (single source of truth).
pub mod events;
/// Injected script constants and builders (meta, scrollbar, picker).
pub mod scripts;
/// URI scheme interception and custom protocol handling.
pub mod uri_scheme;
/// URL security validation (scheme allowlist + file:// path traversal guard).
pub mod url_validator;
/// Webview lifecycle operations (create, bounds normalization).
pub mod webview_ops;

pub use commands::*;
pub use events::*;
pub use uri_scheme::*;
