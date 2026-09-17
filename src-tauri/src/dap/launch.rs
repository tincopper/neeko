//! 启动编排：launch.json 解析 → 会话形态决策 → 建立会话 → 挂载断点与 debuggee 泵。
//!
//! ## 职责边界
//!
//! - **配置来源**在 `launch_config`（读写 / 发现）；**语言决策**在 `LanguageBackend::plan`
//!   （协议层怎么说话在 `adapter`）；**会话构建**在 `DapSession`；
//!   本模块只做"把这几步按顺序串起来 + 失败语义"。
//! - 依赖 [`DapContext`]（会话所有权 / 断点仓储 / 语言后端 / 项目上下文），
//!   并显式接收事件端口（`Arc<dyn DapEventSink>`）—— 因此可脱离 Tauri 单测。
//!
//! ## 不变量
//!
//! 1. **一个项目一个活动会话**：启动前先停掉该项目的既有会话（含其 debuggee）。
//! 2. **不自动换引擎**：语言后端 `plan` 返回 `Warming` / `Unavailable` 时**不建会话**，
//!    由前端决定询问还是报错（design §2.5）。
//! 3. **debuggee 与会话同生共死**：`SessionRoute` 携带的清理句柄随会话在同一插入点落库，
//!    提前返回时由 `ProcessGuard` 的 RAII 兜底，不泄漏 JVM。
//! 4. **断点身份只翻适配器副本**：翻译在 `source_translation`，本模块只负责把
//!    note 落到 Debug Console（不可翻译必须可见）。

use std::sync::Arc;

use super::breakpoints::service as breakpoint_service;
use super::config::expand_config;
use super::context::DapContext;
use super::events::DapEventSink;
use super::launch_config;
use super::project_context::{adapter_binary_override, project_path};
use super::session::DapSession;
use super::source_translation;
use super::types::{BreakpointSpec, DapSessionInfo, LaunchConfig};
use crate::common::executor::ProcessGuard;
use crate::AppError;

/// Start a new DAP debug session for a project with the given config.
pub(crate) async fn start_session(
    ctx: &DapContext<'_>,
    sink: Arc<dyn DapEventSink>,
    project_id: &str,
    config_name: Option<String>,
    current_file: Option<String>,
) -> Result<DapSessionInfo, AppError> {
    let path = project_path(ctx.state, project_id)?;

    // Prefer existing launch.json; if empty, discover and materialize
    // （与 `list_or_discover_configs` 同一实现，不再各写一份）。
    // 读盘 + 入口点扫描是阻塞 IO，搬进阻塞线程池（Gate #3）。
    let configs = crate::common::runtime::run_blocking_result({
        let path = path.clone();
        move || launch_config::load_or_discover(&path)
    })
    .await?;

    let raw = if let Some(name) = config_name {
        configs
            .into_iter()
            .find(|c| c.name == name)
            .ok_or_else(|| AppError::NotFound(format!("Launch config not found: {name}")))?
    } else {
        // Prefer config matching current file's package if possible.
        pick_config_for_file(&configs, current_file.as_deref(), &path)
            .or_else(|| configs.into_iter().next())
            .ok_or_else(|| {
                AppError::Dap(
                    "No launch configurations and no entry points found \
                         (expected Go cmd/*/main.go or Rust src/main.rs)."
                        .into(),
                )
            })?
    };

    launch_session(
        ctx,
        sink,
        project_id,
        raw,
        current_file.as_deref(),
        SessionRoute::spawn(),
    )
    .await
}

