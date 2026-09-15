//! Debug adapter registry — resolve a plugin by launch `type`, and probe
//! adapter availability in the project environment.
//!
//! Holds the plugin singletons and the `type` → plugin wiring. The
//! [`DebugAdapterPlugin`] trait itself lives in `plugin.rs`
//! (AGENTS.md red line 9: `mod.rs` is declarations only).

use super::go::GoAdapter;
use super::java::JavaAdapter;
use super::lldb::LldbAdapter;
use super::plugin::DebugAdapterPlugin;
use crate::common::executor::factory::ExecTarget;
use crate::AppError;

/// Singleton Go adapter plugin.
static GO: GoAdapter = GoAdapter;
/// Singleton Java host adapter plugin.
static JAVA: JavaAdapter = JavaAdapter;
/// Singleton LLDB adapter plugin.
static LLDB: LldbAdapter = LldbAdapter;

/// Resolve the plugin for a launch configuration type.
pub fn plugin_for(type_: &str) -> Result<&'static dyn DebugAdapterPlugin, AppError> {
    if GO.matches_type(type_) {
        return Ok(&GO);
    }
    if JAVA.matches_type(type_) {
        return Ok(&JAVA);
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

    /// Java 形态由配置决定：attach（A：自写 host）与 launch（B'：JDTLS 内 server）。
    #[test]
    fn should_resolve_java_plugin() {
        let p = plugin_for("java").expect("java");
        assert_eq!(p.kind(), AdapterKind::Java);
        assert_eq!(p.adapter_id(), "java");
        assert_eq!(p.handshake_order(), HandshakeOrder::LaunchBeforeBreakpoints);
        assert_eq!(p.entry_function_for_stop_on_entry(true), None);

        let attach = crate::dap::types::LaunchConfig {
            request: "attach".into(),
            ..java_probe_cfg()
        };
        let launch = crate::dap::types::LaunchConfig {
            request: "launch".into(),
            ..java_probe_cfg()
        };
        assert_eq!(p.launch_request_command(&attach), "attach");
        assert_eq!(p.launch_request_command(&launch), "launch");

        let junit = plugin_for("junit").expect("junit");
        assert_eq!(junit.kind(), AdapterKind::Java);
        // AdapterKind::from_config_type 与 registry 同源。
        assert_eq!(
            crate::dap::types::AdapterKind::from_config_type("java").unwrap(),
            AdapterKind::Java
        );
        assert_eq!(
            crate::dap::types::AdapterKind::from_config_type("junit").unwrap(),
            AdapterKind::Java
        );
    }

    /// 非 Java 适配器恒用 `launch` —— 配置里的 `request` 不得改变其握手命令。
    #[test]
    fn non_java_plugins_always_use_launch_command() {
        let cfg = crate::dap::types::LaunchConfig {
            request: "attach".into(),
            ..java_probe_cfg()
        };
        for type_ in ["go", "lldb", "rust"] {
            let p = plugin_for(type_).expect(type_);
            assert_eq!(
                p.launch_request_command(&cfg),
                "launch",
                "{type_} 不得因 cfg.request 走 attach"
            );
        }
    }

    /// 构造探针用的最小配置（仅 registry 测试使用；不启动任何会话）。
    fn java_probe_cfg() -> crate::dap::types::LaunchConfig {
        crate::dap::types::LaunchConfig {
            name: "probe".into(),
            type_: "java".into(),
            request: "launch".into(),
            program: None,
            cwd: None,
            args: vec![],
            mode: None,
            port: None,
            pre_launch_task: None,
            stop_on_entry: None,
            classpath: vec![],
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn should_probe_java_availability_without_panicking() {
        // 本机无 host jar / 无 java 时返回 false，不抛错；有 java + jar 时才可能 true。
        let _ = adapter_available("java", &ExecTarget::Local).await;
        let _ = adapter_available("python", &ExecTarget::Local).await;
    }
}
