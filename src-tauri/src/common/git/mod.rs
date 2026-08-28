//! Git operations, caching, credential management, transport abstraction,
//! PR provider integration, and status-watching utilities.

pub mod cache;
pub mod credential;
pub mod gh;
pub mod local;
pub mod operations;
pub mod parsers;
pub mod path_guard;
pub mod pr;
pub mod provider;
pub mod refs;
pub mod remote;
pub mod status_worker;
pub mod transport;
pub mod types;
/// WSL-specific git operations and IDE launch helpers.
#[cfg(target_os = "windows")]
pub mod wsl;

pub use cache::*;
pub use parsers::*;
pub use pr::*;
pub use provider::*;
pub use refs::*;
pub use remote::*;
pub use types::*;
#[cfg(target_os = "windows")]
pub use wsl::*;
