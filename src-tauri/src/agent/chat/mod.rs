//! Agent Chat — multi-agent conversation surface for Neeko.
//!
//! Architecture: a thin adapter matrix translates each agent's native IO into the
//! unified [`events::StreamEvent`] protocol (Contract C1); the frontend renders
//! those events. See
//! `.trellis/tasks/08-17-web-agent-page-design/design/first-principles-review.md`.

pub mod adapter;
pub mod bridge;
pub mod commands;
pub mod events;
pub mod manager;
pub mod mock;
pub mod provider_registry;
pub mod session_store;

pub use events::{
    Capabilities, ContextManifest, DoneReason, ErrorKind, SessionRequest, StreamEvent,
    TurnEndReason, Usage,
};
pub use provider_registry::{ModelSwitchMode, ProviderCapabilities, ProviderRegistry};
pub use session_store::{ResumeCursor, SessionStatus, SessionStore, SqliteSessionStore};
