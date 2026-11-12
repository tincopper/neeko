//! LSP client request plumbing: single-flight cancel + request/response wait.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;
use std::fmt;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, Mutex};

use lsp_server::{ErrorCode, Message, Notification, Request, RequestId, Response};
use serde_json::Value;

use super::super::inflight::{singleflight_bucket, InflightRequestTracker};

pub(crate) type PendingSender = tokio::sync::oneshot::Sender<Message>;

static NEXT_REQ_ID: AtomicI32 = AtomicI32::new(1);

/// 一次 LSP 请求失败的**分类**。
///
/// 分类不是文案细节，而是所有权边界：`manager` 只对 [`RequestFailure::Channel`]
/// （通道不可用 = 会话级故障）进重启预算；`Server` / `Timeout` 是**请求级**失败，
/// 服务器完全健康，原样上抛给调用方。
///
/// 反例（审计 channel D2）：任何 error response 都被当成会话故障 ⇒ 一次 `-32602`
/// （didClose 与 definition 的常规交错）就重启整台服务器并消耗预算，5 次后该
/// `project:lang` 永久不可用。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RequestFailure {
    /// 服务器答了 JSON-RPC error：请求级失败，会话健康。
    Server { code: i32, message: String },
    /// 通道不可用（写失败 / 发送端丢失 / reader 已退出）：会话级失败，可重建。
    Channel(String),
    /// 预算内没等到响应：请求级失败（服务器慢 ≠ 会话死）。
    Timeout {
        method: String,
        budget: std::time::Duration,
    },
    /// 被更新的同类请求取代（single-flight）：对外仍是 `Ok(Null)`，不是错误。
    Cancelled,
}

impl fmt::Display for RequestFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            // 文案与重构前逐字一致：`AppError::Lsp` 与前端展示、以及
            // `dap::adapter::java::capability::lsp_error_code` 的 `LSP error (<code>)`
            // 前缀解析都依赖它。
            Self::Server { code, message } => write!(f, "LSP error ({code}): {message}"),
            Self::Channel(reason) => write!(f, "{reason}"),
            Self::Timeout { method, budget } => write!(
                f,
                "No response received for LSP request: {method} (budget {budget:?} elapsed)"
            ),
            Self::Cancelled => write!(f, "LSP request cancelled"),
        }
    }
}

impl std::error::Error for RequestFailure {}

impl RequestFailure {
    /// 是否属于**会话级**故障 —— 唯一允许进重启预算的一类。
    ///
    /// `Server` / `Timeout` 是请求级失败：服务器在答（或只是慢），重启一台正在索引
    /// 的 JVM 要几十秒且必然更慢，还会把真故障的预算烧光（设计 §2.1 分类表）。
    #[must_use]
    pub(crate) const fn is_session_level(&self) -> bool {
        matches!(self, Self::Channel(_))
    }
}

