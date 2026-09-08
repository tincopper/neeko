//! Debug adapter registry — resolve a plugin by launch `type`, and probe
//! adapter availability in the project environment.
//!
//! Kept out of `mod.rs` (AGENTS.md red line 9: mod.rs is declarations only).
//! The plugin singletons (`GO` / `LLDB`) and the [`DebugAdapterPlugin`] trait
//! live in the parent module; this file only wires launch `type` strings to
//! plugins.

use super::{DebugAdapterPlugin, GO, LLDB};
use crate::common::executor::factory::ExecTarget;
use crate::AppError;

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
    use crate::dap::types::{AdapterKind, AdapterTransport, HandshakeOrder};

    #[tokio::test]
    async fn should_resolve_go_plugin_spawn_shape() {
        let p = plugin_for("go").expect("go");
        assert_eq!(p.kind(), AdapterKind::Go);
        assert_eq!(p.adapter_id(), "go");
        assert_eq!(p.handshake_order(), HandshakeOrder::LaunchBeforeBreakpoints);
        // May fail if dlv missing — only assert shape when available.
        if p.is_available(&ExecTarget::Local).await {
            let spawn = p
                .resolve_spawn(&ExecTarget::Local, None)
                .await
                .expect("spawn");
            assert_eq!(spawn.program, "dlv");
            assert_eq!(spawn.transport, AdapterTransport::TcpListen);
            assert!(spawn.args.iter().any(|a| a == "dap"));
            // 显式二进制覆盖：优先于默认探测
            let overridden = p
                .resolve_spawn(&ExecTarget::Local, Some("/custom/dlv"))
                .await
                .expect("spawn");
            assert_eq!(overridden.program, "/custom/dlv");
        }
    }

    #[test]
    fn should_reject_unknown_type() {
        assert!(plugin_for("python").is_err());
    }
}
