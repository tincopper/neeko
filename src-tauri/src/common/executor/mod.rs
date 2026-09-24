//! Unified command execution interface.
//!
//! Provides a single [`CommandExecutor`] trait that abstracts over local,
//! WSL, and SSH command execution. Callers use the same API regardless
//! of the target environment.

pub mod collect;
mod env_defaults;
mod error;
pub mod factory;
mod local;
mod process_guard;
mod ssh;
pub mod ssh_auth;
mod traits;
mod types;
mod wsl;

pub use collect::collect_child_output;
pub(crate) use env_defaults::with_default_env;
pub use error::{format_command_failed_msg, ExecError};
pub use process_guard::ProcessGuard;
pub use traits::CommandExecutor;
pub use types::{BoxAsyncRead, BoxAsyncWrite, ExecChild, ExecOutput, SpawnOptions};