/// Shared launch tail: stop existing project sessions, expand the config,
/// attach breakpoints, start the session and register it.
///
/// `endpoint` 选择会话形态：
/// - `None` → 传统路径：解析 adapter 二进制并 spawn 子进程（go / lldb / Java-A）；
/// - `Some(addr)` → 外部端点路径：直连 Neeko **不拥有**的 DAP 服务器（B'，服务器
///   长在 JDTLS JVM 内），不 spawn、无进程守卫、可用性由调用方的能力探测负责。
///
/// `debuggee`（Java A 的测试 JVM 清理句柄）随会话在同一插入点落库，保证
/// 「条目存在 ⟺ debuggee 被其持有」；函数任一路径提前返回时，句柄 drop 即触发
/// `ProcessGuard` 的 RAII 终止，不泄漏 JVM（外部端点路径恒为 `None`）。
pub(crate) async fn launch_session(
    ctx: &DapContext<'_>,
    sink: Arc<dyn DapEventSink>,
    project_id: &str,
    raw_config: LaunchConfig,
    current_file: Option<&str>,
    route: SessionRoute<'_>,
) -> Result<DapSessionInfo, AppError> {
    // One active session per project.
    for entry in ctx.sessions.take_project(project_id).await {
        entry.shutdown().await;
    }

    let path = project_path(ctx.state, project_id)?;
    let env = ctx.state.project_environment(project_id)?;
    let target = env.to_exec_target();

    let SessionRoute { debuggee, endpoint } = route;
    let config = expand_config(&raw_config, &path, current_file);
    // 启动/重跑路径同样走 effective 过滤（评审 P1）：mute 下新会话载荷为空。
    // 断点 + 静音位一次快照取全（同源），避免两次取锁之间被改写。
    breakpoint_service::ensure_loaded(ctx, project_id).await?;
    let (files, muted) = ctx.breakpoints.snapshot_with_mute(project_id).await;
    let bps: Vec<BreakpointSpec> = files.into_iter().flat_map(|(_, specs)| specs).collect();
    // 断点身份 → 适配器可读的**真实文件路径**（java-debug 只认真实文件或带 JDT handle 的
    // `jdt://` uri，而 handle 取不到）。只翻**适配器副本**：持久化与回传前端仍是规范身份。
    // 语言差异由该语言的编排后端承担（Go/Lldb 无后端 → 原样透传）。
    // 语言身份只解析一次：协议层插件 → AdapterKind → 编排后端（与实时路径同源）。
    let (kind, backend) = ctx.backends.for_config(&config)?;
    let (adapter_bps, breakpoint_notes) = source_translation::adapter_breakpoints(
        backend.as_deref(),
        ctx.state,
        &target,
        &config.classpath,
        &bps,
        muted,
    )
    .await;

    // 项目根要作为适配器 workspace 与 IPC 字段下发：**不可表示即拒绝**，
    // 不用 `to_string_lossy` 把路径悄悄换成另一个（适配器会拿错误 workspace 去解析
    // 源码，症状是"断点全是 verified:false"）。
    let Some(project_root) = path.to_str() else {
        return Err(AppError::Dap(format!(
            "Project path is not valid UTF-8 and cannot be used as a debug workspace: {}",
            path.display()
        )));
    };
    let project_root = project_root.to_string();

    let session = match endpoint {
        // 外部 DAP 端点（B'）：不 spawn、不查 adapter 覆盖、不看 is_available。
        Some(addr) => {
            DapSession::connect(
                addr,
                sink,
                project_id.to_string(),
                project_root,
                config,
                adapter_bps,
            )
            .await?
        }
        None => {
            // 用户显式 adapter 二进制覆盖（config `dap.adapterBinaries.<kind>`，对齐
            // Zed `dap.$ADAPTER.binary`）：resolve_spawn 用它而非默认探测。
            let adapter_binary = adapter_binary_override(ctx.state, kind).await;
            DapSession::start(
                sink,
                project_id.to_string(),
                project_root,
                target,
                config,
                adapter_bps,
                adapter_binary,
            )
            .await?
        }
    };

    // 未能翻译的断点必须**可见**：否则用户只看到"断点没命中"，无从判断是源码不可得
    // 还是断点本身错（B' 下适配器只会静默回 verified:false）。
    for note in &breakpoint_notes {
        session.emit_output("console", note);
    }

    let info = session.info().await;
    // 会话与 debuggee 同一插入点落库（原子）：消除「先插会话、后挂
    // debuggee」之间的并发停止泄漏窗口。
    ctx.sessions.insert(session, debuggee).await;
    Ok(info)
}

