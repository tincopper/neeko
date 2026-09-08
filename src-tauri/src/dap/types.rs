//! Shared DAP types for IPC with the frontend and internal domain enums.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::AppError;

// ── Launch / breakpoint persistence (IPC + disk) ───────────────────────────

/// One entry in `.neeko/launch.json` `configurations` array.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchConfig {
    /// Display name for this launch configuration.
    pub name: String,
    /// Adapter type: `lldb` (Rust) or `go` (Delve).
    #[serde(rename = "type")]
    pub type_: String,
    /// `launch` or `attach` (MVP: launch).
    pub request: String,
    /// Path to the program/debug target.
    #[serde(default)]
    pub program: Option<String>,
    /// Working directory for the debug session.
    #[serde(default)]
    pub cwd: Option<String>,
    /// Command-line arguments passed to the program.
    #[serde(default)]
    pub args: Vec<String>,
    /// Go: `debug` | `test` | …
    #[serde(default)]
    pub mode: Option<String>,
    /// Optional shell command run in project env before launch (e.g. `cargo build`).
    #[serde(default)]
    pub pre_launch_task: Option<String>,
    /// Stop at program entry before running (default false — only user breakpoints).
    #[serde(default)]
    pub stop_on_entry: Option<bool>,
}

/// File-backed launch file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchFile {
    /// Launch file format version.
    #[serde(default = "default_version")]
    pub version: String,
    /// List of named launch configurations.
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
    /// Absolute file path for the breakpoint.
    pub file_path: String,
    /// 1-based line number.
    pub line: u32,
    /// Whether the adapter confirmed the breakpoint.
    #[serde(default)]
    pub verified: bool,
}

/// Active debug session snapshot for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DapSessionInfo {
    /// Unique debug session identifier.
    pub session_id: String,
    /// Project the session belongs to.
    pub project_id: String,
    /// Filesystem path of the project.
    pub project_path: String,
    /// Name of the launch configuration used.
    pub config_name: String,
    /// Wire string: starting | running | stopped | terminated
    pub status: String,
    /// Optional human-readable status detail.
    pub status_message: Option<String>,
}

/// Payload for `dap-event` Tauri events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DapEventPayload {
    /// Session that produced the event.
    pub session_id: String,
    /// Project associated with the session.
    pub project_id: String,
    /// stopped | continued | terminated | output | session
    pub kind: String,
    /// Event payload body, format depends on kind.
    #[serde(default)]
    pub body: Value,
}

/// Stack frame for UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackFrameDto {
    /// Adapter-assigned stack frame identifier.
    pub id: i64,
    /// Function name for this frame.
    pub name: String,
    /// Source file path, if available.
    pub source_path: Option<String>,
    /// 1-based line number in the source file.
    pub line: u32,
    /// 1-based column number in the source file.
    pub column: u32,
}

/// Variable for UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableDto {
    /// Variable name.
    pub name: String,
    /// String representation of the variable value.
    pub value: String,
    /// Type name reported by the debugger.
    #[serde(default, rename = "type")]
    pub var_type: Option<String>,
    /// Reference for expanding child variables (0 = no children).
    pub variables_reference: i64,
}

impl VariableDto {
    /// Parse a DAP `Variable` wire object into a [`VariableDto`].
    ///
    /// Missing fields fall back to safe defaults: `name` → `"?"`, `value` →
    /// `""`, `type` → `None`, `variablesReference` → `0` (no children).
    #[must_use]
    pub fn from_dap_json(v: &Value) -> VariableDto {
        VariableDto {
            name: v
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("?")
                .to_string(),
            value: v
                .get("value")
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_string(),
            var_type: v
                .get("type")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string()),
            variables_reference: v
                .get("variablesReference")
                .and_then(|r| r.as_i64())
                .unwrap_or(0),
        }
    }
}

// ── Domain enums (internal + IPC parsing) ──────────────────────────────────

/// Session lifecycle status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStatus {
    /// Adapter is initializing.
    Starting,
    /// Program is executing.
    Running,
    /// Program stopped at a breakpoint or exception.
    Stopped,
    /// Session ended (normally or by disconnect).
    Terminated,
}

impl SessionStatus {
    /// Return the wire-format string for this status.
    #[allow(clippy::must_use_candidate)]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Starting => "starting",
            Self::Running => "running",
            Self::Stopped => "stopped",
            Self::Terminated => "terminated",
        }
    }
}

/// Debugger control actions from the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlAction {
    /// Resume execution.
    Continue,
    /// Step over (next line).
    Next,
    /// Step into function call.
    StepIn,
    /// Step out of current function.
    StepOut,
    /// Pause execution.
    Pause,
}

impl ControlAction {
    /// Parse a control action from a UI-provided string.
    pub fn parse(action: &str) -> Result<Self, AppError> {
        match action {
            "continue" => Ok(Self::Continue),
            "next" => Ok(Self::Next),
            "stepIn" | "step_in" => Ok(Self::StepIn),
            "stepOut" | "step_out" => Ok(Self::StepOut),
            "pause" => Ok(Self::Pause),
            other => Err(AppError::Dap(format!("unknown control action: {other}"))),
        }
    }

