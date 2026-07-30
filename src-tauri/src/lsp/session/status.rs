/// Lifecycle status of an LSP session, emitted to the frontend.
#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)]
pub(crate) enum LspSessionStatus {
    /// Server process is starting.
    Starting,
    /// Initialize handshake in progress.
    Initializing,
    /// Server is indexing the workspace.
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
