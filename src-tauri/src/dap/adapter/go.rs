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

/// Delve (`dlv dap`) adapter plugin for Go debugging.
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

    async fn resolve_spawn(
        &self,
        target: &ExecTarget,
        adapter_binary: Option<&str>,
    ) -> Result<AdapterSpawn, AppError> {
        if let Some(bin) = adapter_binary.filter(|b| !b.is_empty()) {
            return Ok(AdapterSpawn {
                program: bin.to_string(),
                args: vec!["dap".into(), "--listen=127.0.0.1:0".into(), "--log".into()],
                transport: AdapterTransport::TcpListen,
            });
        }
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
            args: vec!["dap".into(), "--listen=127.0.0.1:0".into(), "--log".into()],
            transport: AdapterTransport::TcpListen,
        })
    }

    async fn is_available(&self, target: &ExecTarget) -> bool {
        exec::command_exists(target, "dlv").await
    }

    fn build_launch_args(&self, cfg: &LaunchConfig, workspace: &str) -> Result<Value, AppError> {
        let cwd = cfg.cwd.clone().unwrap_or_else(|| workspace.to_string());
        let mode = cfg.mode.clone().unwrap_or_else(|| "debug".into());
        let program = cfg.program.clone().unwrap_or_else(|| workspace.to_string());
        // mode:exec = 显式预编译测试二进制（`go test -c -o <out>`，Neeko 编辑器内联
        // Go Debug 走此形态）。前端只传锚定 `-test.run` 模式（如 `^TestFoo$`，libtest
        // 子串过滤的镜像）——在此拼装 delve flag，锚定永不丢失：0 命中则测试二进制
        // 直接退出，断点永不触发。其余模式（debug/test）args 原样透传。
        //
        // 防双前缀约定：编辑器内联只传裸模式（args=[name]），此处拼 `-test.run`；
        // 手写 launch.json 若已带 `-test.run` / 首个 arg 以 `-` 开头（已是 delve
        // flag），则原样透传不再重复拼（防 `-test.run -test.run '^Name$'` 双前缀）。
        let args = if mode == "exec" {
            match cfg.args.first() {
                Some(pattern) if !pattern.starts_with('-') => {
                    vec!["-test.run".to_string(), pattern.clone()]
                }
                _ => cfg.args.clone(),
            }
        } else {
            cfg.args.clone()
        };
        // Delve's DAP stopOnEntry leaves a Dummy thread that cannot stackTrace.
        // Entry pause is implemented via setFunctionBreakpoints("main.main") instead.
        Ok(json!({
            "mode": mode,
            "program": program,
            "cwd": cwd,
            "args": args,
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

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncBufReadExt;

    fn exec_cfg(name: &str, program: &str, args: Vec<String>) -> LaunchConfig {
        LaunchConfig {
            name: name.into(),
            type_: "go".into(),
            request: "launch".into(),
            program: Some(program.into()),
            cwd: Some("/proj".into()),
            args,
            mode: Some("exec".into()),
            port: None,
            pre_launch_task: None,
            stop_on_entry: Some(false),
            classpath: vec![],
        }
    }

    fn launch_args(cfg: &LaunchConfig) -> Value {
        GoAdapter
            .build_launch_args(cfg, "/proj")
            .expect("launch args")
    }

    /// 编辑器内联 Go Debug 走 `mode:exec` + `-o` 显式测试二进制；前端传锚定
    /// `-test.run` 模式，adapter 拼装 delve flag——验证 dlv exec launch 载荷。
    #[test]
    fn exec_mode_assembles_anchored_test_run_args() {
        let cfg = exec_cfg(
            "Debug test: TestAdd",
            "/proj/.neeko/test-bin/TestAdd",
            vec!["^TestAdd$".into()],
        );
        let args = launch_args(&cfg);
        assert_eq!(args["mode"], "exec");
        assert_eq!(args["program"], "/proj/.neeko/test-bin/TestAdd");
        assert_eq!(args["args"], json!(["-test.run", "^TestAdd$"]));
        assert_eq!(args["cwd"], "/proj");
        assert_eq!(args["stopOnEntry"], false);
    }

    /// 无过滤模式（args 空）→ 不拼 `-test.run`，测试二进制跑全量用例。
    #[test]
    fn exec_mode_without_pattern_passes_empty_args() {
        let cfg = exec_cfg(
            "Debug test: TestAll",
            "/proj/.neeko/test-bin/TestAll",
            vec![],
        );
        let args = launch_args(&cfg);
        assert_eq!(args["mode"], "exec");
        assert_eq!(args["args"], json!([]));
    }

    /// 非 exec 模式（delve `mode:test` 由 delve 自编）args 原样透传，不拼 flag。
    #[test]
    fn non_exec_mode_passes_args_through() {
        let cfg = LaunchConfig {
            name: "go test".into(),
            type_: "go".into(),
            request: "launch".into(),
            program: Some("./pkg".into()),
            cwd: Some("/proj".into()),
            args: vec!["-test.run".into(), "^TestAdd$".into()],
            mode: Some("test".into()),
            port: None,
            pre_launch_task: None,
            stop_on_entry: Some(false),
            classpath: vec![],
        };
        let args = launch_args(&cfg);
        assert_eq!(args["mode"], "test");
        assert_eq!(args["args"], json!(["-test.run", "^TestAdd$"]));
        assert_eq!(args["program"], "./pkg");
    }

    /// 防双前缀：手写 launch.json 已带 `-test.run` → 原样透传，不重复拼前缀。
    #[test]
    fn exec_mode_with_existing_test_run_flag_passes_through() {
        let cfg = exec_cfg(
            "Debug test: TestAdd",
            "/proj/.neeko/test-bin/TestAdd",
            vec!["-test.run".into(), "^TestAdd$".into()],
        );
        let args = launch_args(&cfg);
        assert_eq!(args["mode"], "exec");
        assert_eq!(args["args"], json!(["-test.run", "^TestAdd$"]));
    }

    /// 防双前缀：首个 arg 以 `-` 开头（已是 delve flag）→ 原样透传，不重复拼。
    #[test]
    fn exec_mode_with_flag_prefixed_arg_passes_through() {
        let cfg = exec_cfg(
            "Debug test: TestVerbose",
            "/proj/.neeko/test-bin/TestVerbose",
            vec!["-test.v".into(), "^TestVerbose$".into()],
        );
        let args = launch_args(&cfg);
        assert_eq!(args["mode"], "exec");
        assert_eq!(args["args"], json!(["-test.v", "^TestVerbose$"]));
    }

    /// 对齐设计 G2（dlv 真机 `#[ignore]`）：`resolve_spawn` → 统一执行门面
    /// spawn `dlv dap`（headless DAP server），等待 stdout 打印 listening 行
    /// （`DAP server listening at: 127.0.0.1:<port>`，实证走 stdout）即视为就绪，
    /// 随后 kill。慢测：需本机安装 dlv
    /// （`go install github.com/go-delve/delve/cmd/dlv@latest`），
    /// 用 `cargo test -- --ignored` 运行。
    #[tokio::test]
    #[ignore]
    async fn dlv_dap_spawn_smoke() {
        if !exec::command_exists(&ExecTarget::Local, "dlv").await {
            eprintln!("Skipping: dlv not found");
            return;
        }
        let spawn = GoAdapter
            .resolve_spawn(&ExecTarget::Local, None)
            .await
            .expect("resolve dlv dap spawn");
        assert_eq!(spawn.program, "dlv");
        assert_eq!(spawn.transport, AdapterTransport::TcpListen);
        assert!(spawn.args.iter().any(|a| a == "dap"));

        let args: Vec<&str> = spawn.args.iter().map(|s| s.as_str()).collect();
        let mut child = exec::spawn(&ExecTarget::Local, &spawn.program, &args)
            .await
            .expect("spawn dlv dap");
        let stdout = child.stdout.take().expect("dlv stdout");
        let mut reader = tokio::io::BufReader::new(stdout);
        let mut line = String::new();
        let mut ready = false;
        for _ in 0..20 {
            line.clear();
            match tokio::time::timeout(
                std::time::Duration::from_secs(2),
                reader.read_line(&mut line),
            )
            .await
            {
                Ok(Ok(0)) | Ok(Err(_)) => break, // EOF / read error
                Ok(Ok(_)) => {
                    if line.contains("DAP server listening at:") {
                        ready = true;
                        break;
                    }
                }
                Err(_) => break, // 超时：窗口内未就绪
            }
        }
        assert!(
            ready,
            "dlv dap failed to print the listening line within the expected window: {line}"
        );
        let _ = child.kill().await;
    }
}