    /// Return the DAP protocol command string for this action.
    #[allow(clippy::must_use_candidate)]
    pub const fn dap_command(self) -> &'static str {
        match self {
            Self::Continue => "continue",
            Self::Next => "next",
            Self::StepIn => "stepIn",
            Self::StepOut => "stepOut",
            Self::Pause => "pause",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_parse_control_actions() {
        assert_eq!(
            ControlAction::parse("continue").unwrap(),
            ControlAction::Continue
        );
        assert_eq!(
            ControlAction::parse("step_in").unwrap(),
            ControlAction::StepIn
        );
        assert!(ControlAction::parse("nope").is_err());
    }

    #[test]
    fn should_map_adapter_kind_from_config_type() {
        assert_eq!(
            AdapterKind::from_config_type("go").unwrap(),
            AdapterKind::Go
        );
        assert_eq!(
            AdapterKind::from_config_type("rust").unwrap(),
            AdapterKind::Lldb
        );
        assert!(AdapterKind::from_config_type("python").is_err());
    }

    #[test]
    fn should_expose_session_status_wire_strings() {
        assert_eq!(SessionStatus::Stopped.as_str(), "stopped");
        assert_eq!(SessionStatus::Terminated.as_str(), "terminated");
    }

    /// Editor inline test debug sends a synthetic launch config over IPC.
    /// The exact frontend payload shape (camelCase, optional cwd, args list)
    /// must deserialize into LaunchConfig unchanged.
    #[test]
    fn should_deserialize_synthetic_test_debug_launch_config() {
        let payload = serde_json::json!({
            "name": "Debug test: parse_simple",
            "type": "lldb",
            "request": "launch",
            "program": "/proj/target/debug/deps/neeko-abc123",
            "cwd": "/proj",
            "args": ["parse_simple"],
            "stopOnEntry": false
        });
        let cfg: LaunchConfig = serde_json::from_value(payload).expect("deserialize");
        assert_eq!(cfg.name, "Debug test: parse_simple");
        assert_eq!(cfg.type_, "lldb");
        assert_eq!(cfg.request, "launch");
        assert_eq!(
            cfg.program.as_deref(),
            Some("/proj/target/debug/deps/neeko-abc123")
        );
        assert_eq!(cfg.cwd.as_deref(), Some("/proj"));
        assert_eq!(cfg.args, vec!["parse_simple".to_string()]);
        assert_eq!(cfg.stop_on_entry, Some(false));
    }

    #[test]
    fn should_parse_dap_variable_wire_object() {
        let v = serde_json::json!({
            "name": "m",
            "value": "map[string]string{...}",
            "type": "map[string]string",
            "variablesReference": 42
        });
        let dto = VariableDto::from_dap_json(&v);
        assert_eq!(dto.name, "m");
        assert_eq!(dto.value, "map[string]string{...}");
        assert_eq!(dto.var_type.as_deref(), Some("map[string]string"));
        assert_eq!(dto.variables_reference, 42);
    }

    #[test]
    fn should_default_missing_dap_variable_fields() {
        let dto = VariableDto::from_dap_json(&serde_json::json!({}));
        assert_eq!(dto.name, "?");
        assert_eq!(dto.value, "");
        assert_eq!(dto.var_type, None);
        assert_eq!(dto.variables_reference, 0);

        // Non-string type / non-integer reference fall back too.
        let weird = serde_json::json!({ "name": "x", "type": 1, "variablesReference": "n" });
        let dto = VariableDto::from_dap_json(&weird);
        assert_eq!(dto.name, "x");
        assert_eq!(dto.value, "");
        assert_eq!(dto.var_type, None);
        assert_eq!(dto.variables_reference, 0);
    }
}

/// Supported debug adapter families.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdapterKind {
    /// Go / Delve debugger.
    Go,
    /// LLDB-based debugger for Rust and native binaries.
    Lldb,
}

impl AdapterKind {
    /// Map launch.json `type` field to a known adapter family.
    pub fn from_config_type(type_: &str) -> Result<Self, AppError> {
        match type_ {
            "go" | "delve" => Ok(Self::Go),
            "lldb" | "rust" | "codelldb" => Ok(Self::Lldb),
            other => Err(AppError::Dap(format!("Unsupported debug type: {other}"))),
        }
    }

    /// Config key for per-adapter overrides（`dap.adapterBinaries.<kind>`）。
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Go => "go",
            Self::Lldb => "lldb",
        }
    }
}

/// How Neeko speaks DAP with the adapter process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdapterTransport {
    /// Content-Length framing on adapter stdin/stdout (`lldb-dap`).
    Stdio,
    /// Adapter listens on TCP and prints listen address on stdout (`dlv dap`).
    TcpListen,
}

/// How to spawn a debug adapter process (resolved against ExecTarget).
#[derive(Debug, Clone)]
pub struct AdapterSpawn {
    /// Adapter binary name or path.
    pub program: String,
    /// Command-line arguments for the adapter.
    pub args: Vec<String>,
    /// Stdio or TCP transport mode.
    pub transport: AdapterTransport,
}

/// Delve vs generic DAP configuration order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandshakeOrder {
    /// initialize → launch → initialized → breakpoints → configurationDone
    LaunchBeforeBreakpoints,
    /// initialize → initialized → breakpoints → configurationDone → launch
    BreakpointsBeforeLaunch,
    /// lldb-dap (LLVM 22+): launch 请求内启动进程并门控响应——必须 pipelined：
    /// launch 先发不等响应 → 收 `initialized` → setBreakpoints → configurationDone
    /// → launch 响应才返回（实测：顺序 await 会 timeout waiting for launch）。
    PipelinedLaunch,
}
