//! Unified command execution interface.
//!
//! Provides a single [`CommandExecutor`] trait that abstracts over local,
//! WSL, and SSH command execution. Callers use the same API regardless
//! of the target environment.

mod child_registry;
pub mod collect;
mod env_defaults;
mod error;
pub mod factory;
mod local;
mod login_script;
mod process_guard;
mod ssh;
pub mod ssh_auth;
mod traits;
mod types;
mod wsl;

pub(crate) use child_registry::{kill_all_live, register};
pub use collect::{
    collect_child_output, collect_child_output_streaming,
    collect_child_output_streaming_cancellable,
};
pub(crate) use env_defaults::with_default_env;
pub use error::{format_command_failed_msg, ExecError};
pub use process_guard::ProcessGuard;
pub use traits::CommandExecutor;
pub use types::{
    BoxAsyncRead, BoxAsyncWrite, ExecChild, ExecChunkSink, ExecOutput, ExecStream, KillFn,
    KillFuture, ScriptOptions, SpawnOptions, WaitFuture,
};
