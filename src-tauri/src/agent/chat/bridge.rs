//! Agent Chat — session bridge (event pump + resume).
//!
//! Drives an [`AgentSession`]: pulls `session.next()` → assigns a monotonic
//! sequence number → `emit` as a [`SequencedEvent`]. The session owns its own
//! pump task (reading JSON-Lines from the child process, translating to
//! [`StreamEvent`], forwarding to an internal channel); the bridge is
//! transport-agnostic (C3) and protocol-agnostic.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use crate::agent::chat::adapter::AgentSession;
use crate::agent::chat::events::{ErrorKind, SequencedEvent, StreamEvent};
use crate::common::error::AppError;

/// Drives a session: pulls `session.next()` → assigns sequence → `emit`.
///
/// The session owns its own pump task (reading + translating + forwarding to an
/// internal channel); the bridge is transport-agnostic (C3) and protocol-agnostic.
pub struct AgentChatBridge;

impl AgentChatBridge {
    /// Start driving `session`, emitting events to `emit`.
    ///
    /// `emit: impl Fn(SequencedEvent) + Send + 'static` lets the desktop shape use
    /// `app_handle.emit(...)` while the web shape uses an SSE writer.
    ///
    /// `session_id` is used to tag error events so the frontend can display them.
    pub async fn run(
        session_id: String,
        mut session: Box<dyn AgentSession>,
        emit: impl Fn(SequencedEvent) + Send + 'static,
    ) -> Result<(), AppError> {
        // Per-session monotonic sequence counter. Uses AtomicU64 because `emit`
        // may be called from a context where `&mut` isn't available.
        let seq = Arc::new(AtomicU64::new(0));
        loop {
            match session.next().await {
                Some(Ok(event)) => {
                    let seq_num = seq.fetch_add(1, Ordering::SeqCst);
                    emit(SequencedEvent {
                        seq: seq_num,
                        event,
                    });
                }
                Some(Err(e)) => {
                    let seq_num = seq.fetch_add(1, Ordering::SeqCst);
                    log::error!("[AgentChatBridge] Session {} error: {}", session_id, e);
                    emit(SequencedEvent {
                        seq: seq_num,
                        event: StreamEvent::Error {
                            session_id: session_id.clone(),
                            kind: ErrorKind::Agent,
                            code: "E_SESSION".into(),
                            message: e.to_string(),
                        },
                    });
                    break;
                }
                None => break,
            }
        }
        Ok(())
    }
}
