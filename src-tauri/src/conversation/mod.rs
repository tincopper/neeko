//! Multi-agent conversation scanning, storage, and retrieval.

/// Agent session adapter trait and built-in implementations.
pub mod adapter;
/// Platform-specific adapter implementations (OpenCode, etc.).
pub mod adapters;
/// Tauri command handlers for conversation operations.
pub mod commands;
/// Conversation lifecycle management and storage.
pub mod manager;
/// Conversation content normalization utilities.
pub mod normalize;
pub mod types;

pub use adapter::AgentSessionAdapter;
pub use manager::ConversationManager;
pub use types::{ConversationMessage, ConversationMeta, ScanReport};
