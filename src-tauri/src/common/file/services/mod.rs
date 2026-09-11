//! File-system service functions, split by responsibility
//! (the original services.rs was a 1700+ line God File, violating high cohesion / low coupling):
//! - `tree_read`: unified directory tree reading (Local fs / WSL / Remote find) + read-layer gitignore filter resolution
//! - `ignored_cache`: process-level caching and fetching of ignored paths for WSL/Remote (`git ls-files --ignored`)
//! - `shell_cmd`: shared WSL/Remote shell command construction (shell selection / quoting / mkdir / rm / mv)
//! - `file_write`: file write / create (Local `std::fs` under `spawn_blocking`)
//! - `path_ops`: directory create / delete / rename
//!
//! `mod.rs` stays minimal: only mod declarations and pub use re-exports (Review Gate 9).

mod file_write;
mod ignored_cache;
mod path_ops;
mod shell_cmd;
mod tree_read;

#[cfg(test)]
mod tests;

pub use file_write::*;
pub use ignored_cache::*;
pub use path_ops::*;
pub use tree_read::*;
