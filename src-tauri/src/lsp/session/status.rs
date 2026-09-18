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
    /// **服务端不会发出该状态**：`indexing` 是前端由 work-done 进度 token 合成的
    /// 展示态（见 lspStore 的 `progressTokens`）。此处保留该变体是为了让
    /// `as_str` 覆盖前端可见的完整状态词表，相位归一化见 `Lifecycle`（→ Ready）。
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
