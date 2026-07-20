//! LSP client request plumbing: single-flight cancel + request/response wait.

use std::collections::HashMap;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{bail, Context, Result};
use lsp_server::{ErrorCode, Message, Notification, Request, RequestId, Response};
use serde_json::Value;

use super::super::inflight::InflightRequestTracker;

pub(super) type PendingSender = tokio::sync::oneshot::Sender<Message>;

static NEXT_REQ_ID: AtomicI32 = AtomicI32::new(1);

pub(super) fn cancel_inflight_request(
    pending: &Mutex<HashMap<RequestId, PendingSender>>,
    writer: &crossbeam_channel::Sender<Message>,
    prev_id: RequestId,
    method: &str,
) {
    {
        let mut map = pending.lock().expect("infallible");
        if let Some(tx) = map.remove(&prev_id) {
            let _ = tx.send(Message::Response(Response::new_err(
                prev_id.clone(),
                ErrorCode::RequestCanceled as i32,
                "superseded by newer request".into(),
            )));
        }
    }
    let cancel = Notification::new(
        "$/cancelRequest".to_string(),
        serde_json::json!({ "id": prev_id }),
    );
    if let Err(e) = writer.send(Message::Notification(cancel)) {
        log::warn!(
            "[LSP] Failed to send $/cancelRequest for {} id={:?}: {}",
            method,
            prev_id,
            e
        );
    } else {
        log::debug!(
            "[LSP] Cancelled previous {} request id={:?}",
            method,
            prev_id
        );
    }
}

/// Send an LSP request and await the response.
///
/// This free function takes cloned session ingredients (writer + pending map)
/// so it can be called without borrowing a MutexGuard across the await point.
///
/// For single-flight methods (hover/definition/…), a newer request cancels the
/// previous in-flight one via `$/cancelRequest` to prevent flooding the server.
pub(crate) async fn do_send_request(
    pending: Arc<Mutex<HashMap<RequestId, PendingSender>>>,
    writer: crossbeam_channel::Sender<Message>,
    inflight: Arc<Mutex<InflightRequestTracker>>,
    method: &str,
    params: Value,
) -> Result<Value> {
    let req_id = NEXT_REQ_ID.fetch_add(1, Ordering::Relaxed);
    let request_id = RequestId::from(req_id);

    // Single-flight: cancel previous request of the same method if still pending
    {
        let mut tracker = inflight.lock().expect("infallible");
        if let Some(prev_id) = tracker.register(method, request_id.clone()) {
            cancel_inflight_request(&pending, &writer, prev_id, method);
        }
    }

    let (tx, rx) = tokio::sync::oneshot::channel();
    {
        let mut map = pending.lock().expect("infallible");
        map.insert(request_id.clone(), tx);
    }

    let req = Request::new(request_id.clone(), method.to_string(), params);
    writer
        .send(Message::Request(req))
        .with_context(|| format!("Failed to send LSP request: {}", method))?;

    let t0 = std::time::Instant::now();
    let response = rx
        .await
        .with_context(|| format!("No response received for LSP request: {}", method))?;
    log::info!(
        "[perf] do_send_request {}: awaited {:?}",
        method,
        t0.elapsed()
    );

    // Clear tracking if we are still the current request for this method
    {
        let mut tracker = inflight.lock().expect("infallible");
        tracker.complete(method, &request_id);
    }

    match response {
        Message::Response(resp) => {
            if let Some(err) = resp.error {
                // Cancelled / superseded requests are not user-facing errors
                if err.code == ErrorCode::RequestCanceled as i32 {
                    return Ok(Value::Null);
                }
                bail!("LSP error ({}): {}", err.code, err.message);
            }
            // A null result is valid per LSP spec — means "no data" (e.g. hover on whitespace)
            Ok(resp.result.unwrap_or(Value::Null))
        }
        _ => bail!("Unexpected message type for request: {}", method),
    }
}

