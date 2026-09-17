//! Java 语言调试后端（编排层，§9.4 方案 C）。
//!
//! 组合 `JavaAdapter`（协议层）+ 两个 lsp 域端口（能力探测 / 断点源路径翻译），
//! 回答"怎么为 Java 做完整调试"：
//!
//! - A（自写 host，attach-first）：spawn 测试 JVM → 解析 jdwp 端口 → attach 会话。
//! - B'（JDTLS 内 java-debug，launch）：能力探测三态 → 直连外部端点 → launch。
//!
//! 端口在构造时注入（依赖倒置：dap 定义抽象、lsp 提供实现，组合根装配），
//! 使 dap 不持有 `LspManager`、单测可注入 fake（§2.7）。

use std::sync::Arc;

use async_trait::async_trait;

use super::super::backend::{DebugRequest, LanguageBackend, SessionPlan, SessionRoutePlan};
use super::capability::JavaDebugCapability;
use super::debuggee::JavaDebuggee;
use super::protocol::JavaAdapter;
use crate::common::executor::factory::ExecTarget;
use crate::dap::adapter::java::source_path::JavaSourcePathProvider;
use crate::dap::adapter::SourcePathResolution;
use crate::dap::launch_support;
use crate::dap::types::{JavaDebugBackend, LaunchConfig};
use crate::AppError;
use crate::AppStateWrapper;

/// Java 调试编排后端。
///
/// 端口（能力探测 / 断点源路径翻译）在构造时注入 —— 组合根把 lsp 域的实现实例
/// 传进来，本类型不持有 `LspManager`。
pub struct JavaBackend {
    /// 能力探测端口（B' 就绪判定；`probe` 走它）。
    capability: Arc<dyn super::capability::JavaDebugCapabilityProvider>,
    /// 断点源路径翻译端口（`jdt://…` → 真实文件）。
    source_path: Arc<dyn JavaSourcePathProvider>,
}

impl JavaBackend {
    /// 构造 Java 编排后端。
    #[must_use]
    pub fn new(
        capability: Arc<dyn super::capability::JavaDebugCapabilityProvider>,
        source_path: Arc<dyn JavaSourcePathProvider>,
    ) -> Self {
        Self {
            capability,
            source_path,
        }
    }
}

#[async_trait]
impl LanguageBackend for JavaBackend {
    fn plugin(&self) -> &dyn super::super::plugin::DebugAdapterPlugin {
        &JavaAdapter
    }

    fn supported_on(&self, target: &ExecTarget) -> bool {
        !java_debug_unsupported(target)
    }

    fn unsupported_error(&self) -> AppError {
        unsupported_remote_error()
    }

    async fn plan(
        &self,
        state: &AppStateWrapper,
        request: &DebugRequest,
    ) -> Result<SessionPlan, AppError> {
        match request {
            DebugRequest::JavaAttach { project_id, target } => {
                self.plan_attach(state, project_id, target).await
            }
            DebugRequest::JavaJdtls { project_id, target } => {
                self.plan_jdtls(state, project_id, target).await
            }
        }
    }

    async fn adapter_source_path(
        &self,
        _state: &AppStateWrapper,
        target: &ExecTarget,
        classpath: &[String],
        identity: &str,
    ) -> SourcePathResolution {
        self.source_path
            .adapter_source_path(target, classpath, identity)
            .await
    }
}

