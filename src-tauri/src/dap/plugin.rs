//! Debug adapter plugins (command lines + launch body shaping).

use serde_json::{json, Value};

use super::types::LaunchConfig;
use crate::common::executor::factory::ExecTarget;

/// How Neeko speaks DAP with the adapter process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdapterTransport {
    /// Content-Length framing on adapter stdin/stdout (`lldb-dap`).
    Stdio,
    /// Adapter listens on TCP and prints `… server listening at: host:port` on stdout.
    /// Used by Delve (`dlv dap --listen=127.0.0.1:0`).
    TcpListen,
}

/// How to spawn a debug adapter process.
#[derive(Debug, Clone)]
pub struct AdapterSpawn {
    pub program: String,
    pub args: Vec<String>,
    pub transport: AdapterTransport,
}

/// Resolve adapter binary + args for a launch config type.
pub fn resolve_adapter(type_: &str) -> Result<AdapterSpawn, String> {
    match type_ {
        "go" | "delve" => Ok(AdapterSpawn {
            program: "dlv".into(),
            // Delve is a headless TCP DAP server (not stdio).
            // `--listen=127.0.0.1:0` picks an ephemeral port; address is printed on stdout:
            // `DAP server listening at: 127.0.0.1:<port>`
            args: vec![
                "dap".into(),
                "--listen=127.0.0.1:0".into(),
                "--log".into(),
            ],
            transport: AdapterTransport::TcpListen,
        }),
        "lldb" | "rust" | "codelldb" => {
            // Prefer LLVM lldb-dap; fall back to codelldb if users only have that.
            if crate::core::exec::local_command_exists("lldb-dap") {
                Ok(AdapterSpawn {
                    program: "lldb-dap".into(),
                    args: vec![],
                    transport: AdapterTransport::Stdio,
                })
            } else {
                Ok(AdapterSpawn {
                    program: "codelldb".into(),
                    // codelldb default may still need port wiring; stdio is best-effort for MVP.
                    args: vec![],
                    transport: AdapterTransport::Stdio,
                })
            }
        }
        other => Err(format!("Unsupported debug type: {other}")),
    }
}

/// Whether the adapter binary exists in the project environment.
pub fn adapter_available(type_: &str, target: &ExecTarget) -> bool {
    let Ok(spawn) = resolve_adapter(type_) else {
        return false;
    };
    // For lldb we may have chosen codelldb as fallback — check both candidates.
    if matches!(type_, "lldb" | "rust" | "codelldb") {
        return crate::core::exec::command_exists_blocking(target, "lldb-dap")
            || crate::core::exec::command_exists_blocking(target, "codelldb");
    }
    crate::core::exec::command_exists_blocking(target, &spawn.program)
}

/// Build the `launch` request arguments object for the adapter.
pub fn build_launch_args(cfg: &LaunchConfig, workspace: &str) -> Result<Value, String> {
    let cwd = cfg
        .cwd
        .clone()
        .unwrap_or_else(|| workspace.to_string());
    match cfg.type_.as_str() {
        "go" | "delve" => {
            let program = cfg
                .program
                .clone()
                .unwrap_or_else(|| workspace.to_string());
            let mode = cfg.mode.clone().unwrap_or_else(|| "debug".into());
            // Delve's DAP stopOnEntry leaves a Dummy thread that cannot stackTrace.
            // Entry pause is implemented via setFunctionBreakpoints("main.main") instead.
            Ok(json!({
                "mode": mode,
                "program": program,
                "cwd": cwd,
                "args": cfg.args,
                "stopOnEntry": false,
            }))
        }
        "lldb" | "rust" | "codelldb" => {
            let program = cfg.program.clone().ok_or_else(|| {
                "Rust/lldb launch requires \"program\" (path to binary)".to_string()
            })?;
            let stop_on_entry = cfg.stop_on_entry.unwrap_or(false);
            Ok(json!({
                "program": program,
                "cwd": cwd,
                "args": cfg.args,
                "stopOnEntry": stop_on_entry,
            }))
        }
        other => Err(format!("Unsupported debug type: {other}")),
    }
}

/// Initialize request adapterID field.
pub fn adapter_id(type_: &str) -> &'static str {
    match type_ {
        "go" | "delve" => "go",
        _ => "lldb",
    }
}

/// Parse Delve / headless listen line from a single stdout line.
///
/// Accepts both:
/// - `DAP server listening at: 127.0.0.1:12345`
/// - `API server listening at: 127.0.0.1:12345`
pub fn parse_listen_addr_line(line: &str) -> Option<String> {
    const MARKER: &str = " server listening at: ";
    let idx = line.find(MARKER)?;
    let addr = line[idx + MARKER.len()..].trim();
    if addr.is_empty() {
        return None;
    }
    // Reject the old mistaken "stdio" pseudo-address early.
    if addr.eq_ignore_ascii_case("stdio") {
        return None;
    }
    Some(addr.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_resolve_go_as_tcp_listen_dlv() {
        let spawn = resolve_adapter("go").expect("go");
        assert_eq!(spawn.program, "dlv");
        assert_eq!(spawn.transport, AdapterTransport::TcpListen);
        assert!(spawn.args.iter().any(|a| a == "dap"));
        assert!(spawn
            .args
            .iter()
            .any(|a| a.starts_with("--listen=127.0.0.1:")));
    }

    #[test]
    fn should_parse_dap_listen_line() {
        assert_eq!(
            parse_listen_addr_line("DAP server listening at: 127.0.0.1:58129"),
            Some("127.0.0.1:58129".into())
        );
        assert_eq!(
            parse_listen_addr_line("API server listening at: 127.0.0.1:9"),
            Some("127.0.0.1:9".into())
        );
        assert_eq!(parse_listen_addr_line("nope"), None);
        assert_eq!(
            parse_listen_addr_line("DAP server listening at: stdio"),
            None
        );
    }
}
