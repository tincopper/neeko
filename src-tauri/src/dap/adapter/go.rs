//! Delve (`dlv dap`) adapter plugin.

use async_trait::async_trait;
use serde_json::{json, Value};

use super::DebugAdapterPlugin;
use crate::common::executor::factory::ExecTarget;
use crate::core::exec;
use crate::dap::types::{
    AdapterKind, AdapterSpawn, AdapterTransport, HandshakeOrder, LaunchConfig,
};
use crate::AppError;

pub struct GoAdapter;

#[async_trait]
impl DebugAdapterPlugin for GoAdapter {
    fn kind(&self) -> AdapterKind {
        AdapterKind::Go
    }

    fn matches_type(&self, type_: &str) -> bool {
        matches!(type_, "go" | "delve")
    }

    fn adapter_id(&self) -> &'static str {
        "go"
    }

    fn handshake_order(&self) -> HandshakeOrder {
        HandshakeOrder::LaunchBeforeBreakpoints
    }

    async fn resolve_spawn(&self, target: &ExecTarget) -> Result<AdapterSpawn, AppError> {
        if !exec::command_exists(target, "dlv").await {
            return Err(AppError::Dap(format!(
                "Debug adapter 'dlv' not found. {}",
                self.install_hint()
            )));
        }
        Ok(AdapterSpawn {
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
        })
    }

    async fn is_available(&self, target: &ExecTarget) -> bool {
        exec::command_exists(target, "dlv").await
    }

    fn build_launch_args(&self, cfg: &LaunchConfig, workspace: &str) -> Result<Value, AppError> {
        let cwd = cfg
            .cwd
            .clone()
            .unwrap_or_else(|| workspace.to_string());
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

    fn entry_function_for_stop_on_entry(&self, stop_on_entry: bool) -> Option<&'static str> {
        if stop_on_entry {
            Some("main.main")
        } else {
            None
        }
    }

    fn install_hint(&self) -> &'static str {
        "Install Delve: go install github.com/go-delve/delve/cmd/dlv@latest"
    }
}
