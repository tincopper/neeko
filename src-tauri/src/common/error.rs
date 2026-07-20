use serde::Serialize;
use thiserror::Error;

/// Application-level error type covering all domain error categories.
#[derive(Error, Debug, Clone)]
pub enum AppError {
    /// An I/O operation failed.
    #[error("IO error: {0}")]
    Io(String),
    /// A git operation failed.
    #[error("Git error: {0}")]
    Git(String),
    /// A storage/database operation failed.
    #[error("Storage error: {0}")]
    Storage(String),
    /// A skill operation failed.
    #[error("Skill error: {0}")]
    Skill(String),
    /// A project-level operation failed.
    #[error("Project error: {0}")]
    Project(String),
    /// The requested resource was not found.
    #[error("Not found: {0}")]
    NotFound(String),
    /// The provided input was invalid.
    #[error("Invalid input: {0}")]
    InvalidInput(String),
    /// A remote connection/host operation failed.
    #[error("Remote error: {0}")]
    Remote(String),
    /// A WSL-specific operation failed.
    #[error("WSL error: {0}")]
    Wsl(String),
    /// A terminal operation failed.
    #[error("Terminal error: {0}")]
    Terminal(String),
    /// An agent operation failed.
    #[error("Agent error: {0}")]
    Agent(String),
    /// An IDE launch/interaction failed.
    #[error("IDE error: {0}")]
    Ide(String),
    /// The requested operation is unsupported.
    #[error("Unsupported: {0}")]
    Unsupported(String),
    /// A file operation failed.
    #[error("File error: {0}")]
    File(String),
    /// A mutex lock was poisoned.
    #[error("Lock poisoned: {0}")]
    LockPoisoned(String),
    /// An LSP operation failed.
    #[error("LSP error: {0}")]
    Lsp(String),
    /// A DAP operation failed.
    #[error("DAP error: {0}")]
    Dap(String),
    /// An unknown or unclassified error occurred.
    #[error("Unknown error: {0}")]
    Unknown(String),
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Io(err.to_string())
    }
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        AppError::Unknown(err.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::Storage(err.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        AppError::Storage(err.to_string())
    }
}

impl From<std::sync::PoisonError<std::sync::MutexGuard<'_, crate::project::ProjectManager>>>
    for AppError
{
    fn from(
        err: std::sync::PoisonError<std::sync::MutexGuard<'_, crate::project::ProjectManager>>,
    ) -> Self {
        AppError::LockPoisoned(err.to_string())
    }
}

impl From<std::sync::PoisonError<std::sync::MutexGuard<'_, crate::agent::AgentManager>>>
    for AppError
{
    fn from(
        err: std::sync::PoisonError<std::sync::MutexGuard<'_, crate::agent::AgentManager>>,
    ) -> Self {
        AppError::LockPoisoned(err.to_string())
    }
}

impl From<std::sync::PoisonError<std::sync::MutexGuard<'_, Option<String>>>> for AppError {
    fn from(err: std::sync::PoisonError<std::sync::MutexGuard<'_, Option<String>>>) -> Self {
        AppError::LockPoisoned(err.to_string())
    }
}

impl From<String> for AppError {
    fn from(err: String) -> Self {
        AppError::Unknown(err)
    }
}

impl From<tauri::Error> for AppError {
    fn from(err: tauri::Error) -> Self {
        AppError::Unknown(err.to_string())
    }
}

impl From<&str> for AppError {
    fn from(err: &str) -> Self {
        AppError::Unknown(err.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
