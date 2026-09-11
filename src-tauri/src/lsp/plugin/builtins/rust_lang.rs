use super::super::types::{InstallOp, LspInstallMethod, LspPlugin};

/// rust-analyzer 的 runnable 发现扩展（`experimental/runnables`）所需的**客户端能力声明**。
///
/// 实测（rust-analyzer 1.97.1，2026-09-11）：不声明时该方法不返回结果；声明后按
/// position 请求可拿到确定性参数，例如
/// `cargoArgs: ["test", "--package", "api", "--bin", "stock-buddy"]` +
/// `executableArgs: ["routes::…::test_x", "--exact", "--nocapture", "--include-ignored"]`
/// （含 workspace member 的 `--package` 与完整测试路径，免去清单 / target 猜测）。
/// kind 仅 `cargo` / `shell` 两种（测试也是 cargo kind）。
///
/// 按插件声明而非全局注入：其它语言（gopls / jdtls）的 initialize 载荷保持逐字节不变。
#[must_use]
fn client_capabilities() -> serde_json::Value {
    serde_json::json!({
        "experimental": { "runnables": { "kinds": ["cargo", "shell"] } }
    })
}

pub fn plugins() -> Vec<LspPlugin> {
    vec![LspPlugin::builtin(
        "rust",
        &["rs"],
        "rust-analyzer",
        &["rust-analyzer"],
        Some(LspInstallMethod::new(
            "rustup",
            InstallOp::exec("rustup", &["component", "add", "rust-analyzer"]),
        )),
    )
    .with_root_markers(&["Cargo.toml"])
    .with_detect_priority(10)
    .with_client_capabilities(client_capabilities())]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 护栏：rust-analyzer 插件必须声明 `experimental.runnables` 能力 —— 否则
    /// `experimental/runnables` 无结果（实测 1.97.1），P1 的确定性参数全部退化为快路径。
    #[test]
    fn rust_plugin_declares_runnables_client_capability() {
        let plugins = plugins();
        let rust = plugins.first().expect("rust plugin exists");
        let caps = rust
            .client_capabilities
            .as_ref()
            .expect("rust-analyzer must declare client capabilities");
        assert_eq!(
            caps["experimental"]["runnables"]["kinds"],
            serde_json::json!(["cargo", "shell"])
        );
        // 服务端命令与探测元数据不受影响
        assert_eq!(rust.server_binary, "rust-analyzer");
        assert_eq!(rust.root_markers, vec!["Cargo.toml".to_string()]);
    }
}
