//! Terminal session model types.

use serde::{Deserialize, Serialize};

use crate::common::agent::types::AgentConfig;

/// Terminal session status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TerminalStatus {
    /// Terminal is idle (no process running).
    Idle,
    /// A process is currently running in the terminal.
    Running,
    /// The terminal process has failed.
    Failed,
}

/// A terminal session with process info and history.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSession {
    /// Unique session identifier.
    pub id: String,
    /// Process ID of the terminal shell, if available.
    pub pid: Option<u32>,
    /// Current session status.
    pub status: TerminalStatus,
    /// Command history for this session.
    pub history: Vec<String>,
    /// Optional agent configuration bound to this session.
    pub agent: Option<AgentConfig>,
}
