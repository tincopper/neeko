//! Test-only fixtures shared by the session and manager test modules.
//!
//! 存在的理由：`LspSession` 是一张 18 字段的宽结构体，测试需要「无真实进程」的
//! 桩实例。此前 instance 与 manager 的测试模块各自维护一份字面量，新增字段要改
//! 两处，且 manager 侧为了构造它必须让 `session` 模块 `#[cfg(test)]` 额外
//! re-export 内部类型（测试需求倒逼生产模块暴露内部实现）。夹具收敛到此处后：
//! 字段变更只改一个地方，`session` 模块的门面不再为测试开口子。

use std::sync::Arc;

use crate::lsp::inflight::InflightRequestTracker;
use crate::lsp::transport::LspTransport;
use crate::lsp::types::LspServerInfo;

use super::lifecycle::Lifecycle;
use super::status::LspSessionStatus;
use super::LspSession;

/// 捕获 `push_session_event` 的 transport：`(project, language, status, message, pct)`。
#[derive(Default)]
pub(crate) struct RecordingTransport {
    events: parking_lot::Mutex<Vec<RecordedEvent>>,
}

/// 一条被捕获的生命周期事件。
pub(crate) type RecordedEvent = (String, String, String, Option<String>, Option<u32>);

impl RecordingTransport {
    pub(crate) fn take(&self) -> Vec<RecordedEvent> {
        self.events.lock().clone()
    }

    /// 是否捕获到指定 (project, language, status) 的事件。
    pub(crate) fn has(&self, project_path: &str, language_id: &str, status: &str) -> bool {
        self.events
            .lock()
            .iter()
            .any(|(pp, lid, s, _, _)| pp == project_path && lid == language_id && s == status)
    }
}

impl LspTransport for RecordingTransport {
    fn push_diagnostics(&self, _: &str, _: &str, _: serde_json::Value, _: Option<i64>) {}

    fn push_session_event(
        &self,
        project_path: &str,
        language_id: &str,
        status: &str,
        message: Option<&str>,
        progress_pct: Option<u32>,
    ) {
        self.events.lock().push((
            project_path.to_string(),
            language_id.to_string(),
            status.to_string(),
            message.map(String::from),
            progress_pct,
        ));
    }
}

/// 无真实进程、无 reader 线程的桩会话，生命周期初始为 `Ready`
/// （生产会话装配完成、登记进 store 时的常态）。
///
/// 注意：writer 的接收端被丢弃 ⇒ 任何出站报文都会**发送失败**。
/// 要断言报文时序（关闭序列）请用 [`stub_session_with_writer`]。
pub(crate) fn stub_session(
    transport: Arc<dyn LspTransport>,
    project_path: &str,
    language_id: &str,
    server_name: &str,
) -> LspSession {
    stub_session_with_writer(transport, project_path, language_id, server_name).0
}

/// 返回 writer **接收端**的桩会话：关闭序列的报文时序（`shutdown` request → `exit`
/// notification）必须可断言，而报文只从 `writer` 出站。
///
/// 调用方`Drop` 掉接收端时行为退化回 [`stub_session`]（发送即失败）。
pub(crate) fn stub_session_with_writer(
    transport: Arc<dyn LspTransport>,
    project_path: &str,
    language_id: &str,
    server_name: &str,
) -> (LspSession, crossbeam_channel::Receiver<lsp_server::Message>) {
    let lifecycle = Arc::new(Lifecycle::new());
    lifecycle.set(&LspSessionStatus::Ready);
    let (writer, writer_rx) = crossbeam_channel::unbounded::<lsp_server::Message>();
    let session = LspSession {
        language_id: language_id.to_string(),
        project_path: project_path.to_string(),
        server_name: server_name.to_string(),
        writer,
        pending: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        inflight: Arc::new(std::sync::Mutex::new(InflightRequestTracker::new())),
        reader: None,
        stderr_logger: None,
        restart_count: 0,
        // 夹具用极短宽限：关闭序列的等待必须有界，且测试不得堆真实秒级墙钟。
        shutdown_grace: std::time::Duration::from_millis(20),
        // 夹具预算：成功路径（假服务器立刻应答）不受影响，沉默服务器在用例自己的
        // 时限内失败（不堆真实秒数）。
        request_timeout: std::time::Duration::from_secs(2),
        server_capabilities: serde_json::json!({}),
        child: None,
        process_pid: None,
        server_info: LspServerInfo::unknown(),
        transport,
        in_flight_progress: Arc::new(std::sync::Mutex::new(std::collections::HashSet::new())),
        lifecycle,
    };
    (session, writer_rx)
}

/// reader 线程存活的桩会话（[`LspSession::is_alive`] 为真）。
///
/// 存在的理由：`is_alive` 的语义是「reader 存活」，`stub_session` 的 `reader: None`
/// 让它恒为假 —— 编排层的**快路径**（复用活会话，不重装配、不切换生代）因此无法
/// 受测。返回的 [`LiveReader`] 是线程存活凭据：持有它 reader 就活着，drop 后线程
/// 自行退出（无 join、无泄漏）。
pub(crate) fn live_stub_session(
    transport: Arc<dyn LspTransport>,
    project_path: &str,
    language_id: &str,
    server_name: &str,
) -> (LspSession, LiveReader) {
    // writer 接收端被丢弃 ⇒ 出站报文失败（「通道已死」的最小现场）。
    let (session, _writer_rx, reader) =
        live_stub_session_with_writer(transport, project_path, language_id, server_name);
    (session, reader)
}

/// [`live_stub_session`] + [`stub_session_with_writer`] 的组合：reader **存活**且
/// 出站报文可被读取/应答。
///
/// 存在的理由：重启路径的判据要求「旧会话还活着」（`is_alive` 为真才会被
/// `get_or_create_session` 的快路径复用 —— 那正是「计数器在涨、进程不换」的缺陷
/// 现场），同时又需要向服务器发出请求。两者缺一不可。
pub(crate) fn live_stub_session_with_writer(
    transport: Arc<dyn LspTransport>,
    project_path: &str,
    language_id: &str,
    server_name: &str,
) -> (
    LspSession,
    crossbeam_channel::Receiver<lsp_server::Message>,
    LiveReader,
) {
    let (mut session, writer_rx) =
        stub_session_with_writer(transport, project_path, language_id, server_name);
    let (tx, rx) = crossbeam_channel::bounded::<()>(1);
    session.reader = Some(
        std::thread::Builder::new()
            .name("lsp-live-stub-reader".to_string())
            .spawn(move || {
                // 一直阻塞到凭据 drop（通道断开），模拟"reader 仍在读"。
                let _ = rx.recv();
                Ok(())
            })
            .expect("spawn live stub reader"),
    );
    (session, writer_rx, LiveReader { _tx: tx })
}

/// [`live_stub_session`] 的 reader 存活凭据。
pub(crate) struct LiveReader {
    _tx: crossbeam_channel::Sender<()>,
}