/// Start a DAP debug session from a fully-specified config, bypassing
/// launch.json entirely (editor inline test debug: synthetic lldb launch
/// with program = test binary parsed from `cargo test --no-run` output).
pub(crate) async fn start_session_config(
    ctx: &DapContext<'_>,
    sink: Arc<dyn DapEventSink>,
    project_id: &str,
    raw_config: LaunchConfig,
) -> Result<DapSessionInfo, AppError> {
    launch_session(
        ctx,
        sink,
        project_id,
        raw_config,
        None,
        SessionRoute::spawn(),
    )
    .await
}

/// 语言编排调试入口：按 `request` 的语言 kind 查编排后端（§9.4 方案 C），
/// `backend.plan` 决策（Launch / Warming / Unavailable）→ `launch_session` 起会话。
///
/// - Java A（attach-first）：plan 已 spawn 测试 JVM 并解析 jdwp 端口，route 携带
///   debuggee guard + 输出通道；本函数起 attach 会话后挂载 JVM 输出泵（管道关闭
///   ⟺ JVM 退出 ⟺ 会话结束，对齐原 `start_java_via_host` 的 `pump_output` 语义）。
/// - Java B'（jdtls）：plan 已做能力探测（Ready/Warming/Unavailable），
///   Ready 时 route 携带外部端点，直连（`DapSession::connect`）。
///
/// **不自动换引擎**（design §2.5）：不可用只返回 `DebugStartOutcome::Unavailable`，
/// 由前端按 `statically_detectable` 决定询问还是报错。
pub(crate) async fn start_language_debug(
    ctx: &DapContext<'_>,
    sink: Arc<dyn DapEventSink>,
    request: crate::dap::adapter::DebugRequest,
) -> Result<crate::dap::adapter::DebugStartOutcome, AppError> {
    // kind 由请求自身给出（`DebugRequest::kind`）—— 不在调用点硬编码语言名。
    let kind = request.kind();
    let project_id = request.project_id().to_string();
    let backend = ctx.backends.get(kind).ok_or_else(|| {
        AppError::Dap(format!(
            "no orchestration backend for debug kind {}",
            kind.as_str()
        ))
    })?;
    let plan = backend.plan(ctx.state, &request).await?;

    match plan {
        crate::dap::adapter::SessionPlan::Launch {
            route,
            config,
            notes,
        } => {
            let (debuggee, endpoint, output_rx) = match route {
                crate::dap::adapter::SessionRoutePlan::Spawn {
                    debuggee,
                    debuggee_output,
                } => (debuggee, None, debuggee_output),
                crate::dap::adapter::SessionRoutePlan::Connect { endpoint } => {
                    (None, Some(endpoint), None)
                }
            };
            let route = SessionRoute {
                debuggee,
                endpoint: endpoint.as_deref(),
            };
            let info = launch_session(ctx, sink, &project_id, *config, None, route).await?;
            emit_console_notes(ctx, &info.session_id, &notes).await;
            mount_debuggee_output(ctx, info.session_id.clone(), output_rx).await;
            Ok(crate::dap::adapter::DebugStartOutcome::Session { session: info })
        }
        crate::dap::adapter::SessionPlan::Warming { detail } => {
            Ok(crate::dap::adapter::DebugStartOutcome::Warming { detail })
        }
        crate::dap::adapter::SessionPlan::Unavailable {
            message,
            statically_detectable,
        } => Ok(crate::dap::adapter::DebugStartOutcome::Unavailable {
            message,
            statically_detectable,
        }),
    }
}

/// 把诊断 note 落到会话的 Debug Console（会话已不在则丢弃 —— 启动失败路径）。
async fn emit_console_notes(ctx: &DapContext<'_>, session_id: &str, notes: &[String]) {
    if notes.is_empty() {
        return;
    }
    let Some(session) = ctx.sessions.get(session_id).await else {
        return;
    };
    for note in notes {
        session.emit_output("console", note);
    }
}