impl JavaBackend {
    /// A（自写 host，attach-first）全流程编排。
    ///
    /// `command` 形态（buildJavaDebugCommand 的产物）：
    ///   `java -agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=0
    ///    -jar junit-platform-console-standalone.jar -c <FQCN> -m '<FQCN#method>'
    ///    --reports-dir=<dir>`
    /// `address=0` 让 JVM 自选空闲端口并打印
    /// `Listening for transport dt_socket at address: <port>`（stdout），
    /// host 侧 attach 走 SocketAttachingConnector（无 classPaths 校验）。
    ///
    /// `classpath` 为 debuggee 的运行时 classpath 条目（前端
    /// `buildJavaClasspathEntries` 产物）：随 attach 载荷的 `sourcePaths` 送达
    /// host，供其解析第三方库 / JDK 源码（见 `adapter::java`）。
    ///
    /// 只做"决策 + debuggee spawn"（spawn 是 attach 前置，失败即 guard drop 清理），
    /// **不起会话**；返回 `Launch` 后由 manager 调 `launch_session` 建立 attach 会话，
    /// 随后经 `DebugRequest::JavaAttach` 的输出通道挂载 JVM 输出泵。
    async fn plan_attach(
        &self,
        state: &AppStateWrapper,
        project_id: &str,
        target: &crate::dap::types::JavaDebugTarget,
    ) -> Result<SessionPlan, AppError> {
        let crate::dap::types::JavaDebugTarget {
            command,
            cwd,
            test_name,
            classpath,
        } = target;
        if command.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "java debug command must not be empty".into(),
            ));
        }
        if cwd.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "java debug cwd must not be empty".into(),
            ));
        }
        let (target, project_root) = state.resolve_project(project_id)?;
        if java_debug_unsupported(&target) {
            return Err(unsupported_remote_error());
        }
        let dir = launch_support::resolve_build_dir(&target, &project_root, cwd).await?;
        // Windows 本地经 cmd /C：POSIX 单引号转 cmd 双引号（对齐 debug_build_test_binary）。
        let command = if matches!(target, ExecTarget::Local) && cfg!(windows) {
            launch_support::windows_cmd_quote(command)
        } else {
            command.clone()
        };
        let (shell, args) = launch_support::build_shell_argv(&command);

        // ── 1-3. spawn 测试 JVM → 解析 jdwp 端口 → 输出泵 + 清理句柄 ───────────
        // 进程生命周期内聚在 JavaDebuggee（失败路径自带清理）。
        let JavaDebuggee {
            port,
            output_rx,
            guard,
        } = JavaDebuggee::launch(&target, shell, &args, dir.as_str()).await?;
        // ── 4. attach 配置（JavaAdapter.build_launch_args 消费 port）───────────
        let config = LaunchConfig {
            name: format!("Debug test: {test_name}"),
            type_: "java".into(),
            request: "attach".into(),
            program: None,
            cwd: Some(dir),
            args: vec![],
            mode: None,
            port: Some(port),
            pre_launch_task: None,
            stop_on_entry: Some(false),
            classpath: classpath.clone(),
            main_class: None,
            project_name: None,
            module_paths: Vec::new(),
        };
        Ok(SessionPlan::Launch {
            route: SessionRoutePlan::Spawn {
                debuggee: Some(guard),
                debuggee_output: Some(output_rx),
            },
            config: Box::new(config),
            notes: vec![],
        })
    }

    /// B'（JDTLS 后端）的路由决策（无副作用）：配置权威读取 → 参数校验 → 能力探测 → 载荷组装。
    ///
    /// 返回 `Launch` 时**尚未**建立任何会话；调用方负责起会话。这样"不可用时绝不
    /// 建会话、绝不换引擎"是可单测的不变式。
    async fn plan_jdtls(
        &self,
        state: &AppStateWrapper,
        project_id: &str,
        target: &crate::dap::types::JavaJdtlsTarget,
    ) -> Result<SessionPlan, AppError> {
        if target.cwd.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "java debug cwd must not be empty".into(),
            ));
        }
        if target.probe_class.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "java debug class must not be empty".into(),
            ));
        }
        // 与 cwd / probe_class 同样在**边界**拒绝：别把必然失败留给下游（适配器层）。
        if target.main_class.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "java debug main class must not be empty".into(),
            ));
        }

        // 权威配置：显式 host 时前端本不该调用本命令，报错而非静默改道。
        if !load_java_backend(state).allows_jdtls() {
            return Err(AppError::InvalidInput(
                "dap.javaBackend is \"host\"; use debug_java_attach for the host backend".into(),
            ));
        }

        let (exec_target, project_root) = state.resolve_project(project_id)?;
        if java_debug_unsupported(&exec_target) {
            return Err(unsupported_remote_error());
        }
        // **不猜项目名**：只把"候选"交给端口，由 jdt.ls 验证后采信。
        //
        // 曾经的 bug：用 Neeko 项目/模块**目录名**兜底 → 聚合根场景下 jdt.ls 直接拒
        // （`The project 'tomgs-java' is not a valid java project`），而 JDT 项目名是
        // **构建系统项目名**（Maven `artifactId` / Gradle 项目名），不是目录名。
        // 候选缺失或不被接受时，端口会退回"不带名字、服务器按类解析"。
        let candidate = target
            .project_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());

        // 能力探测（不阻塞：会话未就绪即返回 Warming/Unavailable，不在此启动服务器）。
        let capability = self
            .capability
            .probe(&project_root, &target.probe_class, candidate)
            .await;

        let (port, module_paths, mut class_paths, verified_project_name) = match capability {
            JavaDebugCapability::Ready {
                port,
                module_paths,
                class_paths,
                project_name,
            } => (port, module_paths, class_paths, project_name),
            JavaDebugCapability::Warming { detail } => {
                return Ok(SessionPlan::Warming { detail });
            }
            JavaDebugCapability::Unavailable {
                reason,
                statically_detectable,
            } => {
                return Ok(SessionPlan::Unavailable {
                    message: describe_unavailable(&reason),
                    statically_detectable,
                });
            }
        };

        // 测试目标：把 Console Launcher 并入 classPaths（其自带 Jupiter/Vintage 引擎）。
        if let Some(jar) = target
            .launcher_jar
            .as_deref()
            .filter(|s| !s.trim().is_empty())
        {
            if !class_paths.iter().any(|e| e == jar) {
                class_paths.push(jar.to_string());
            }
        }

        let dir =
            launch_support::resolve_build_dir(&exec_target, &project_root, &target.cwd).await?;
        let config = LaunchConfig {
            name: format!("Debug test: {}", target.test_name),
            type_: "java".into(),
            request: "launch".into(),
            program: None,
            cwd: Some(dir),
            args: target.args.clone(),
            mode: None,
            port: None,
            pre_launch_task: None,
            stop_on_entry: Some(false),
            classpath: class_paths,
            main_class: Some(target.main_class.clone()),
            // 只填**经 jdt.ls 验证过**的名字（`evaluate` 的硬前置）；未验证到就留空 ——
            // 宁可 evaluate 降级，也不发一个会被拒（或更糟：命中错项目）的猜值。
            project_name: verified_project_name,
            module_paths,
        };
        Ok(SessionPlan::Launch {
            route: SessionRoutePlan::Connect {
                endpoint: format!("127.0.0.1:{port}"),
            },
            config: Box::new(config),
            notes: vec![],
        })
    }
}