/// 出站请求 id 的**唯一** allocator（审计 channel D4/R3）。
///
/// 历史上 `initialize` 硬编码 `1`、`shutdown` 硬编码 `1000`、业务请求走进程级自增，
/// 三者共用一张以 id 为唯一键的 `pending` 表：`initialize` 的 `1` 与业务自增起点同值，
/// `shutdown` 的 `1000` 会被业务 id 绕回撞上。撞上即 `insert` 静默覆盖 ⇒ 前一个等待者
/// 的发送端被 drop（表现为「无响应」→ 误判会话故障 → 重启）。
pub(crate) fn next_request_id() -> RequestId {
    RequestId::from(NEXT_REQ_ID.fetch_add(1, Ordering::Relaxed))
}

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
    budget: std::time::Duration,
) -> Result<Value, RequestFailure> {
    let request_id = next_request_id();

    // Single-flight: cancel the previous request of the same bucket if pending.
    let flight_bucket = singleflight_bucket(method, is_probe);
    if let Some(bucket) = flight_bucket.as_deref() {
        let mut tracker = inflight.lock().expect("infallible");
        if let Some(prev_id) = tracker.register(bucket, request_id.clone()) {
            cancel_inflight_request(&pending, &writer, prev_id, method);
        }
    }

    let (tx, rx) = tokio::sync::oneshot::channel();
    if let Err(failure) = register_pending(&pending, &request_id, tx) {
        // 登记失败（id 碰撞 = 内部不变量破裂）：把单飞桶还原，别让它指向一个
        // 没有等待者的 id（那会让「下一条同类请求」取消一条不存在的在途请求）。
        if let Some(bucket) = flight_bucket.as_deref() {
            inflight
                .lock()
                .expect("infallible")
                .complete(bucket, &request_id);
        }
        return Err(failure);
    }

    let req = Request::new(request_id.clone(), method.to_string(), params);
    if let Err(e) = writer.send(Message::Request(req)) {
        log::warn!("[LSP] Failed to send LSP request {method} (id={request_id:?}): {e}");
        cleanup_request(
            &pending,
            &inflight,
            flight_bucket.as_deref(),
            &request_id,
            &writer,
            method,
            false,
        );
        return Err(RequestFailure::Channel(format!(
            "Failed to send LSP request: {method}"
        )));
    }

    let t0 = std::time::Instant::now();
    // **有界等待**：服务器活着但对某方法沉默（索引期的 jdtls 不答 definition）时，
    // 无 deadline 的等待会让 Tauri 命令永不 settle、`pending` 与单飞桶永久占用
    // （审计 channel D5）。预算来自插件数据（`LspSession::request_timeout`）。
    let response = match tokio::time::timeout(budget, rx).await {
        Ok(Ok(msg)) => msg,
        Ok(Err(_)) => {
            // 发送端被 drop（reader 退出 / 会话关闭）：响应不可能再到。
            cleanup_request(
                &pending,
                &inflight,
                flight_bucket.as_deref(),
                &request_id,
                &writer,
                method,
                false,
            );
            return Err(RequestFailure::Channel(format!(
                "No response received for LSP request: {method}"
            )));
        }
        Err(_elapsed) => {
            // 客户端不再等 ⇒ 必须告诉服务器别算了，否则它会把结果写进已关闭的通道。
            log::warn!(
                "[LSP] {method} timed out after {budget:?} (id={request_id:?}); \
                 cancelling the request on the server"
            );
            cleanup_request(
                &pending,
                &inflight,
                flight_bucket.as_deref(),
                &request_id,
                &writer,
                method,
                true,
            );
            return Err(RequestFailure::Timeout {
                method: method.to_string(),
                budget,
            });
        }
    };
    log::info!(
        "[perf] do_send_request {}: awaited {:?}",
        method,
        t0.elapsed()
    );

    // 常规清理（响应已到：pending 多半已被 reader 摘除，`remove` 幂等）。
    cleanup_request(
        &pending,
        &inflight,
        flight_bucket.as_deref(),
        &request_id,
        &writer,
        method,
        false,
    );

    match classify_response(response, method) {
        // single-flight 取代不是错误：对外仍是「无数据」（既有语义）。
        Err(RequestFailure::Cancelled) => Ok(Value::Null),
        other => other,
    }
}

/// 登记一个等待者（`pending` 的**唯一入**）。
///
/// 同 id 已存在就必须拒绝：`insert` 静默覆盖会 drop 前一个等待者的发送端，它随即
/// 以「无响应」失败并被判成会话故障（审计 channel D4）—— 把一次 id 碰撞伪装成网络
/// 问题，比直接让**本**请求失败难查得多。
pub(super) fn register_pending(
    pending: &Mutex<HashMap<RequestId, PendingSender>>,
    request_id: &RequestId,
    tx: PendingSender,
) -> Result<(), RequestFailure> {
    let mut map = match pending.lock() {
        Ok(map) => map,
        // 锁中毒不改变本函数的不变量（表本身就是判据），恢复后继续判重。
        Err(poisoned) => {
            log::warn!("[LSP] pending mutex poisoned, recovering");
            poisoned.into_inner()
        }
    };
    if map.contains_key(request_id) {
        log::error!(
            "[LSP] duplicate pending request id {request_id:?}: refusing to overwrite a live waiter"
        );
        return Err(RequestFailure::Channel(format!(
            "Duplicate LSP request id {request_id} (internal invariant violation)"
        )));
    }
    map.insert(request_id.clone(), tx);
    Ok(())
}

