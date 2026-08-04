//! One LSP language-server session: spawn, I/O threads, request/response.
//!
//! Multi-session orchestration lives in [`super::manager`].

mod instance;
mod log_ring_buffer;
mod notify;
mod request;
pub(crate) mod root;
mod status;
mod utils;

// Re-export for external use
pub(crate) use instance::LspSession;
pub(crate) use request::do_send_request;
