//! Terminal session management including local and remote (SSH) terminals.

pub mod drain;
pub mod events;
pub mod locks;
pub mod types;

#[deprecated(note = "Use crate::terminal::remote::RemoteTerminalManager instead")]
pub use crate::terminal::remote::RemoteTerminalManager;