/// 摘除一次请求的全部在途状态，必要时向服务器声明取消。
///
/// **所有出口共用这一份**（写失败 / 发送端丢失 / 超时 / 响应到达）：少做一步就留下
/// 一份永不回收的 `pending` 条目 + 单飞桶 —— 下一次同类探针会把泄漏 id 当成
/// 「前一条在途」发 `$/cancelRequest`（审计 channel D6）。
///
/// 幂等：reader 的 `drain_pending` 与本函数可能先后摘同一个 id，`remove` 返回 `None`
/// 即静默跳过（设计 §3 失败矩阵）。
fn cleanup_request(
    pending: &Mutex<HashMap<RequestId, PendingSender>>,
    inflight: &Mutex<InflightRequestTracker>,
    flight_bucket: Option<&str>,
    request_id: &RequestId,
    writer: &crossbeam_channel::Sender<Message>,
    method: &str,
    cancel_on_server: bool,
) {
    {
        let mut map = pending.lock().expect("infallible");
        map.remove(request_id);
    }
    if let Some(bucket) = flight_bucket {
        let mut tracker = inflight.lock().expect("infallible");
        tracker.complete(bucket, request_id);
    }
    if cancel_on_server {
        let cancel = Notification::new(
            "$/cancelRequest".to_string(),
            serde_json::json!({ "id": request_id }),
        );
        match writer.send(Message::Notification(cancel)) {
            Ok(()) => log::debug!("[LSP] Sent $/cancelRequest for {method} id={request_id:?}"),
            // 写不出去也不影响本请求的失败分类：清理必须照做。
            Err(e) => log::warn!(
                "[LSP] Failed to send $/cancelRequest for {method} id={request_id:?}: {e}"
            ),
        }
    }
}

