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
pub(crate) use instance::{emit_session_error, publish_status, LspSession, SessionPlumbing};
pub(crate) use log_ring_buffer::LogRingBuffer;
// 单条 JSON 上界：manager 的 IPC 预算以它为编译期下界（见 `LSP_SERVER_LOGS_MAX_BYTES`）。
pub(crate) use log_ring_buffer::LOG_ENTRY_JSON_MAX_BYTES;
// 环上限仅供测试断言（生产消费点经 `LogRingBuffer` 自持该常量）。
#[cfg(test)]
pub(crate) use log_ring_buffer::LOG_RING_MAX_BYTES;
pub(crate) use request::do_send_request;
#[cfg(test)]
pub(crate) use request::PendingSender;
pub(crate) use utils::iso_timestamp_now;
