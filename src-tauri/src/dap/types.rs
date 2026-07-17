//! Shared DAP types for IPC with the frontend.

use serde::{Deserialize, Serialize};
use serde_json::Value; // used by DapEventPayload

/// One entry in `.neeko/launch.json` `configurations` array.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchConfig {
    pub name: String,
    /// Adapter type: `lldb` (Rust) or `go` (Delve).
    #[serde(rename = "type")]
    pub type_: String,
    /// `launch` or `attach` (MVP: launch).
    pub request: String,
    #[serde(default)]
    pub program: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    /// Go: `debug` | `test` | …
    #[serde(default)]
    pub mode: Option<String>,
    /// Optional shell command run in project env before launch (e.g. `cargo build`).
    #[serde(default)]
    pub pre_launch_task: Option<String>,
    /// Stop at program entry before running (default true — required for stable UI).
    #[serde(default)]
    pub stop_on_entry: Option<bool>,
}

/// File-backed launch file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchFile {
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub configurations: Vec<LaunchConfig>,
}

fn default_version() -> String {
    "0.1.0".into()
}

impl Default for LaunchFile {
    fn default() -> Self {
        Self {
            version: default_version(),
            configurations: Vec::new(),
        }
    }
}

/// Breakpoint as seen by the UI (1-based lines).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakpointSpec {
    pub file_path: String,
    pub line: u32,
    #[serde(default)]
    pub verified: bool,
}

/// Active debug session snapshot for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DapSessionInfo {
    pub session_id: String,
    pub project_id: String,
    pub project_path: String,
    pub config_name: String,
    pub status: String,
    pub status_message: Option<String>,
}

/// Payload for `dap-event` Tauri events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DapEventPayload {
    pub session_id: String,
    pub project_id: String,
    /// stopped | continued | terminated | output | session
    pub kind: String,
    #[serde(default)]
    pub body: Value,
}

/// Stack frame for UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackFrameDto {
    pub id: i64,
    pub name: String,
    pub source_path: Option<String>,
    pub line: u32,
    pub column: u32,
}

/// Variable for UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableDto {
    pub name: String,
    pub value: String,
    #[serde(default, rename = "type")]
    pub var_type: Option<String>,
    pub variables_reference: i64,
}
