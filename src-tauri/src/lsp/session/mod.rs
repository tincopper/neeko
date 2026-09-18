//! One LSP language-server session: spawn, I/O threads, request/response.
//!
//! Multi-session orchestration lives in [`super::manager`].

mod instance;
pub(crate) mod lifecycle;
mod log_ring_buffer;
mod notify;
mod request;
pub(crate) mod root;
pub(crate) mod status;
/// Test-only fixtures (stub session / recording transport) shared by in-crate tests.
#[cfg(test)]
pub(crate) mod testing;
mod utils;

// Re-export for external use
pub(crate) use instance::{emit_session_error, LspSession};
pub(crate) use request::do_send_request;
