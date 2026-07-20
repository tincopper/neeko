//! Debug adapter plugins — one cohesive strategy per language family.
//!
//! Business code resolves a plugin by launch `type`, then asks it for spawn
//! specs and launch args. All binary existence checks use
//! [`crate::core::exec`] with the project [`ExecTarget`].

mod go;
mod lldb;

use async_trait::async_trait;
use serde_json::Value;

use super::types::{
    AdapterKind, AdapterSpawn, HandshakeOrder, LaunchConfig,
};
use crate::common::executor::factory::ExecTarget;
use crate::AppError;

pub use go::GoAdapter;
pub use lldb::LldbAdapter;

/// Strategy for a language-specific debug adapter.
#[async_trait]
pub trait DebugAdapterPlugin: Send + Sync {
    fn kind(&self) -> AdapterKind;

    /// Whether this plugin handles the launch.json `type` string.
    fn matches_type(&self, type_: &str) -> bool;

    /// DAP `initialize.adapterID`.
    fn adapter_id(&self) -> &'static str;

    fn handshake_order(&self) -> HandshakeOrder;

    /// Resolve binary + args in the **project** execution environment.
    async fn resolve_spawn(&self, target: &ExecTarget) -> Result<AdapterSpawn, AppError>;

    /// Whether any suitable adapter binary exists on `target`.
    async fn is_available(&self, target: &ExecTarget) -> bool;

    fn build_launch_args(&self, cfg: &LaunchConfig, workspace: &str) -> Result<Value, AppError>;

    /// Optional function breakpoint name used when `stopOnEntry` is true
    /// (Go/Delve workaround for Dummy thread).
    fn entry_function_for_stop_on_entry(&self, stop_on_entry: bool) -> Option<&'static str>;

    fn install_hint(&self) -> &'static str;
}

static GO: GoAdapter = GoAdapter;
static LLDB: LldbAdapter = LldbAdapter;

/// Resolve the plugin for a launch configuration type.
pub fn plugin_for(type_: &str) -> Result<&'static dyn DebugAdapterPlugin, AppError> {
    if GO.matches_type(type_) {
        return Ok(&GO);
    }
    if LLDB.matches_type(type_) {
        return Ok(&LLDB);
    }
    Err(AppError::Dap(format!("Unsupported debug type: {type_}")))
}

/// Whether an adapter for `type_` exists in the project environment.
pub async fn adapter_available(type_: &str, target: &ExecTarget) -> bool {
    match plugin_for(type_) {
        Ok(p) => p.is_available(target).await,
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dap::types::AdapterTransport;

    #[tokio::test]
    async fn should_resolve_go_plugin_spawn_shape() {
        let p = plugin_for("go").expect("go");
        assert_eq!(p.kind(), AdapterKind::Go);
        assert_eq!(p.adapter_id(), "go");
        assert_eq!(p.handshake_order(), HandshakeOrder::LaunchBeforeBreakpoints);
        // May fail if dlv missing — only assert shape when available.
        if p.is_available(&ExecTarget::Local).await {
            let spawn = p.resolve_spawn(&ExecTarget::Local).await.expect("spawn");
            assert_eq!(spawn.program, "dlv");
            assert_eq!(spawn.transport, AdapterTransport::TcpListen);
            assert!(spawn.args.iter().any(|a| a == "dap"));
        }
    }

    #[test]
    fn should_reject_unknown_type() {
        assert!(plugin_for("python").is_err());
    }
}