/// Java 调试在 SSH 远端**不支持**（A 与 B' 皆然）。
///
/// 依据（design §2.6）：两端都需要 Neeko 进程直连项目环境的**回环端口**
/// （`dap/transport.rs` 的 `TcpStream::connect` 在本机执行），而 SSH 下该端口在远端，
/// 仓库内无端口转发设施。SSH 下 A 也不是兜底 —— 必须**显式报错**，而不是让用户撞上
/// 一个更难懂的连接失败。
#[must_use]
const fn java_debug_unsupported(target: &ExecTarget) -> bool {
    matches!(target, ExecTarget::Remote { .. })
}

#[must_use]
fn unsupported_remote_error() -> AppError {
    AppError::Dap(
        "Java debugging over SSH is not supported: the debug adapter listens on a port on the \
         remote host, and Neeko has no tunnel to reach it. Run the project locally or over WSL."
            .into(),
    )
}

/// 读取 config `dap.javaBackend`（缺键 / 非法值 / 读取失败一律 `auto`）。
fn load_java_backend(state: &AppStateWrapper) -> JavaDebugBackend {
    let raw = state.storage_manager.load_config().ok().and_then(|config| {
        config
            .pointer("/dap/javaBackend")
            .and_then(|v| v.as_str())
            .map(str::to_string)
    });
    JavaDebugBackend::parse(raw.as_deref())
}

