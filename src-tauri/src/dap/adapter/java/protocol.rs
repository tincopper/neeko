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

use crate::common::executor::factory::ExecTarget;
use crate::core::exec;
use crate::dap::adapter::DebugAdapterPlugin;
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

/// 把 argv 拼成 java-debug 期望的 `args` **字符串**（shell 语义，双引号转义）。
///
/// 含空白/引号的参数必须被引起来（项目路径可能带空格），否则 java-debug 侧的
/// 命令行解析会把它拆碎。
#[must_use]
pub fn join_launch_args(args: &[String]) -> String {
    args.iter()
        .map(|arg| {
            if arg.is_empty() {
                r#""""#.to_string()
            } else if arg
                .chars()
                .any(|c| c.is_whitespace() || c == '"' || c == '\\')
            {
                let escaped = arg.replace('\\', r"\\").replace('"', "\\\"");
                format!("\"{escaped}\"")
            } else {
                arg.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// B' 的 DAP `launch` 载荷：由 JDTLS 进程内的 java-debug server 注入 jdwp 并
/// spawn 被测 JVM。`classPaths` 来自 `vscode.java.resolveClasspath`（真值单源），
/// `mainClass` 为测试链路的 Console Launcher 或应用调试的目标 main 类。
///
/// 缺 `mainClass` / 空 classpath 一律**硬报错**，不猜默认值 —— 猜错会得到
/// "会话 running 但断点永不命中"的静默错（见 design §0.3）。
#[allow(clippy::unnecessary_wraps)]
fn build_launch_payload(cfg: &LaunchConfig, workspace: &str) -> Result<Value, AppError> {
    let main_class = cfg
        .main_class
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::Dap(
                "Java launch requires \"mainClass\" (the class to run under the debugger). \
                 Set \"mainClass\" in this launch configuration, or start the session from the \
                 editor gutter so Neeko fills it in from the file you are debugging."
                    .into(),
            )
        })?;
    let class_paths: Vec<&str> = cfg
        .classpath
        .iter()
        .map(String::as_str)
        .filter(|e| !e.trim().is_empty())
        .collect();
    if class_paths.is_empty() {
        return Err(AppError::Dap(
            "Java launch requires a non-empty classpath. Neeko gets it from the Java language \
             server (vscode.java.resolveClasspath); if this persists, check that the Java \
             language server has finished importing the project (see its log)."
                .into(),
        ));
    }
    let module_paths: Vec<&str> = cfg
        .module_paths
        .iter()
        .map(String::as_str)
        .filter(|e| !e.trim().is_empty())
        .collect();
    let cwd = cfg.cwd.clone().unwrap_or_else(|| workspace.to_string());
    let mut payload = json!({
        "request": "launch",
        "mainClass": main_class,
        "classPaths": class_paths,
        "modulePaths": module_paths,
        // java-debug 的 `LaunchArguments.args` 是**字符串**（真机实证：传数组会被 Gson 以
        // `Expected STRING but was BEGIN_ARRAY at path $.args` 拒绝，launch 请求被丢弃 →
        // 表现为 "Empty debug session" + 永无 initialized）。故按 shell 语义拼成一行。
        "args": join_launch_args(&cfg.args),
        "cwd": cwd,
        // 规避 OS 命令行长度上限（Windows ~32KB）：S0 真机实测 core 接受该取值。
        "shortenCommandLine": "argfile",
    });
    // `projectName` 是 evaluate 的硬前置（真机实证）——但只发**经 jdt.ls 验证过**的名字：
    // None 时**省略字段**（发空串会被当作一个无效项目名）。
    if let Some(name) = cfg.project_name.as_deref().filter(|n| !n.trim().is_empty()) {
        payload["projectName"] = json!(name);
    }
    Ok(payload)
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

    /// DAP 启动会话的请求命令：由配置决定形态 —— `attach`（A：自写 host 连接
    /// Neeko 已挂起的测试 JVM，无 classPaths 校验）或 `launch`（B'：JDTLS 进程内的
    /// java-debug server 自行注入 jdwp 并 spawn 被测 JVM）。
    fn launch_request_command<'a>(&self, cfg: &'a LaunchConfig) -> &'a str {
        if cfg.request == "attach" {
            "attach"
        } else {
            "launch"
        }
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
        // 形态由配置决定：非 attach 即 launch（B'，JDTLS 内的 java-debug server）。
        if cfg.request != "attach" {
            return build_launch_payload(cfg, workspace);
        }
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
        // 源码查找根：项目根在前（既有多模块后缀搜索依赖它），其后拼 debuggee
        // classpath 条目。attach 载荷**没有** `classPaths` 字段（只有 `launch`
        // 有，见 `Requests$AttachArguments`），而 `AttachRequestHandler` 会把
        // `sourcePaths` 原样写进 context（`setSourcePaths`）—— 这是唯一能到达
        // host 的数组通道，provider 经 `initialize(context, …)` 读取它来解析
        // 第三方库 / JDK 源码。
        let mut source_paths = vec![cwd];
        source_paths.extend(
            cfg.classpath
                .iter()
                .filter(|entry| !entry.trim().is_empty())
                .cloned(),
        );
        Ok(json!({
            "request": "attach",
            "hostName": "127.0.0.1",
            "port": port,
            "projectName": project_name,
            "sourcePaths": source_paths,
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
            classpath: vec![],
            main_class: None,
            project_name: None,
            module_paths: vec![],
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
        // 组件级断言（Path::ends_with）：字符串 `.contains(".neeko/java-host/")` 硬编码
        // Unix `/` 分隔符，Windows（`\`）上必挂——ends_with 按组件比较，跨平台无关。
        assert!(
            host_jar_path_in(base).ends_with(std::path::Path::new("java-host/neeko-java-host.jar"))
        );
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

    /// classpath 条目追加在项目根之后（attach 唯一的数组通道 = `sourcePaths`）。
    #[test]
    fn build_launch_args_appends_classpath_to_source_paths() {
        let mut cfg = java_cfg(Some(1), Some("/proj"));
        cfg.classpath = vec![
            "/proj/target/classes".into(),
            "   ".into(), // 空白条目被过滤
            "/home/u/.m2/repository/com/google/guava/guava-33.jar".into(),
        ];
        let args = JavaAdapter.build_launch_args(&cfg, "/proj").expect("args");
        assert_eq!(
            args["sourcePaths"],
            json!([
                "/proj",
                "/proj/target/classes",
                "/home/u/.m2/repository/com/google/guava/guava-33.jar"
            ])
        );
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
        assert!(JavaAdapter.entry_function_for_stop_on_entry(true).is_none());
    }

    /// 形态属于**配置**（`cfg.request`）而非适配器实例：attach → `attach`，
    /// launch/其它 → `launch`（B'）。
    #[test]
    fn launch_request_command_follows_config_request() {
        let mut cfg = java_cfg(Some(1), Some("/proj"));
        assert_eq!(JavaAdapter.launch_request_command(&cfg), "attach");

        cfg.request = "launch".into();
        assert_eq!(JavaAdapter.launch_request_command(&cfg), "launch");

        // 非法/未知取值不静默走 attach，而是按 launch 处理（由载荷校验兜底报错）。
        cfg.request = "weird".into();
        assert_eq!(JavaAdapter.launch_request_command(&cfg), "launch");
    }

    fn java_launch_cfg() -> LaunchConfig {
        LaunchConfig {
            name: "Debug test: testAdd".into(),
            type_: "java".into(),
            request: "launch".into(),
            program: None,
            cwd: Some("/proj".into()),
            args: vec!["execute".into(), "-c".into(), "com.example.CalcTest".into()],
            mode: None,
            port: None,
            pre_launch_task: None,
            stop_on_entry: Some(false),
            classpath: vec![
                "/proj/target/test-classes".into(),
                "  ".into(),
                "/proj/target/classes".into(),
            ],
            main_class: Some("org.junit.platform.console.ConsoleLauncher".into()),
            project_name: Some("s0-demo".into()),
            module_paths: vec![],
        }
    }

    /// B' 的 launch 载荷：mainClass + classPaths（空白项过滤）+ modulePaths +
    /// args + cwd；**不得**出现 attach 专属字段（hostName / port / sourcePaths）。
    #[test]
    fn build_launch_args_produce_launch_payload() {
        let args = JavaAdapter
            .build_launch_args(&java_launch_cfg(), "/proj")
            .expect("launch args");
        assert_eq!(args["request"], "launch");
        assert_eq!(
            args["mainClass"],
            "org.junit.platform.console.ConsoleLauncher"
        );
        assert_eq!(
            args["classPaths"],
            json!(["/proj/target/test-classes", "/proj/target/classes"])
        );
        assert_eq!(args["modulePaths"], json!([]));
        // java-debug 要求 `args` 为**字符串**（数组会被 Gson 以
        // `Expected STRING but was BEGIN_ARRAY at path $.args` 拒绝）。
        assert_eq!(args["args"], json!("execute -c com.example.CalcTest"));
        assert!(args["args"].is_string(), "args 必须是字符串");
        assert_eq!(args["cwd"], "/proj");
        assert_eq!(args["shortenCommandLine"], "argfile");
        // evaluate 的硬前置（真机实证：缺它求值报 "please specify projectName"）。
        assert_eq!(args["projectName"], "s0-demo");
        assert!(args.get("hostName").is_none());
        assert!(args.get("port").is_none());
        assert!(args.get("sourcePaths").is_none());
    }

    /// **生产路径回归（跨 `expand_config` × `build_launch_args`）**。
    ///
    /// 真实链路是 `plan_java_debug` → `launch_session`（内部 `expand_config`）→ adapter 载荷。
    /// 历史 bug：`expand_config` 漏传 `main_class`，于是 B' 的 launch 在到达适配器前丢值，
    /// 报 `Java launch requires "mainClass"`。断言"展开后仍能产出完整载荷"正是该缺口的守卫。
    #[test]
    fn launch_payload_survives_expand_config() {
        let cfg = java_launch_cfg();
        let expanded = crate::dap::config::expand_config(&cfg, Path::new("/proj"), None);
        let args = JavaAdapter
            .build_launch_args(&expanded, "/proj")
            .expect("expand_config 之后仍必须能组出 launch 载荷");
        assert_eq!(
            args["mainClass"],
            "org.junit.platform.console.ConsoleLauncher"
        );
        assert_eq!(args["projectName"], "s0-demo");
        assert_eq!(args["modulePaths"], json!([]));
    }

    /// `args` 拼装：含空白/引号的参数必须被双引号包裹并转义（项目路径可能带空格）。
    #[test]
    fn join_launch_args_quotes_only_when_needed() {
        assert_eq!(
            join_launch_args(&["-m".into(), "com.example.CalcTest#testAdd".into()]),
            "-m com.example.CalcTest#testAdd"
        );
        assert_eq!(
            join_launch_args(&["--reports-dir=/tmp/my proj/.neeko".into()]),
            "\"--reports-dir=/tmp/my proj/.neeko\""
        );
        assert_eq!(join_launch_args(&["a\"b".into()]), "\"a\\\"b\"");
        assert_eq!(join_launch_args(&["".into()]), "\"\"");
        assert_eq!(join_launch_args(&[]), "");
    }

    #[test]
    fn build_launch_args_launch_carries_module_paths_when_present() {
        let mut cfg = java_launch_cfg();
        cfg.module_paths = vec!["/proj/target/classes".into()];
        let args = JavaAdapter.build_launch_args(&cfg, "/proj").expect("args");
        assert_eq!(args["modulePaths"], json!(["/proj/target/classes"]));
    }

    /// 缺 `mainClass` / 空 classpath 一律硬报错（禁止猜默认值 → 静默不命中）。
    #[test]
    fn build_launch_args_launch_requires_main_class_and_classpath() {
        let mut no_main = java_launch_cfg();
        no_main.main_class = None;
        let err = JavaAdapter
            .build_launch_args(&no_main, "/proj")
            .expect_err("missing mainClass must fail");
        assert!(err.to_string().contains("mainClass"), "{err}");

        let mut blank_main = java_launch_cfg();
        blank_main.main_class = Some("   ".into());
        assert!(JavaAdapter.build_launch_args(&blank_main, "/proj").is_err());

        let mut no_cp = java_launch_cfg();
        no_cp.classpath = vec!["  ".into()];
        let err = JavaAdapter
            .build_launch_args(&no_cp, "/proj")
            .expect_err("empty classpath must fail");
        assert!(err.to_string().contains("classpath"), "{err}");
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
