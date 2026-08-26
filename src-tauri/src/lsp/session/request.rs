//! LSP client request plumbing: single-flight cancel + request/response wait.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{bail, Context, Result};
use lsp_server::{ErrorCode, Message, Notification, Request, RequestId, Response};
use serde_json::Value;

use super::super::inflight::{singleflight_bucket, InflightRequestTracker};

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
/// Single-flight is keyed on a *bucket* computed by [`singleflight_bucket`]:
/// probe methods (hover, completion…) cancel their own previous in-flight
/// request via `$/cancelRequest`; a `textDocument/definition` probe (the
/// link-highlight decoration path, `is_probe = true`) cancels only other
/// definition probes; user-intent navigation is never single-flight.
pub(crate) async fn do_send_request(
    pending: Arc<Mutex<HashMap<RequestId, PendingSender>>>,
    writer: crossbeam_channel::Sender<Message>,
    inflight: Arc<Mutex<InflightRequestTracker>>,
    method: &str,
    params: Value,
    is_probe: bool,
) -> Result<Value> {
    let req_id = NEXT_REQ_ID.fetch_add(1, Ordering::Relaxed);
    let request_id = RequestId::from(req_id);

    // Single-flight: cancel the previous request of the same bucket if pending.
    let flight_bucket = singleflight_bucket(method, is_probe);
    if let Some(bucket) = flight_bucket.as_deref() {
        let mut tracker = inflight.lock().expect("infallible");
        if let Some(prev_id) = tracker.register(bucket, request_id.clone()) {
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

    // Clear tracking if we are still the current request for this bucket
    if let Some(bucket) = flight_bucket.as_deref() {
        let mut tracker = inflight.lock().expect("infallible");
        tracker.complete(bucket, &request_id);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
    use std::sync::mpsc;
    use std::time::Duration;

    const OK_RESULT: &str = r#"{
        "uri": "file:///target.rs",
        "range": { "start": { "line": 1, "character": 0 }, "end": { "line": 1, "character": 4 } }
    }"#;

    /// Minimal stand-in for the session reader thread: collects `Request`s,
    /// answers them with an OK response only after [`FakeServer::drain`], and
    /// counts `$/cancelRequest` notifications.
    struct FakeServer {
        handle: std::thread::JoinHandle<()>,
        req_received: mpsc::Receiver<()>,
        cancel_count: Arc<AtomicUsize>,
        drain_tx: mpsc::Sender<()>,
    }

    impl FakeServer {
        fn spawn(
            writer_rx: crossbeam_channel::Receiver<Message>,
            pending: Arc<Mutex<HashMap<RequestId, PendingSender>>>,
        ) -> Self {
            let (req_tx, req_rx) = mpsc::channel::<()>();
            let (drain_tx, drain_rx) = mpsc::channel::<()>();
            let cancel_count = Arc::new(AtomicUsize::new(0));
            let cancel_count_clone = Arc::clone(&cancel_count);

            let handle = std::thread::spawn(move || {
                let mut collected: Vec<RequestId> = Vec::new();
                let mut drained = false;
                loop {
                    match writer_rx.recv_timeout(Duration::from_millis(10)) {
                        Ok(Message::Request(req)) => {
                            collected.push(req.id.clone());
                            let _ = req_tx.send(());
                            if drained {
                                respond_all(&pending, &collected);
                            }
                        }
                        Ok(Message::Notification(notif)) if notif.method == "$/cancelRequest" => {
                            cancel_count_clone.fetch_add(1, AtomicOrdering::Relaxed);
                        }
                        Ok(_) => {}
                        Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                            if !drained && drain_rx.try_recv().is_ok() {
                                drained = true;
                                respond_all(&pending, &collected);
                            }
                        }
                        Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
                    }
                }
            });

            Self {
                handle,
                req_received: req_rx,
                cancel_count,
                drain_tx,
            }
        }

        /// Block until the server has seen the first request.
        fn wait_received(&self) {
            self.req_received.recv().expect("server received request");
        }

        /// Answer every request the server has collected (and any that arrive later).
        fn drain(&self) {
            let _ = self.drain_tx.send(());
        }

        fn cancel_count(&self) -> usize {
            self.cancel_count.load(AtomicOrdering::Relaxed)
        }

        fn join(self) {
            self.handle.join().expect("fake server thread");
        }
    }

    fn respond_all(pending: &Mutex<HashMap<RequestId, PendingSender>>, ids: &[RequestId]) {
        // Mirrors the session reader thread: take the sender out of the pending
        // map and resolve it. Requests already cancelled were removed, so they
        // are skipped — their late real response is simply dropped.
        let mut map = pending.lock().expect("infallible");
        for id in ids {
            if let Some(tx) = map.remove(id) {
                let resp = Message::Response(Response::new_ok(
                    id.clone(),
                    serde_json::from_str::<Value>(OK_RESULT).expect("valid json"),
                ));
                let _ = tx.send(resp);
            }
        }
    }

    fn definition_params() -> Value {
        serde_json::json!({
            "textDocument": { "uri": "file:///a.rs" },
            "position": { "line": 0, "character": 4 },
        })
    }

    type PendingMap = Arc<Mutex<HashMap<RequestId, PendingSender>>>;

    type Harness = (
        PendingMap,
        crossbeam_channel::Sender<Message>,
        Arc<Mutex<InflightRequestTracker>>,
        FakeServer,
    );

    fn harness() -> Harness {
        let pending: Arc<Mutex<HashMap<RequestId, PendingSender>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let inflight = Arc::new(Mutex::new(InflightRequestTracker::new()));
        let (writer, writer_rx) = crossbeam_channel::unbounded::<Message>();
        let server = FakeServer::spawn(writer_rx, Arc::clone(&pending));
        (pending, writer, inflight, server)
    }

    // Multi-threaded runtime: the test task blocks on `wait_received` /
    // `server.join`, so spawned request tasks need another worker to progress.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn probe_definition_cancels_previous_probe_but_not_jump() {
        let (pending, writer, inflight, server) = harness();

        // Probe 1 — in-flight decoration probe.
        let probe1 = tokio::spawn(do_send_request(
            Arc::clone(&pending),
            writer.clone(),
            Arc::clone(&inflight),
            "textDocument/definition",
            definition_params(),
            true,
        ));
        server.wait_received();

        // Probe 2 supersedes probe 1 (single-flight among probes).
        let probe2 = tokio::spawn(do_send_request(
            Arc::clone(&pending),
            writer.clone(),
            Arc::clone(&inflight),
            "textDocument/definition",
            definition_params(),
            true,
        ));

        // Probe 1 is cancelled by probe 2 → resolves to null, not an error.
        let r1 = probe1.await.expect("probe1 task ran");
        assert!(
            matches!(r1, Ok(ref v) if v.is_null()),
            "cancelled probe must resolve null, got {:?}",
            r1
        );

        // An explicit jump while probe 2 is still in flight: never cancelled,
        // and it does not cancel the probe (different buckets).
        let jump = tokio::spawn(do_send_request(
            Arc::clone(&pending),
            writer.clone(),
            Arc::clone(&inflight),
            "textDocument/definition",
            definition_params(),
            false,
        ));

        server.drain();
        let r2 = probe2.await.expect("probe2 task ran").expect("probe2 ok");
        let r3 = jump.await.expect("jump task ran").expect("jump ok");
        assert!(
            r2.get("uri").is_some(),
            "probe2 must receive the real result"
        );
        assert!(r3.get("uri").is_some(), "jump must receive the real result");

        // Exactly one cancel was emitted — the probe→probe supersede only.
        assert_eq!(
            server.cancel_count(),
            1,
            "only the superseded probe may be cancelled"
        );

        drop(writer);
        server.join();
    }

    // Multi-threaded runtime: the test task blocks on `wait_received` /
    // `server.join`, so spawned request tasks need another worker to progress.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn jump_definition_is_never_cancelled_by_probe() {
        let (pending, writer, inflight, server) = harness();

        // An explicit jump is in flight…
        let jump = tokio::spawn(do_send_request(
            Arc::clone(&pending),
            writer.clone(),
            Arc::clone(&inflight),
            "textDocument/definition",
            definition_params(),
            false,
        ));
        server.wait_received();

        // …when a decoration probe fires at the same symbol. It must not
        // cancel the jump (dedicated `definition#probe` bucket).
        let probe = tokio::spawn(do_send_request(
            Arc::clone(&pending),
            writer.clone(),
            Arc::clone(&inflight),
            "textDocument/definition",
            definition_params(),
            true,
        ));

        server.drain();
        let r1 = jump.await.expect("jump task ran").expect("jump ok");
        let r2 = probe.await.expect("probe task ran").expect("probe ok");
        assert!(r1.get("uri").is_some(), "jump must receive the real result");
        assert!(
            r2.get("uri").is_some(),
            "probe must receive the real result"
        );
        assert_eq!(server.cancel_count(), 0, "jump must never be cancelled");

        drop(writer);
        server.join();
    }
}
