//! [`DebugAdapterPlugin`]：每种语言族的调试适配器策略。

use async_trait::async_trait;
use serde_json::Value;

use super::super::types::{AdapterKind, AdapterSpawn, HandshakeOrder, LaunchConfig};
use crate::common::executor::factory::ExecTarget;
use crate::AppError;

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

    /// DAP 请求命令名（握手第一步）：默认 `launch`。
    ///
    /// Java 依据 `cfg.request` 区分两种形态 —— `launch`（B'：JDTLS 进程内的
    /// java-debug server 自行注入 jdwp 并 spawn 被测 JVM）与 `attach`（A：自写 host
    /// 连接已由 Neeko 挂起的 JVM）。形态属于**配置**而非适配器实例，故从 cfg 读取。
    fn launch_request_command<'a>(&self, cfg: &'a LaunchConfig) -> &'a str {
        let _ = cfg;
        "launch"
    }

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