/// 把不可用原因转成面向用户的文案（附可操作指引；B' 无 adapter stderr 可聚合，
/// 服务器侧细节在既有 LSP 服务器日志里）。
fn describe_unavailable(
    reason: &crate::dap::adapter::java::capability::JavaDebugUnavailable,
) -> String {
    match reason {
        crate::dap::adapter::java::capability::JavaDebugUnavailable::LspUnavailable => {
            "The Java language server is not available for this project (open a .java file, or \
             check the JDK 21+ / JDTLS installation), so the JDTLS debug backend cannot start. \
             See the Java language server log for details."
                .into()
        }
        crate::dap::adapter::java::capability::JavaDebugUnavailable::BundleMissing => {
            "The Java debug plugin (com.microsoft.java.debug.plugin) is not loaded in the Java \
             language server. Restart the Java language server session to load it, or switch to \
             the host backend (limited: no expression evaluation)."
                .into()
        }
        crate::dap::adapter::java::capability::JavaDebugUnavailable::ProbeFailed(msg) => format!(
            "JDTLS debug backend is unavailable: {msg}. The debug server runs inside the Java \
             language server, so its own diagnostics are in that server's log (View Logs for the \
             Java language server)."
        ),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::dap::adapter::java::capability::JavaDebugCapability;
    use crate::dap::adapter::{DebugRequest, SessionPlan};
    use crate::session::StorageManager;

    const LAUNCHER: &str = "/home/u/.neeko/junit-platform-console-standalone-1.14.4.jar";

    /// 隔离的 `AppStateWrapper`：StorageManager 指向临时目录 —— 严禁用默认 `~/.neeko`，
    /// 否则 project 的 auto-save 会覆盖用户数据。
    fn isolated_state(tmp: &tempfile::TempDir) -> AppStateWrapper {
        let storage = StorageManager::with_dir(tmp.path().join(".neeko")).expect("storage");
        let store = Arc::new(crate::library::LibraryStore::open_in_memory().expect("library"));
        AppStateWrapper::new_with_storage_and_library(storage, store)
    }

    /// 注入式能力探测 fake：路由单测不构造 LSP 运行时。
    struct FakeCapability(JavaDebugCapability);

    #[async_trait::async_trait]
    impl crate::dap::adapter::java::capability::JavaDebugCapabilityProvider for FakeCapability {
        async fn probe(
            &self,
            _project_path: &str,
            _test_class: &str,
            _project_name_candidate: Option<&str>,
        ) -> JavaDebugCapability {
            self.0.clone()
        }
    }

    /// 源路径 fake：断点翻译测试不构造 LSP/JDK，按身份原样透传。
    struct FakeSourcePath;

    #[async_trait::async_trait]
    impl crate::dap::adapter::java::source_path::JavaSourcePathProvider for FakeSourcePath {
        async fn adapter_source_path(
            &self,
            _target: &ExecTarget,
            _classpath: &[String],
            identity: &str,
        ) -> SourcePathResolution {
            SourcePathResolution::Adapter(std::path::PathBuf::from(identity))
        }
    }

    /// 用 fake 端口构造 JavaBackend 实例（plan 单测入口）。
    fn fake_backend(capability: JavaDebugCapability) -> JavaBackend {
        JavaBackend::new(
            Arc::new(FakeCapability(capability)),
            Arc::new(FakeSourcePath),
        )
    }

    /// 注册一个项目并注入指定探测结果，返回 (state, project_id)。
    fn java_route_state(
        tmp: &tempfile::TempDir,
        capability: JavaDebugCapability,
    ) -> (AppStateWrapper, String) {
        java_route_state_named(tmp, "proj", capability)
    }

    /// 与 [`java_route_state`] 同，但可指定项目目录名（回归"目录名会被当成项目名"的场景）。
    fn java_route_state_named(
        tmp: &tempfile::TempDir,
        dir_name: &str,
        capability: JavaDebugCapability,
    ) -> (AppStateWrapper, String) {
        let state = isolated_state(tmp);
        // 保持 dap_manager 注册表与测试注入的 fake 一致（plan 直接调 fake_backend，
        // 此处仅保证 resolve_project 走的 state 语义一致）。
        state.dap_manager.register_backend(
            crate::dap::types::AdapterKind::Java,
            Arc::new(fake_backend(capability.clone())),
        );
        let project_dir = tmp.path().join(dir_name);
        std::fs::create_dir_all(&project_dir).expect("mkdir");
        let project = state
            .project_manager
            .lock()
            .expect("project_manager")
            .add_project(project_dir.clone(), None, None, None)
            .expect("add_project");
        (state, project.id)
    }

    fn jdtls_target(cwd: &str) -> crate::dap::types::JavaJdtlsTarget {
        crate::dap::types::JavaJdtlsTarget {
            probe_class: "com.example.CalcTest".into(),
            cwd: cwd.into(),
            test_name: "testAdd".into(),
            main_class: "org.junit.platform.console.ConsoleLauncher".into(),
            args: vec!["execute".into()],
            launcher_jar: None,
            project_name: None,
        }
    }

    fn ready_capability() -> JavaDebugCapability {
        JavaDebugCapability::Ready {
            port: 1,
            module_paths: vec![],
            class_paths: vec!["/cp".into()],
            project_name: None,
        }
    }

    fn plan_name(plan: &SessionPlan) -> &'static str {
        match plan {
            SessionPlan::Launch { .. } => "Launch",
            SessionPlan::Warming { .. } => "Warming",
            SessionPlan::Unavailable { .. } => "Unavailable",
        }
    }

    /// SSH（Remote）项目：Java 调试**显式不支持**（A 与 B' 皆然）；Local / WSL 放行。
    #[test]
    fn java_debug_is_unsupported_only_on_remote() {
        use crate::common::executor::factory::ExecTarget;
        let backend = fake_backend(ready_capability());
        assert!(backend.supported_on(&ExecTarget::Local), "Local 必须支持");
        assert!(
            backend.supported_on(&ExecTarget::Wsl {
                distro: "Ubuntu".into()
            }),
            "WSL 必须支持"
        );
        assert!(
            !backend.supported_on(&ExecTarget::Remote {
                host: "h".into(),
                port: 22,
                username: "u".into(),
                auth: crate::common::connection::types::AuthMethod::Password("p".into()),
            }),
            "SSH 不支持"
        );
        // 文案必须点明"SSH"与替代方案（用户据此行动）。
        let msg = backend.unsupported_error().to_string();
        assert!(msg.contains("SSH"), "{msg}");
        assert!(msg.contains("WSL"), "{msg}");
    }

    /// **本轮 bug 的回归**：未能验证项目名时 `LaunchConfig.project_name` 必须是 `None`，
    /// 不得回落到项目/模块**目录名**（那会让 jdt.ls 以 "not a valid java project" 拒绝）。
    #[tokio::test]
    async fn plan_java_debug_never_invents_project_name() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_id) = java_route_state_named(&tmp, "tomgs-java", ready_capability());
        let project_dir = tmp.path().join("tomgs-java");
        let target = jdtls_target(&project_dir.to_string_lossy());

        match fake_backend(ready_capability())
            .plan(&state, &DebugRequest::JavaJdtls { project_id, target })
            .await
            .expect("ready")
        {
            SessionPlan::Launch { config, .. } => {
                assert_eq!(
                    config.project_name, None,
                    "未验证到名字时必须留空，而不是回落到目录名 {:?}",
                    project_dir
                );
            }
            other => panic!("expected Launch, got {}", plan_name(&other)),
        }
    }

    /// 显式 `host` 时后端拒绝服务（不得静默改道到 B'）。
    #[tokio::test]
    async fn plan_java_debug_rejects_host_backend() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_id) = java_route_state(&tmp, ready_capability());
        state
            .storage_manager
            .save_config(&serde_json::json!({ "dap": { "javaBackend": "host" } }))
            .expect("save_config");

        let err = match fake_backend(ready_capability())
            .plan(
                &state,
                &DebugRequest::JavaJdtls {
                    project_id,
                    target: jdtls_target("/proj"),
                },
            )
            .await
        {
            Err(e) => e,
            Ok(_) => panic!("host backend must be refused"),
        };
        assert!(err.to_string().contains("host"), "{err}");
    }

    /// 参数校验：空 cwd / 空 class 一律 `InvalidInput`（不进入能力探测）。
    #[tokio::test]
    async fn plan_java_debug_validates_required_inputs() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_id) = java_route_state(&tmp, ready_capability());

        assert!(matches!(
            fake_backend(ready_capability())
                .plan(
                    &state,
                    &DebugRequest::JavaJdtls {
                        project_id: project_id.clone(),
                        target: jdtls_target("  "),
                    },
                )
                .await,
            Err(AppError::InvalidInput(_))
        ));

        let mut blank_class = jdtls_target("/proj");
        blank_class.probe_class = "   ".into();
        assert!(matches!(
            fake_backend(ready_capability())
                .plan(
                    &state,
                    &DebugRequest::JavaJdtls {
                        project_id: project_id.clone(),
                        target: blank_class,
                    },
                )
                .await,
            Err(AppError::InvalidInput(_))
        ));

        let mut blank_main = jdtls_target("/proj");
        blank_main.main_class = "  ".into();
        assert!(matches!(
            fake_backend(ready_capability())
                .plan(
                    &state,
                    &DebugRequest::JavaJdtls {
                        project_id,
                        target: blank_main,
                    },
                )
                .await,
            Err(AppError::InvalidInput(_))
        ));
    }

    /// `Warming` → 决策为等待，**不请求起会话**（transient 既不算失败也不换引擎）。
    #[tokio::test]
    async fn plan_java_debug_warming_does_not_launch() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_id) = java_route_state(
            &tmp,
            JavaDebugCapability::Warming {
                detail: "import running".into(),
            },
        );
        match fake_backend(JavaDebugCapability::Warming {
            detail: "import running".into(),
        })
        .plan(
            &state,
            &DebugRequest::JavaJdtls {
                project_id,
                target: jdtls_target("/proj"),
            },
        )
        .await
        .expect("warming is not an error")
        {
            SessionPlan::Warming { detail } => assert_eq!(detail, "import running"),
            other => panic!("expected Warming, got {}", plan_name(&other)),
        }
    }

    /// `Unavailable` → 决策为不可用 + 静态标记，**不自动换引擎**。
    #[tokio::test]
    async fn plan_java_debug_unavailable_reports_without_fallback() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_id) = java_route_state(
            &tmp,
            JavaDebugCapability::Unavailable {
                reason: crate::dap::adapter::java::capability::JavaDebugUnavailable::BundleMissing,
                statically_detectable: true,
            },
        );
        match fake_backend(JavaDebugCapability::Unavailable {
            reason: crate::dap::adapter::java::capability::JavaDebugUnavailable::BundleMissing,
            statically_detectable: true,
        })
        .plan(
            &state,
            &DebugRequest::JavaJdtls {
                project_id,
                target: jdtls_target("/proj"),
            },
        )
        .await
        .expect("unavailable is a typed decision, not an Err")
        {
            SessionPlan::Unavailable {
                message,
                statically_detectable,
            } => {
                assert!(statically_detectable, "BundleMissing 属静态可判定");
                assert!(message.contains("debug plugin"), "{message}");
            }
            other => panic!("expected Unavailable, got {}", plan_name(&other)),
        }
    }

    /// `Ready` → 组装出 launch 配置：端点、`request=launch`、mainClass、classPaths
    /// （含 Console Launcher 且去重）、modulePaths 透传，cwd 为 canonical 化后的目录。
    #[tokio::test]
    async fn plan_java_debug_ready_assembles_launch_payload() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let project_dir = tmp.path().join("proj");
        let (state, project_id) = java_route_state(
            &tmp,
            JavaDebugCapability::Ready {
                port: 56984,
                module_paths: vec!["/proj/target/classes".into()],
                class_paths: vec!["/proj/target/test-classes".into(), LAUNCHER.into()],
                project_name: Some("verified-name".into()),
            },
        );
        let mut target = jdtls_target(&project_dir.to_string_lossy());
        target.launcher_jar = Some(LAUNCHER.into()); // 已存在 → 必须去重

        match fake_backend(JavaDebugCapability::Ready {
            port: 56984,
            module_paths: vec!["/proj/target/classes".into()],
            class_paths: vec!["/proj/target/test-classes".into(), LAUNCHER.into()],
            project_name: Some("verified-name".into()),
        })
        .plan(&state, &DebugRequest::JavaJdtls { project_id, target })
        .await
        .expect("ready")
        {
            SessionPlan::Launch {
                route,
                config,
                notes,
            } => {
                assert!(notes.is_empty(), "{notes:?}");
                match route {
                    crate::dap::adapter::SessionRoutePlan::Connect { endpoint } => {
                        assert_eq!(endpoint, "127.0.0.1:56984");
                    }
                    // B' 直连外部端点，绝无 spawn debuggee。
                    crate::dap::adapter::SessionRoutePlan::Spawn { .. } => {
                        panic!("expected Connect, got Spawn")
                    }
                }
                assert_eq!(config.request, "launch");
                assert_eq!(config.port, None, "launch 形态不带 attach 端口");
                assert_eq!(
                    config.main_class.as_deref(),
                    Some("org.junit.platform.console.ConsoleLauncher")
                );
                assert_eq!(
                    config.module_paths,
                    vec!["/proj/target/classes".to_string()]
                );
                assert_eq!(
                    config.classpath,
                    vec![
                        "/proj/target/test-classes".to_string(),
                        LAUNCHER.to_string()
                    ],
                    "launcher jar 不得重复"
                );
                let cwd = config.cwd.expect("cwd");
                assert!(cwd.ends_with("proj"), "{cwd}");
                assert_eq!(config.args, vec!["execute".to_string()]);
                // 只采信**服务器验证过**的名字（绝不回落到目录名）。
                assert_eq!(config.project_name.as_deref(), Some("verified-name"));
            }
            other => panic!("expected Launch, got {}", plan_name(&other)),
        }
    }

    /// `dap.javaBackend` 权威读取：缺键/非法一律 `auto`。
    #[test]
    fn java_backend_is_read_from_config_with_auto_default() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = isolated_state(&tmp);
        assert_eq!(
            load_java_backend(&state),
            JavaDebugBackend::Auto,
            "缺键 → auto"
        );

        for (raw, want) in [
            ("jdtls", JavaDebugBackend::Jdtls),
            ("host", JavaDebugBackend::Host),
            ("bogus", JavaDebugBackend::Auto),
        ] {
            state
                .storage_manager
                .save_config(&serde_json::json!({ "dap": { "javaBackend": raw } }))
                .expect("save_config");
            assert_eq!(load_java_backend(&state), want, "{raw}");
        }
    }

    /// A（attach-first）：空 command / 空 cwd 在**边界**拒绝（不进 spawn）。
    #[tokio::test]
    async fn plan_java_attach_validates_required_inputs() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let (state, project_id) = java_route_state(&tmp, ready_capability());

        let empty_cmd = crate::dap::types::JavaDebugTarget {
            command: "  ".into(),
            cwd: "/proj".into(),
            test_name: "t".into(),
            classpath: vec![],
        };
        assert!(matches!(
            fake_backend(ready_capability())
                .plan(
                    &state,
                    &DebugRequest::JavaAttach {
                        project_id: project_id.clone(),
                        target: empty_cmd,
                    },
                )
                .await,
            Err(AppError::InvalidInput(_))
        ));

        let empty_cwd = crate::dap::types::JavaDebugTarget {
            command: "java -jar x.jar".into(),
            cwd: "  ".into(),
            test_name: "t".into(),
            classpath: vec![],
        };
        assert!(matches!(
            fake_backend(ready_capability())
                .plan(
                    &state,
                    &DebugRequest::JavaAttach {
                        project_id,
                        target: empty_cwd,
                    },
                )
                .await,
            Err(AppError::InvalidInput(_))
        ));
    }
}
