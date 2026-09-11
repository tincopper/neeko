//! Java debug host adapter — attach-first over a self-written JVM DAP server.
//!
//! 路径 A（见 research/java-debug-runability.md 末节）：`com.microsoft.java.debug.core`
//! 是 JDT-free 纯库，但无独立可执行形态（全生态都宿主在 JDTLS/IDE 的 JVM 里）。
//! Neeko 自写一个 ~100 行 Java host main（`tools/java-host/`，复刻
//! `JavaDebugServer` 的 `ServerSocket(0)` + `ProtocolServer(in,out,context).run()`
//! 循环），`build.sh` 把 core 0.53.1 + 5 依赖打成 fat jar
//! `~/.neeko/java-host/neeko-java-host.jar`。本 adapter 就是
//! `java -jar <host.jar>`：DAP over TCP（host 自报监听端口），transport 与
//! GoAdapter（TcpListen）同构。
//!
//! 会话流程为 **attach-first**：Neeko 自行 spawn 测试 JVM（Console Launcher +
//! `-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=<port>`），
//! host 侧 DAP `attach`（SocketAttachingConnector）连该端口 —— **attach 无
//! classPaths 校验**（launch 模式 `LaunchRequestHandler` 强制要求，JDT 才产得出），
//! 首期借此绕开 classpath 解析。断点/步进/栈/变量（JDI）全可用；评估/补全/
//! 热替换由 host 内 no-op provider 顶住（降级不可用）。
//!
//! host 启动 stdout 契约：`neeko-java-host server listening at: 127.0.0.1:<port>`
//! —— 复用车载 `transport::parse_listen_addr_line`（`" server listening at: "`）。

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde_json::{json, Value};

use super::DebugAdapterPlugin;
use crate::common::executor::factory::ExecTarget;
use crate::core::exec;
use crate::dap::types::{
    AdapterKind, AdapterSpawn, AdapterTransport, HandshakeOrder, LaunchConfig,
};
use crate::AppError;

/// 默认 host jar 文件名（build.sh 产物）。
pub const JAVA_HOST_JAR_NAME: &str = "neeko-java-host.jar";
/// 相对 `~/.neeko` 的 host 缓存子目录（对齐 library/db.rs 的 `~/.neeko` 惯例）。
const JAVA_HOST_REL_DIR: &str = "java-host";
/// 显式 host jar 路径的环境变量覆盖（测试 / 自定义构建位置）。
const JAVA_HOST_JAR_ENV: &str = "NEEKO_JAVA_HOST_JAR";

/// Java debug host adapter（attach-first）。
pub struct JavaAdapter;

/// host jar 在给定基目录下的规范位置：`<base>/.neeko/java-host/neeko-java-host.jar`。
#[must_use]
pub fn host_jar_path_in(base: &Path) -> PathBuf {
    base.join(".neeko")
        .join(JAVA_HOST_REL_DIR)
        .join(JAVA_HOST_JAR_NAME)
}

/// 实际 host jar 路径：`NEEKO_JAVA_HOST_JAR` 环境变量优先，否则 `~/.neeko/java-host/…`。
#[must_use]
pub fn host_jar_path() -> PathBuf {
    if let Ok(p) = std::env::var(JAVA_HOST_JAR_ENV) {
        if !p.trim().is_empty() {
            return PathBuf::from(p);
        }
    }
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    host_jar_path_in(&home)
}

/// `java -jar <host.jar>` 的 spawn 描述（transport: TcpListen，host 自报端口）。
#[must_use]
pub fn java_spawn_args(jar: &Path) -> AdapterSpawn {
    AdapterSpawn {
        program: "java".into(),
        args: vec!["-jar".into(), jar.to_string_lossy().into_owned()],
        transport: AdapterTransport::TcpListen,
    }
}

#[async_trait]
impl DebugAdapterPlugin for JavaAdapter {
    fn kind(&self) -> AdapterKind {
        AdapterKind::Java
    }

    fn matches_type(&self, type_: &str) -> bool {
        matches!(type_, "java" | "junit")
    }

