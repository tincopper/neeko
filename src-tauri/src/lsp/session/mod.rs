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
// 仅供 manager 测试构造可控会话（writer 存活以观察协议消息）使用。
#[cfg(test)]
pub(crate) use log_ring_buffer::LogRingBuffer;
pub(crate) use request::do_send_request;
