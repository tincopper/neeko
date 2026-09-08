//! Debug adapter plugins — one cohesive strategy per language family.
//!
//! Business code resolves a plugin by launch `type`, then asks it for spawn
//! specs and launch args. All binary existence checks use
//! [`crate::core::exec`] with the project [`ExecTarget`].

mod go;
mod lldb;
mod registry;

use async_trait::async_trait;
use serde_json::Value;

use super::types::{AdapterKind, AdapterSpawn, HandshakeOrder, LaunchConfig};
use crate::common::executor::factory::ExecTarget;
use crate::AppError;

pub use go::GoAdapter;
pub use lldb::LldbAdapter;
pub use registry::{adapter_available, plugin_for};

/// Strategy for a language-specific debug adapter.
#[async_trait]
pub trait DebugAdapterPlugin: Send + Sync {
    /// Return the adapter family identifier for this plugin.
    fn kind(&self) -> AdapterKind;

    /// Whether this plugin handles the launch.json `type` string.
    fn matches_type(&self, type_: &str) -> bool;

    /// DAP `initialize.adapterID`.
    fn adapter_id(&self) -> &'static str;

    /// Whether to send breakpoints before or after the launch request.
    fn handshake_order(&self) -> HandshakeOrder;

    /// Resolve binary + args in the **project** execution environment.
    /// `adapter_binary`（config `dap.adapterBinaries.<kind>`，对齐 Zed
    /// `dap.$ADAPTER.binary`）存在时覆盖默认探测——用户可指到自定义
    /// codelldb / lldb-dap / dlv 而不必改 PATH。
    async fn resolve_spawn(
        &self,
        target: &ExecTarget,
        adapter_binary: Option<&str>,
    ) -> Result<AdapterSpawn, AppError>;

    /// Whether any suitable adapter binary exists on `target`.
    async fn is_available(&self, target: &ExecTarget) -> bool;

    /// Build the `launch` request arguments for this adapter type.
    fn build_launch_args(&self, cfg: &LaunchConfig, workspace: &str) -> Result<Value, AppError>;

    /// Optional function breakpoint name used when `stopOnEntry` is true
    /// (Go/Delve workaround for Dummy thread).
    fn entry_function_for_stop_on_entry(&self, stop_on_entry: bool) -> Option<&'static str>;

    /// Hint shown to the user when the adapter binary is not found.
    fn install_hint(&self) -> &'static str;
}

/// Singleton Go adapter plugin.
static GO: GoAdapter = GoAdapter;
/// Singleton LLDB adapter plugin.
static LLDB: LldbAdapter = LldbAdapter;
