//! Git operations, models, caching, credential management, transport abstraction,
//! PR provider integration, and status-watching utilities.

pub mod cache;
pub mod credential;
pub mod gh;
pub mod local;
pub mod model;
pub mod operations;
pub mod parsers;
pub mod pr;
pub mod provider;
pub mod remote;
pub mod status_worker;
pub mod transport;
pub mod types;
pub mod worker;
#[cfg(target_os = "windows")]
mod wsl;

pub use cache::*;
pub use local::*;
pub use parsers::*;
pub use pr::*;
pub use provider::*;
pub use remote::*;
pub use types::*;
pub use worker::*;
#[cfg(target_os = "windows")]
pub use wsl::*;