/// 响应 → 结果，按**失败归属**分类（纯函数：分类是唯一真相，调用点据此决定是否
/// 重启会话）。
fn classify_response(response: Message, method: &str) -> Result<Value, RequestFailure> {
    match response {
        Message::Response(resp) => match resp.error {
            // 被更新的同类请求取代（single-flight 自己发的取消）：不是错误。
            Some(err) if err.code == ErrorCode::RequestCanceled as i32 => {
                Err(RequestFailure::Cancelled)
            }
            Some(err) => Err(RequestFailure::Server {
                code: err.code,
                message: err.message,
            }),
            // A null result is valid per LSP spec — means "no data" (e.g. hover on whitespace)
            None => Ok(resp.result.unwrap_or(Value::Null)),
        },
        _ => Err(RequestFailure::Channel(format!(
            "Unexpected message type for request: {}",
            method
        ))),
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

    /// 普通用例的等待预算：足够长（不测超时）但仍有界。
    const TEST_BUDGET: Duration = Duration::from_secs(5);

    /// 假服务器的应答方式。`Silent` 是「服务器活着但对某方法沉默」（索引期的
    /// jdtls 不答 definition / RA 卡在一条长分析上）的最小替身。
    #[derive(Clone)]
    enum Reply {
        Ok,
        Error { code: i32, message: String },
        Silent,
    }

    /// Minimal stand-in for the session reader thread: collects `Request`s,
    /// answers them with [`Reply`] only after [`FakeServer::drain`], and
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
            reply: Reply,
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
                                respond_all(&pending, &collected, &reply);
                            }
                        }
                        Ok(Message::Notification(notif)) if notif.method == "$/cancelRequest" => {
                            cancel_count_clone.fetch_add(1, AtomicOrdering::Relaxed);
                        }
                        Ok(_) => {}
                        Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                            if !drained && drain_rx.try_recv().is_ok() {
                                drained = true;
                                respond_all(&pending, &collected, &reply);
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

        /// 有界等待取消通知计数达到 `target`（真实线程 → 单向可达，不等速率）。
        fn wait_cancel_count(&self, target: usize) {
            let deadline = std::time::Instant::now() + Duration::from_secs(2);
            while self.cancel_count.load(AtomicOrdering::Relaxed) < target {
                assert!(
                    std::time::Instant::now() < deadline,
                    "timed out waiting for {target} $/cancelRequest notification(s)"
                );
                std::thread::sleep(Duration::from_millis(5));
            }
        }

        fn cancel_count(&self) -> usize {
            self.cancel_count.load(AtomicOrdering::Relaxed)
        }

        fn join(self) {
            self.handle.join().expect("fake server thread");
        }
    }

    fn respond_all(
        pending: &Mutex<HashMap<RequestId, PendingSender>>,
        ids: &[RequestId],
        reply: &Reply,
    ) {
        // Mirrors the session reader thread: take the sender out of the pending
        // map and resolve it. Requests already cancelled were removed, so they
        // are skipped — their late real response is simply dropped.
        let msg_for = |id: &RequestId| match reply {
            Reply::Ok => Some(Message::Response(Response::new_ok(
                id.clone(),
                serde_json::from_str::<Value>(OK_RESULT).expect("valid json"),
            ))),
            Reply::Error { code, message } => Some(Message::Response(Response::new_err(
                id.clone(),
                *code,
                message.clone(),
            ))),
            Reply::Silent => None,
        };
        let mut map = pending.lock().expect("infallible");
        for id in ids {
            let Some(msg) = msg_for(id) else { continue };
            if let Some(tx) = map.remove(id) {
                let _ = tx.send(msg);
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

    fn harness_with_reply(reply: Reply) -> Harness {
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let inflight = Arc::new(Mutex::new(InflightRequestTracker::new()));
        let (writer, writer_rx) = crossbeam_channel::unbounded::<Message>();
        let server = FakeServer::spawn(writer_rx, Arc::clone(&pending), reply);
        (pending, writer, inflight, server)
    }

    fn harness() -> Harness {
        harness_with_reply(Reply::Ok)
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
            TEST_BUDGET,
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
            TEST_BUDGET,
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
            TEST_BUDGET,
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
            TEST_BUDGET,
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
            TEST_BUDGET,
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

    // ── S1：失败分类（请求级 vs 会话级） ──────────────────────────────────

    /// R1/D2：服务器答 JSON-RPC error 是**请求级**失败 —— 会话健康，不得归到
    /// `Channel`（那会让 manager 重启整台服务器并消耗重启预算）。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn server_error_response_is_a_request_failure() {
        let (pending, writer, inflight, server) = harness_with_reply(Reply::Error {
            code: -32602,
            message: "Document not open".to_string(),
        });
        server.drain();

        let failure = do_send_request(
            pending,
            writer.clone(),
            inflight,
            "textDocument/definition",
            definition_params(),
            false,
            TEST_BUDGET,
        )
        .await
        .expect_err("error response must fail the request");

        match failure {
            RequestFailure::Server { code, message } => {
                assert_eq!(code, -32602, "错误码必须原样保留（能力探测按码分类）");
                assert!(
                    message.contains("Document not open"),
                    "错误文案必须原样上抛: {message}"
                );
            }
            other => panic!(
                "服务器回错是请求级失败（Server），不是会话级故障；实际 {other:?} \
                 —— 归错类会让一次 didClose/definition 交错重启整台 jdts"
            ),
        }

        drop(writer);
        server.join();
    }

    /// R1：写失败 / 发送端丢失是**会话级**失败（通道不可用），可进重启预算。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn writer_closed_is_a_channel_failure() {
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let inflight = Arc::new(Mutex::new(InflightRequestTracker::new()));
        let (writer, writer_rx) = crossbeam_channel::unbounded::<Message>();
        // 写端接收方已 drop ⇒ 等同于 writer 线程已因写错误返回（stdin 破裂）。
        drop(writer_rx);

        let failure = do_send_request(
            pending,
            writer,
            inflight,
            "textDocument/definition",
            definition_params(),
            false,
            TEST_BUDGET,
        )
        .await
        .expect_err("closed writer must fail the request");

        assert!(
            matches!(failure, RequestFailure::Channel(_)),
            "通道不可用是会话级失败（Channel），实际 {failure:?}"
        );
    }

    /// 既有语义（不得变化）：single-flight 取代的请求对外是 `Ok(Null)`，
    /// 不是错误 —— 归成 `Server` / `Channel` 都会让「hint 刷新」变成用户可见故障。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancelled_request_stays_ok_null() {
        let (pending, writer, inflight, server) = harness();

        let first = tokio::spawn(do_send_request(
            Arc::clone(&pending),
            writer.clone(),
            Arc::clone(&inflight),
            "textDocument/hover",
            definition_params(),
            false,
            TEST_BUDGET,
        ));
        server.wait_received();

        // 同桶第二条请求到来 ⇒ 第一条被取代。
        let second = tokio::spawn(do_send_request(
            Arc::clone(&pending),
            writer.clone(),
            Arc::clone(&inflight),
            "textDocument/hover",
            definition_params(),
            false,
            TEST_BUDGET,
        ));

        let r1 = first.await.expect("first task ran");
        assert!(
            matches!(r1, Ok(ref v) if v.is_null()),
            "被取代的请求必须解析为 null（既有语义），实际 {r1:?}"
        );

        server.drain();
        second.await.expect("second task ran").expect("second ok");

        drop(writer);
        server.join();
    }

    // ── S2：写失败与超时都清理 pending/inflight（R4/R5）─────────────────

    /// R5/D6：`writer.send` 失败时若 `?` 早退，已登记的 sender 与单飞桶都留在表里
    /// ⇒ 下一次同类探针把泄漏 id 当「前一条在途」发 `$/cancelRequest`（指向一条早已
    /// 失败的请求），非单飞方法则要到进程死才回收。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn write_failure_clears_pending_and_inflight() {
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let inflight = Arc::new(Mutex::new(InflightRequestTracker::new()));
        let (writer, writer_rx) = crossbeam_channel::unbounded::<Message>();
        // 写端无人接收（writer 线程已因 stdin 破裂返回）。
        drop(writer_rx);

        let failure = do_send_request(
            Arc::clone(&pending),
            writer,
            Arc::clone(&inflight),
            "textDocument/hover",
            definition_params(),
            false,
            TEST_BUDGET,
        )
        .await
        .expect_err("closed writer must fail the request");
        assert!(
            matches!(failure, RequestFailure::Channel(_)),
            "写失败是会话级失败（Channel），实际 {failure:?}"
        );

        // 同一任务内、await 之后读取 ⇒ 确定性（无需轮询）。
        assert!(
            pending.lock().expect("infallible").is_empty(),
            "写失败后必须摘除 pending 条目（否则该 id 泄漏到会话结束）"
        );
        assert_eq!(
            inflight.lock().expect("infallible").pending_buckets(),
            0,
            "写失败后必须释放单飞桶（否则下一条同类请求会把陈旧 id 当在途取消）"
        );
    }

    /// R4/AC4/D5：服务器沉默时请求必须在**预算内**失败，且
    /// ① `pending` 已清空（命令必须 settle，不能永久 loading）；
    /// ② 向服务器发出一条 `$/cancelRequest`（与 `send_shutdown_request_bounded`
    ///    的看门狗同一不变量：客户端不再等，就必须告诉服务器别算了）。
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn silent_server_times_out_and_cancels() {
        let (pending, writer, inflight, server) = harness_with_reply(Reply::Silent);
        let budget = Duration::from_millis(50);
        let started = std::time::Instant::now();

        // 测试侧护栏：即使实现丢失 deadline，也不会把整个测试挂死（红时不 hang）。
        let failure = tokio::time::timeout(
            Duration::from_secs(5),
            do_send_request(
                Arc::clone(&pending),
                writer.clone(),
                Arc::clone(&inflight),
                "textDocument/definition",
                definition_params(),
                false,
                budget,
            ),
        )
        .await
        .expect("请求必须在预算内收口 —— 永不 resolve 就是「Tauri 命令永久 loading」")
        .expect_err("沉默服务器必须让请求失败");

        match failure {
            RequestFailure::Timeout {
                ref method,
                budget: b,
            } => {
                assert_eq!(method, "textDocument/definition");
                assert_eq!(b, budget);
            }
            other => panic!("沉默服务器必须归类为 Timeout，实际 {other:?}"),
        }
        assert!(
            started.elapsed() >= Duration::from_millis(40),
            "不得立刻失败（那是把「沉默」当「通道断」），实际 {:?}",
            started.elapsed()
        );
        assert!(
            pending.lock().expect("infallible").is_empty(),
            "超时后必须摘除 pending 条目，否则该请求的桶永不回收"
        );
        server.wait_cancel_count(1);

        drop(writer);
        server.join();
    }

    // ── S3：id 空间唯一（R3/D4）─────────────────────────────────────────

    /// 出站 id 只有一个来源：连续分配必须严格递增（跨调用点共享同一个计数器）。
    #[test]
    fn next_request_id_comes_from_one_allocator() {
        let a = next_request_id();
        let b = next_request_id();
        let c = next_request_id();
        assert!(
            a < b && b < c,
            "单一 allocator 必须严格单调，实际 {a:?} {b:?} {c:?}"
        );
    }

    /// 同 id 二次登记必须**失败**（不得覆盖）：覆盖会 drop 前一个等待者的发送端，
    /// 它立刻以「无响应」失败并被误判成会话故障（审计 channel D4）。
    #[test]
    fn pending_insert_refuses_duplicate_id() {
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let id = next_request_id();

        let (tx1, mut rx1) = tokio::sync::oneshot::channel::<Message>();
        register_pending(&pending, &id, tx1).expect("首次登记必须成功");

        let (tx2, _rx2) = tokio::sync::oneshot::channel::<Message>();
        let failure =
            register_pending(&pending, &id, tx2).expect_err("同 id 二次登记必须失败（不得覆盖）");
        assert!(
            matches!(failure, RequestFailure::Channel(_)),
            "重复 id 是内部不变量破裂导致的通道损坏，实际 {failure:?}"
        );

        // 原始等待者必须仍然可达（这就是「不得静默覆盖」的可观测判据）。
        let survivor = pending
            .lock()
            .expect("infallible")
            .remove(&id)
            .expect("原始 sender 必须仍在表里（被覆盖 = 被静默 drop）");
        survivor
            .send(Message::Response(Response::new_ok(id.clone(), Value::Null)))
            .expect("原始 sender 必须仍可发送");
        assert!(
            rx1.try_recv().is_ok(),
            "前一个等待者不得被静默 drop（那会伪装成「服务器无响应」）"
        );
    }
}
