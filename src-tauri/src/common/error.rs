use serde::Serialize;
use thiserror::Error;

#[derive(Error, Debug, Clone)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(String),
    #[error("Git error: {0}")]
    Git(String),
    #[error("Storage error: {0}")]
    Storage(String),
    #[error("Skill error: {0}")]
    Skill(String),
    #[error("Project error: {0}")]
    Project(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Invalid input: {0}")]
    InvalidInput(String),
    #[error("Remote error: {0}")]
    Remote(String),
    #[error("WSL error: {0}")]
    Wsl(String),
    #[error("Terminal error: {0}")]
    Terminal(String),
    #[error("Agent error: {0}")]
    Agent(String),
    #[error("IDE error: {0}")]
    Ide(String),
    #[error("File error: {0}")]
    File(String),
    #[error("Lock poisoned: {0}")]
    LockPoisoned(String),
    #[error("LSP error: {0}")]
    Lsp(String),
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