/// 挂载附属 debuggee 的输出泵（Java-A 的测试 JVM）：管道关闭 ⟺ JVM 退出 ⟺ 会话结束。
///
/// 用户 Stop / 适配器 terminated 已收尾时，`finish_terminated` 的幂等守卫让
/// 收尾成为 no-op。无输出通道（非 spawn 形态 / 无附属进程）时是 no-op。
async fn mount_debuggee_output(
    ctx: &DapContext<'_>,
    session_id: String,
    output_rx: Option<tokio::sync::mpsc::Receiver<(String, String)>>,
) {
    let Some(output_rx) = output_rx else {
        return;
    };
    let Some(session) = ctx.sessions.get(&session_id).await else {
        return;
    };
    let emit_session = Arc::clone(&session);
    let exit_session = Arc::clone(&session);
    tokio::spawn(async move {
        super::launch_support::pump_output(
            output_rx,
            move |category, line| emit_session.emit_output(category, line),
            move || async move {
                exit_session.debuggee_exited("Debuggee exited").await;
            },
        )
        .await;
    });
}

/// 优先挑 program 目录**包含当前文件**的 launch 配置。
///
/// 这是**选择派生**（为了给"按当前文件调试"挑一个合理默认），不是文件身份判定：
/// 用 `Path::starts_with`（按路径组件比较，`/a/main` 不会误配 `/a/main2`），
/// 打分用**组件深度**而非字符串长度 —— 后者在 Windows 反斜杠 / UNC 路径下排序不稳定。
///
/// 没有匹配时的回落（取第一个配置）由调用方决定；前端可从会话信息的 `configName`
/// 看到实际使用的配置。
fn pick_config_for_file(
    configs: &[LaunchConfig],
    current_file: Option<&str>,
    workspace: &std::path::Path,
) -> Option<LaunchConfig> {
    let file = current_file?;
    let file_path = std::path::Path::new(file);
    let mut best: Option<(usize, LaunchConfig)> = None;
    for cfg in configs {
        let Some(prog) = cfg.program.as_ref() else {
            continue;
        };
        let expanded = super::config::expand_variables(prog, workspace, current_file);
        let prog_path = std::path::Path::new(&expanded);
        if !file_path.starts_with(prog_path) {
            continue;
        }
        let depth = prog_path.components().count();
        if best
            .as_ref()
            .is_none_or(|(best_depth, _)| depth > *best_depth)
        {
            best = Some((depth, cfg.clone()));
        }
    }
    best.map(|(_, c)| c)
}

/// 会话形态：`spawn`（子进程：go / lldb / Java-A）或 `connect`（外部 DAP 端点：B'）。
///
/// 收进单一结构体，避免 `launch_session` 的参数继续膨胀（clippy `too_many_arguments`），
/// 也让"是否拥有子进程"这一点在调用点就显式。
pub(crate) struct SessionRoute<'a> {
    /// A（自写 host）的测试 JVM 清理句柄；仅 spawn 形态使用。
    pub(crate) debuggee: Option<ProcessGuard>,
    /// 外部 DAP 端点（`127.0.0.1:<port>`）；`None` 表示 spawn 形态。
    pub(crate) endpoint: Option<&'a str>,
}

impl SessionRoute<'_> {
    /// 传统 spawn 形态（go / lldb / Java-A）。
    const fn spawn() -> Self {
        Self {
            debuggee: None,
            endpoint: None,
        }
    }
}

#[cfg(test)]
mod tests {
    //! 启动编排的单测：**不经门面**（就地构造 `DapContext`），也不需要真实适配器进程
    //! （`FakeAdapter` 走外部端点形态）。
    use super::*;
    use crate::common::executor::factory::ExecTarget;
    use crate::dap::adapter::{
        DebugAdapterPlugin, DebugRequest, LanguageBackend, SessionPlan, SessionRoutePlan,
        SourcePathResolution,
    };
    use crate::dap::breakpoints::service as bp_service;
    use crate::dap::testing::{go_launch_config, DapFixture, FakeAdapter, RecordingSink};
    use crate::dap::types::{AdapterKind, BreakpointLine, JavaDebugTarget};
    use crate::AppStateWrapper;
    use std::path::PathBuf;

