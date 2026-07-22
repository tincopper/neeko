//! LLDB / CodeLLDB adapter plugin (Rust and native binaries).

use async_trait::async_trait;
use serde_json::{json, Value};

use super::DebugAdapterPlugin;
use crate::common::executor::factory::ExecTarget;
use crate::core::exec;
use crate::dap::types::{
    AdapterKind, AdapterSpawn, AdapterTransport, HandshakeOrder, LaunchConfig,
};
use crate::AppError;

/// LLDB / CodeLLDB adapter plugin for Rust and native binaries.
pub struct LldbAdapter;

#[async_trait]
impl DebugAdapterPlugin for LldbAdapter {
    fn kind(&self) -> AdapterKind {
        AdapterKind::Lldb
    }

    fn matches_type(&self, type_: &str) -> bool {
        matches!(type_, "lldb" | "rust" | "codelldb")
    }

    fn adapter_id(&self) -> &'static str {
        "lldb"
    }

    fn handshake_order(&self) -> HandshakeOrder {
        HandshakeOrder::BreakpointsBeforeLaunch
    }

    async fn resolve_spawn(&self, target: &ExecTarget) -> Result<AdapterSpawn, AppError> {
        // Prefer LLVM lldb-dap; fall back to codelldb — always on project target.
        if exec::command_exists(target, "lldb-dap").await {
            return Ok(AdapterSpawn {
                program: "lldb-dap".into(),
                args: vec![],
                transport: AdapterTransport::Stdio,
            });
        }
        if exec::command_exists(target, "codelldb").await {
            return Ok(AdapterSpawn {
                program: "codelldb".into(),
                args: vec![],
                transport: AdapterTransport::Stdio,
            });
        }
        Err(AppError::Dap(format!(
            "Debug adapter for lldb/rust not found (looked for lldb-dap, codelldb). {}",
            self.install_hint()
        )))
    }

    async fn is_available(&self, target: &ExecTarget) -> bool {
        exec::command_exists(target, "lldb-dap").await
            || exec::command_exists(target, "codelldb").await
    }

    fn build_launch_args(&self, cfg: &LaunchConfig, workspace: &str) -> Result<Value, AppError> {
        let cwd = cfg.cwd.clone().unwrap_or_else(|| workspace.to_string());
        let program = cfg.program.clone().ok_or_else(|| {
            AppError::Dap("Rust/lldb launch requires \"program\" (path to binary)".into())
        })?;
        let stop_on_entry = cfg.stop_on_entry.unwrap_or(false);
        Ok(json!({
            "program": program,
            "cwd": cwd,
            "args": cfg.args,
            "stopOnEntry": stop_on_entry,
        }))
    }

    fn entry_function_for_stop_on_entry(&self, _stop_on_entry: bool) -> Option<&'static str> {
        // lldb uses native stopOnEntry in launch args.
        None
    }

    fn install_hint(&self) -> &'static str {
        "Install lldb-dap (LLVM) or codelldb and ensure it is on PATH in the project environment"
    }
}
