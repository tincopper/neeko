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
use super::log_ring_buffer::LogRingBuffer;
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
    fn push_diagnostics(&self, _: &str, _: &str, _: serde_json::Value) {}

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
pub(crate) fn stub_session(
    transport: Arc<dyn LspTransport>,
    project_path: &str,
    language_id: &str,
    server_name: &str,
) -> LspSession {
    let lifecycle = Arc::new(Lifecycle::new());
    lifecycle.set(&LspSessionStatus::Ready);
    let (writer, _writer_rx) = crossbeam_channel::unbounded::<lsp_server::Message>();
    LspSession {
        language_id: language_id.to_string(),
        project_path: project_path.to_string(),
        server_name: server_name.to_string(),
        writer,
        pending: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
        inflight: Arc::new(std::sync::Mutex::new(InflightRequestTracker::new())),
        reader: None,
        stderr_logger: None,
        restart_count: 0,
        server_capabilities: serde_json::json!({}),
        child: None,
        process_pid: None,
        server_info: LspServerInfo::unknown(),
        log_buffer: Arc::new(std::sync::Mutex::new(LogRingBuffer::new())),
        transport,
        in_flight_progress: Arc::new(std::sync::Mutex::new(std::collections::HashSet::new())),
        lifecycle,
    }
}