    /// 只回答"身份翻译"的最小后端：把身份映射成 `/translated/...` 前缀，便于断言
    /// "启动路径是否按 `AdapterKind` 找到了后端"（找不到即原样透传，断言即红）。
    struct TranslatingBackend;

    static GO_PLUGIN: crate::dap::adapter::GoAdapter = crate::dap::adapter::GoAdapter;

    #[async_trait::async_trait]
    impl LanguageBackend for TranslatingBackend {
        fn plugin(&self) -> &dyn DebugAdapterPlugin {
            &GO_PLUGIN
        }
        async fn plan(
            &self,
            _state: &AppStateWrapper,
            _request: &DebugRequest,
        ) -> Result<SessionPlan, AppError> {
            Err(AppError::Dap("not exercised by this test".into()))
        }
        async fn adapter_source_path(
            &self,
            _state: &AppStateWrapper,
            _target: &ExecTarget,
            _classpath: &[String],
            identity: &str,
        ) -> SourcePathResolution {
            SourcePathResolution::Adapter(PathBuf::from(format!("/translated{identity}")))
        }
    }

    /// 返回注入的三态结果：用来验证 `start_language_debug` 的**分发**（不只是 `plan` 的决策）。
    struct PlanBackend(SessionPlan);

    #[async_trait::async_trait]
    impl LanguageBackend for PlanBackend {
        fn plugin(&self) -> &dyn DebugAdapterPlugin {
            &GO_PLUGIN
        }
        async fn plan(
            &self,
            _state: &AppStateWrapper,
            _request: &DebugRequest,
        ) -> Result<SessionPlan, AppError> {
            Ok(match &self.0 {
                SessionPlan::Launch {
                    route,
                    config,
                    notes,
                } => SessionPlan::Launch {
                    route: match route {
                        SessionRoutePlan::Spawn { .. } => SessionRoutePlan::Connect {
                            endpoint: String::new(),
                        },
                        SessionRoutePlan::Connect { endpoint } => SessionRoutePlan::Connect {
                            endpoint: endpoint.clone(),
                        },
                    },
                    config: config.clone(),
                    notes: notes.clone(),
                },
                SessionPlan::Warming { detail } => SessionPlan::Warming {
                    detail: detail.clone(),
                },
                SessionPlan::Unavailable {
                    message,
                    statically_detectable,
                } => SessionPlan::Unavailable {
                    message: message.clone(),
                    statically_detectable: *statically_detectable,
                },
            })
        }
        async fn adapter_source_path(
            &self,
            _state: &AppStateWrapper,
            _target: &ExecTarget,
            _classpath: &[String],
            identity: &str,
        ) -> SourcePathResolution {
            SourcePathResolution::Adapter(PathBuf::from(identity))
        }
    }

    /// 走外部端点形态起会话（不 spawn 进程，握手对着假适配器完成）。
    async fn launch_endpoint(
        f: &DapFixture,
        sink: Arc<dyn DapEventSink>,
        adapter: &FakeAdapter,
        config: LaunchConfig,
    ) -> Result<DapSessionInfo, AppError> {
        launch_session(
            &f.ctx(),
            sink,
            &f.project_id,
            config,
            None,
            SessionRoute {
                debuggee: None,
                endpoint: Some(adapter.addr()),
            },
        )
        .await
    }

    /// `type: "junit"` + `request: "attach"`（JavaAdapter 的 attach 载荷只需 port）。
    fn alias_config(type_: &str) -> LaunchConfig {
        LaunchConfig {
            type_: type_.into(),
            request: "attach".into(),
            port: Some(1),
            ..go_launch_config("Alias")
        }
    }

