//! One LSP language-server session: spawn, I/O threads, request/response.
//!
//! Multi-session orchestration lives in [`super::manager`].

mod instance;
mod log_ring_buffer;
mod notify;
mod request;
mod status;
mod utils;
// Re-export for external use
pub(crate) use instance::LspSession;
pub(crate) use request::do_send_request;
pub(crate) use status::LspSessionStatus;

// Re-export for use by instance.rs
pub(crate) use utils::{chrono_like_now, sample_process_memory_mb};