    fn adapter_id(&self) -> &'static str {
        "java"
    }

    fn handshake_order(&self) -> HandshakeOrder {
        // attach 请求完成即收到 initialized → 断点 → configurationDone，与
        // GoAdapter（LaunchBeforeBreakpoints）同序；仅请求命令名不同（attach）。
        HandshakeOrder::LaunchBeforeBreakpoints
    }

    /// DAP 启动会话的请求命令：Java 走 attach（无 classPaths 校验）。
    fn launch_request_command(&self) -> &'static str {
        "attach"
    }

    async fn resolve_spawn(
        &self,
        target: &ExecTarget,
        adapter_binary: Option<&str>,
    ) -> Result<AdapterSpawn, AppError> {
        // 用户显式配置（config `dap.adapterBinaries.java`）最高优先——指到自定义
        // host jar（对齐 Go/Lldb override 语义；覆盖 jar 的存在性仍校验）。
        let jar = match adapter_binary.filter(|b| !b.is_empty()) {
            Some(bin) => {
                if !Path::new(bin).exists() {
                    return Err(AppError::Dap(format!(
                        "Java host jar not found at override path: {bin}"
                    )));
                }
                PathBuf::from(bin)
            }
            None => host_jar_path(),
        };
        if !jar.exists() {
            return Err(AppError::Dap(format!(
                "Java debug host jar not found at {}. Run tools/java-host/build.sh \
                 (requires a JDK >= 11) to build it. {}",
                jar.display(),
                self.install_hint()
            )));
        }
        if !exec::command_exists(target, "java").await {
            return Err(AppError::Dap(
                "Java runtime (java) not found in the project environment. \
                 Java debugging requires a JRE/JDK >= 11 on PATH."
                    .into(),
            ));
        }
        Ok(java_spawn_args(&jar))
    }

    async fn is_available(&self, target: &ExecTarget) -> bool {
        exec::command_exists(target, "java").await && host_jar_path().exists()
    }

    fn build_launch_args(&self, cfg: &LaunchConfig, workspace: &str) -> Result<Value, AppError> {
        // attach 模式（AttachRequestHandler → SocketAttachingConnector）无
        // classPaths 校验；hostName+port 指向 Neeko 已 spawn 的测试 JVM jdwp 端口。
        let port = cfg.port.ok_or_else(|| {
            AppError::Dap(
                "Java attach requires \"port\" (the jdwp listen port of the test JVM)".into(),
            )
        })?;
        let cwd = cfg.cwd.clone().unwrap_or_else(|| workspace.to_string());
        // projectName 供 host 侧 ISourceLookUpProvider 语义用（本 host 按
        // sourcePath 文本解析，projectName 仅作兼容字段）。
        let project_name = Path::new(workspace)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        Ok(json!({
            "request": "attach",
            "hostName": "127.0.0.1",
            "port": port,
            "projectName": project_name,
            "sourcePaths": [cwd],
            // SocketAttachingConnector 默认 30s 超时，显式声明（对齐 AttachArguments）。
            "timeout": 30000,
        }))
    }

    fn entry_function_for_stop_on_entry(&self, _stop_on_entry: bool) -> Option<&'static str> {
        // attach 模式无「程序入口」概念（JVM 已启动挂起），entry 断点无意义。
        None
    }

    fn install_hint(&self) -> &'static str {
        "Run tools/java-host/build.sh to build the Java debug host \
         (requires a JDK >= 11), or point `dap.adapterBinaries.java` at a host jar."
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn java_cfg(port: Option<u16>, cwd: Option<&str>) -> LaunchConfig {
        LaunchConfig {
            name: "Debug test: testAdd".into(),
            type_: "java".into(),
            request: "attach".into(),
            program: None,
            cwd: cwd.map(String::from),
            args: vec![],
            mode: None,
            port,
            pre_launch_task: None,
            stop_on_entry: Some(false),
        }
    }

    #[test]
    fn host_jar_path_lives_under_neeko_java_host() {
        let base = std::path::Path::new("/home/u");
        assert_eq!(
            host_jar_path_in(base),
            PathBuf::from("/home/u/.neeko/java-host/neeko-java-host.jar")
        );
        // 与 build.sh 的 DEST_DIR 默认值一致（幂等产物可寻址）。
        assert!(host_jar_path_in(base)
            .to_string_lossy()
            .contains(".neeko/java-host/"));
    }

    #[test]
    fn java_spawn_args_run_host_jar_over_tcp() {
        let spawn = java_spawn_args(Path::new("/cache/neeko-java-host.jar"));
        assert_eq!(spawn.program, "java");
        assert_eq!(
            spawn.args,
            vec!["-jar".to_string(), "/cache/neeko-java-host.jar".to_string()]
        );
        assert_eq!(spawn.transport, AdapterTransport::TcpListen);
    }

    /// attach 配置：hostName+port、无 classPaths 校验字段（launch 模式才要求
    /// mainClass+classPaths），sourcePaths 携带项目根供 host 源码解析。
    #[test]
    fn build_launch_args_produce_attach_payload() {
        let cfg = java_cfg(Some(45678), Some("/proj"));
        let args = JavaAdapter
            .build_launch_args(&cfg, "/proj")
            .expect("attach args");
        assert_eq!(args["request"], "attach");
        assert_eq!(args["hostName"], "127.0.0.1");
        assert_eq!(args["port"], 45678);
        assert_eq!(args["sourcePaths"], json!(["/proj"]));
        assert_eq!(args["timeout"], 30000);
        // attach 无 classPaths 校验 —— 载荷不得出现 classPaths 字段。
        assert!(args.get("classPaths").is_none());
        assert!(args.get("mainClass").is_none());
    }

    #[test]
    fn build_launch_args_uses_cwd_when_present_else_workspace() {
        let cfg = java_cfg(Some(9999), Some("/sub/dir"));
        let args = JavaAdapter
            .build_launch_args(&cfg, "/proj")
            .expect("attach args");
        assert_eq!(args["sourcePaths"], json!(["/sub/dir"]));

        let fallback = java_cfg(Some(9999), None);
        let args = JavaAdapter
            .build_launch_args(&fallback, "/proj")
            .expect("attach args");
        assert_eq!(args["sourcePaths"], json!(["/proj"]));
    }

    #[test]
    fn build_launch_args_project_name_derived_from_workspace() {
        let cfg = java_cfg(Some(1234), None);
        let args = JavaAdapter
            .build_launch_args(&cfg, "/Users/demo/neeko")
            .expect("args");
        assert_eq!(args["projectName"], "neeko");
    }

    /// attach 缺 port → 显式报错（不猜端口）。
    #[test]
    fn build_launch_args_requires_port() {
        let cfg = java_cfg(None, None);
        assert!(JavaAdapter.build_launch_args(&cfg, "/proj").is_err());
    }

    #[test]
    fn matches_java_and_junit_types() {
        assert!(JavaAdapter.matches_type("java"));
        assert!(JavaAdapter.matches_type("junit"));
        assert!(!JavaAdapter.matches_type("lldb"));
        assert!(!JavaAdapter.matches_type("go"));
    }

    #[test]
    fn adapter_shape_attach_command() {
        assert_eq!(JavaAdapter.adapter_id(), "java");
        assert_eq!(JavaAdapter.kind(), AdapterKind::Java);
        assert_eq!(
            JavaAdapter.handshake_order(),
            HandshakeOrder::LaunchBeforeBreakpoints
        );
        // attach-first 的核心：DAP 启动命令是 attach 而非 launch。
        assert_eq!(JavaAdapter.launch_request_command(), "attach");
        assert!(JavaAdapter.entry_function_for_stop_on_entry(true).is_none());
    }

    #[tokio::test]
    async fn resolve_spawn_override_requires_existing_jar() {
        let err = JavaAdapter
            .resolve_spawn(&ExecTarget::Local, Some("/does/not/exist.jar"))
            .await
            .expect_err("missing jar must fail");
        assert!(err.to_string().contains("not found"), "{err}");
    }
}