    fn java_attach_request(project_id: &str) -> DebugRequest {
        DebugRequest::JavaAttach {
            project_id: project_id.to_string(),
            target: JavaDebugTarget {
                command: "java".into(),
                cwd: "/proj".into(),
                test_name: "t".into(),
                classpath: vec![],
            },
        }
    }

    /// **回归（身份分裂）**：launch.json 写 `type` 别名（`junit`）时，启动路径必须与
    /// 实时路径落到同一个 `AdapterKind` 后端 —— 否则断点源路径不做翻译，`jdt:` 伪路径
    /// 直接进适配器载荷，用户只看到"断点永不命中"。
    ///
    /// 别名 → kind 的**纯映射**由 `dap::backends` 的单测覆盖；本用例只钉端到端结果。
    #[tokio::test]
    async fn junit_type_alias_translates_breakpoints_on_launch_path() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let f = DapFixture::new(&tmp);
        f.backends
            .register(AdapterKind::Java, Arc::new(TranslatingBackend));
        let adapter = FakeAdapter::start().await;

        bp_service::set_breakpoints(
            &f.ctx(),
            &f.project_id,
            "jdt:/java.base/java/io/PrintStream.java",
            vec![BreakpointLine {
                line: 42,
                enabled: true,
            }],
            None,
        )
        .await
        .expect("set");

        let info = launch_endpoint(&f, RecordingSink::new(), &adapter, alias_config("junit"))
            .await
            .expect("launch");
        assert_eq!(info.status, "running");

