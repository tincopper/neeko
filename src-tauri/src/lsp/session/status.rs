/// Lifecycle status of an LSP session, emitted to the frontend.
#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)]
pub(crate) enum LspSessionStatus {
    /// Server process is starting.
    Starting,
    /// Initialize handshake in progress.
    Initializing,
    /// Server is indexing the workspace.
    ///
    /// **服务端没有该相位**：LSP 协议里没有 `indexing` 状态，它由 `$/progress` /
    /// `experimental/serverStatus` 等 work-done 进度**合成**（见 `notify::handle_progress_notification`）。
    /// 合成事件同样必须经 `publish_status`（相位 + 事件同一写点，并受终态门约束）；
    /// 相位归一为 `Ready`（会话确实可用，见 `Lifecycle::set`）。
    Indexing,
    /// Server is ready to accept requests.
    Ready,
    /// An error occurred (carries message).
    Error(String),
    /// Session has been stopped.
    Stopped,
}

impl LspSessionStatus {
    pub(crate) const fn as_str(&self) -> &str {
        match self {
            LspSessionStatus::Starting => "starting",
            LspSessionStatus::Initializing => "initializing",
            LspSessionStatus::Indexing => "indexing",
            LspSessionStatus::Ready => "ready",
            LspSessionStatus::Error(_) => "error",
            LspSessionStatus::Stopped => "stopped",
        }
    }
}