        let requests = adapter.breakpoint_requests();
        assert_eq!(requests.len(), 1, "{requests:?}");
        assert_eq!(
            requests[0].pointer("/source/path").and_then(|v| v.as_str()),
            Some("/translatedjdt:/java.base/java/io/PrintStream.java"),
            "别名启动路径必须走编排后端翻译（伪路径绝不允许进适配器）"
        );
    }

    /// 启动链路端到端：登记会话、只下发 effective 行、状态事件经端口投递。
    #[tokio::test]
    async fn launch_session_registers_session_and_forwards_effective_breakpoints() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let f = DapFixture::new(&tmp);
        let sink = RecordingSink::new();
        let adapter = FakeAdapter::start().await;

        bp_service::set_breakpoints(
            &f.ctx(),
            &f.project_id,
            "/proj/src/main.go",
            vec![
                BreakpointLine {
                    line: 10,
                    enabled: true,
                },
                BreakpointLine {
                    line: 20,
                    enabled: false,
                },
            ],
            None,
        )
        .await
        .expect("set");

        let info = launch_endpoint(&f, sink.clone(), &adapter, go_launch_config("Go"))
            .await
            .expect("launch");

        assert_eq!(info.status, "running");
        assert!(
            sink.statuses().iter().any(|s| s == "running"),
            "状态变更必须经事件端口投递: {:?}",
            sink.statuses()
        );
        assert!(
            sink.has_kind("session"),
            "会话就绪事件必须经端口投递: {:?}",
            sink.kinds()
        );

        let requests = adapter.breakpoint_requests();
        assert_eq!(requests.len(), 1, "一个文件一次下发: {requests:?}");
        assert_eq!(
            requests[0].pointer("/source/path").and_then(|v| v.as_str()),
            Some("/proj/src/main.go")
        );
        let lines: Vec<u64> = requests[0]
            .pointer("/breakpoints")
            .and_then(|v| v.as_array())
            .expect("breakpoints array")
            .iter()
            .filter_map(|b| b.get("line").and_then(serde_json::Value::as_u64))
            .collect();
        assert_eq!(lines, vec![10], "disabled 行不得进入启动载荷");

        let sessions = f.sessions.snapshot().await;
        assert_eq!(sessions.len(), 1, "会话必须登记进注册表");
        assert_eq!(sessions[0].session_id, info.session_id);
    }

    /// 适配器未解析断点 → 必须有 Console 诊断（否则用户只看到"断点没命中"）。
    #[tokio::test]
    async fn unresolved_breakpoints_surface_console_note() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let f = DapFixture::new(&tmp);
        let sink = RecordingSink::new();
        let adapter = FakeAdapter::start_with(false).await;

        bp_service::set_breakpoints(
            &f.ctx(),
            &f.project_id,
            "/proj/src/main.go",
            vec![BreakpointLine {
                line: 10,
                enabled: true,
            }],
            None,
        )
        .await
        .expect("set");

        launch_endpoint(&f, sink.clone(), &adapter, go_launch_config("Go"))
            .await
            .expect("launch");

        let outputs = sink.outputs();
        assert!(
            outputs
                .iter()
                .any(|o| o.contains("not resolved by the adapter")),
            "未解析断点必须有 Console 诊断: {outputs:?}"
        );
    }

    /// **设计不变量（design §2.5）**：`Warming` / `Unavailable` **绝不建会话**，
    /// `Launch` 才建 —— 此前只在 `JavaBackend::plan` 层验证，启动器层无断言。
    #[tokio::test]
    async fn language_plan_three_states_dispatch_without_leaking_sessions() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let f = DapFixture::new(&tmp);
        let adapter = FakeAdapter::start().await;

        // 未就绪 / 不可用：返回对应状态，且会话表必须保持为空。
        for plan in [
            SessionPlan::Warming {
                detail: "indexing".into(),
            },
            SessionPlan::Unavailable {
                message: "no JDK".into(),
                statically_detectable: true,
            },
        ] {
            f.backends
                .register(AdapterKind::Java, Arc::new(PlanBackend(plan)));
            let outcome = start_language_debug(
                &f.ctx(),
                RecordingSink::new(),
                java_attach_request(&f.project_id),
            )
            .await
            .expect("plan 决策不是错误");
            assert!(
                matches!(
                    outcome,
                    crate::dap::adapter::DebugStartOutcome::Warming { .. }
                        | crate::dap::adapter::DebugStartOutcome::Unavailable { .. }
                ),
                "未就绪/不可用必须原样上抛，不自动换引擎"
            );
            assert!(
                f.sessions.snapshot().await.is_empty(),
                "不可用/未就绪时绝不允许建会话"
            );
        }

        // 就绪：建会话（走外部端点，不 spawn 进程）。
        f.backends.register(
            AdapterKind::Java,
            Arc::new(PlanBackend(SessionPlan::Launch {
                route: SessionRoutePlan::Connect {
                    endpoint: adapter.addr().to_string(),
                },
                config: Box::new(go_launch_config("Go")),
                notes: vec!["one skipped breakpoint".into()],
            })),
        );
        let outcome = start_language_debug(
            &f.ctx(),
            RecordingSink::new(),
            java_attach_request(&f.project_id),
        )
        .await
        .expect("launch");
        assert!(matches!(
            outcome,
            crate::dap::adapter::DebugStartOutcome::Session { .. }
        ));
        assert_eq!(f.sessions.snapshot().await.len(), 1, "就绪时必须建会话");
    }

    /// `pick_config_for_file`：**组件深度最深**的匹配胜出（不是字符串最长）。
    #[test]
    fn pick_config_prefers_deepest_program_match_and_falls_back_to_none() {
        let workspace = std::path::Path::new("/proj");
        let shallow = LaunchConfig {
            name: "shallow".into(),
            program: Some("${workspaceFolder}".into()),
            ..go_launch_config("x")
        };
        let deep = LaunchConfig {
            name: "deep".into(),
            program: Some("${workspaceFolder}/cmd/app".into()),
            ..go_launch_config("y")
        };
        let configs = vec![shallow, deep];

        assert_eq!(
            pick_config_for_file(&configs, Some("/proj/cmd/app/main.go"), workspace)
                .expect("deepest match")
                .name,
            "deep"
        );
        assert_eq!(
            pick_config_for_file(&configs, Some("/proj/other/x.go"), workspace)
                .expect("shallow match")
                .name,
            "shallow"
        );
        assert!(pick_config_for_file(&configs, Some("/elsewhere/x.go"), workspace).is_none());
        assert!(pick_config_for_file(&configs, None, workspace).is_none());
    }
}
