//! Shared DAP types for IPC with the frontend and internal domain enums.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::AppError;

// ── Launch / breakpoint persistence (IPC + disk) ───────────────────────────

/// One entry in `.neeko/launch.json` `configurations` array.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchConfig {
    /// Display name for this launch configuration.
    pub name: String,
    /// Adapter type: `lldb` (Rust) or `go` (Delve).
    #[serde(rename = "type")]
    pub type_: String,
    /// `launch` or `attach` (MVP: launch; Java attach-first 用 attach)。
    pub request: String,
    /// Path to the program/debug target.
    #[serde(default)]
    pub program: Option<String>,
    /// Working directory for the debug session.
    #[serde(default)]
    pub cwd: Option<String>,
    /// Command-line arguments passed to the program.
    #[serde(default)]
    pub args: Vec<String>,
    /// Go: `debug` | `test` | …
    #[serde(default)]
    pub mode: Option<String>,
    /// Java attach-first：已运行测试 JVM 的 jdwp 监听端口（`address=<port>`）。
    /// JavaAdapter.build_launch_args 据此生成 DAP attach 请求（SocketAttachingConnector）。
    #[serde(default)]
    pub port: Option<u16>,
    /// Optional shell command run in project env before launch (e.g. `cargo build`).
    #[serde(default)]
    pub pre_launch_task: Option<String>,
    /// Stop at program entry before running (default false — only user breakpoints).
    #[serde(default)]
    pub stop_on_entry: Option<bool>,
    /// Java attach-first：debuggee 的运行时 classpath 条目（`target/classes`、
    /// 依赖 jar…）。A 路径下 JavaAdapter 把它并入 attach 载荷的 `sourcePaths`
    /// （attach 无 `classPaths` 字段，见 `Requests$AttachArguments`），host 侧据此
    /// 解析第三方库 / JDK 源码；B' 路径下它就是 launch 载荷的 `classPaths`。
    /// 其他适配器忽略。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub classpath: Vec<String>,
    /// **Java adapter 专属**（§9.4 方案 C）：B'（launch）的 DAP `mainClass`。
    /// 测试调试为 JUnit Console Launcher；应用调试为目标 main 类。A 路径（attach）
    /// 不使用。仅 `adapter/java/` 构造站点赋值；通用层（manager / discover）不得消费。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_class: Option<String>,
    /// **Java adapter 专属**（§9.4 方案 C）：JDTLS 的 project name（多模块消歧；
    /// A 路径的 attach 载荷也用它）。
    ///
    /// **evaluate 的硬前置**：真机实证缺该字段时求值直接失败 ——
    /// `Cannot evaluate, please specify projectName in launch.json.`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    /// **Java adapter 专属**（§9.4 方案 C）：B'（launch）的 DAP `modulePaths`
    /// （模块化工程）。普通 classpath 工程为空且**合法为空**——就绪判据只看
    /// `classpath` 非空（见 Java debug 能力探测）。仅 `adapter/java/` 构造站点赋值。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub module_paths: Vec<String>,
}

/// 单次源码传输上限（字节）。
///
/// 外部源码只读读取（`dap_read_external_source`）与 DAP `source` 虚拟源码
/// （`dap_source_content`）共用一个数字：与前端 `canEdit` 阈值（512KB）对齐，
/// 且远低于 2MB 的 IPC 返回红线。超限一律拒绝而不是截断 —— 截断的源码会静默
/// 误导定位。
pub const MAX_SOURCE_BYTES: u64 = 512 * 1024;

/// Java attach-first 的 debuggee 启动目标。
///
/// 四个字段同源（编辑器同一次 Debug 动作产出）且共同回答「要调试什么」——
/// 收进单一结构体，避免 manager / 命令层之间的长参数列表各自漂移。
#[derive(Debug, Clone)]
pub struct JavaDebugTarget {
    /// 已就绪的 debuggee shell 命令（前端 `buildJavaDebugCommand` 产物）。
    pub command: String,
    /// 运行目录（模块根）；空值拒绝。
    pub cwd: String,
    /// 会话显示名中的用例名（`Debug test: <name>`）。
    pub test_name: String,
    /// debuggee 运行时 classpath 条目（前端 `buildJavaClasspathEntries` 产物）：
    /// 随 attach 载荷的 `sourcePaths` 送达 host，供其解析第三方库 / JDK 源码。
    pub classpath: Vec<String>,
}

/// File-backed launch file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchFile {
    /// Launch file format version.
    #[serde(default = "default_version")]
    pub version: String,
    /// List of named launch configurations.
    #[serde(default)]
    pub configurations: Vec<LaunchConfig>,
}

fn default_version() -> String {
    "0.1.0".into()
}

impl Default for LaunchFile {
    fn default() -> Self {
        Self {
            version: default_version(),
            configurations: Vec::new(),
        }
    }
}

/// 断点缺省使能态：老数据 / 缺字段一律视为已启用（`enabled` 是 0.2.0 引入的字段）。
const fn bp_enabled_default() -> bool {
    true
}

/// 请求载荷：`dap_set_breakpoints` 的**一条**断点（行号 + 使能位）。
///
/// DAP 无 enabled 位（`setBreakpoints` 按文件全量替换），「禁用」只能是客户端过滤：
/// disabled 留模型、不进适配器载荷。前端下发全文件 entries（含 disabled），
/// 后端按 effective（`enabled && !muted`）过滤后才发给适配器。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakpointLine {
    /// 1-based line number.
    pub line: u32,
    /// Whether the breakpoint is enabled（缺省 true，兼容旧请求）。
    #[serde(default = "bp_enabled_default")]
    pub enabled: bool,
}

/// Breakpoint as seen by the UI (1-based lines).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakpointSpec {
    /// Absolute file path for the breakpoint.
    pub file_path: String,
    /// 1-based line number.
    pub line: u32,
    /// Whether the adapter confirmed the breakpoint.
    #[serde(default)]
    pub verified: bool,
    /// Whether the breakpoint is enabled（老文件缺字段 → 全启用）。
    #[serde(default = "bp_enabled_default")]
    pub enabled: bool,
}

/// Active debug session snapshot for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DapSessionInfo {
    /// Unique debug session identifier.
    pub session_id: String,
    /// Project the session belongs to.
    pub project_id: String,
    /// Filesystem path of the project.
    pub project_path: String,
    /// Name of the launch configuration used.
    pub config_name: String,
    /// Wire string: starting | running | stopped | terminated
    pub status: String,
    /// Optional human-readable status detail.
    pub status_message: Option<String>,
}

/// Payload for `dap-event` Tauri events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DapEventPayload {
    /// Session that produced the event.
    pub session_id: String,
    /// Project associated with the session.
    pub project_id: String,
    /// stopped | continued | terminated | output | session
    pub kind: String,
    /// Event payload body, format depends on kind.
    #[serde(default)]
    pub body: Value,
}

/// Stack frame for UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackFrameDto {
    /// Adapter-assigned stack frame identifier.
    pub id: i64,
    /// Function name for this frame.
    pub name: String,
    /// Source file path, if available.
    pub source_path: Option<String>,
    /// 1-based line number in the source file.
    pub line: u32,
    /// 1-based column number in the source file.
    pub column: u32,
    /// DAP `Source.name`（适配器给的类 / 文件名），虚拟源码 tab 的标题用。
    #[serde(default)]
    pub source_name: Option<String>,
    /// DAP `Source.sourceReference`（>0 = 源码不在磁盘上，需经 DAP `source`
    /// 请求按引用取内容）。缺省 0 / 缺失表示无虚拟源码。
    #[serde(default)]
    pub source_reference: Option<i64>,
}

/// Variable for UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VariableDto {
    /// Variable name.
    pub name: String,
    /// String representation of the variable value.
    pub value: String,
    /// Type name reported by the debugger.
    #[serde(default, rename = "type")]
    pub var_type: Option<String>,
    /// Reference for expanding child variables (0 = no children).
    pub variables_reference: i64,
}

impl VariableDto {
    /// Parse a DAP `Variable` wire object into a [`VariableDto`].
    ///
    /// Missing fields fall back to safe defaults: `name` → `"?"`, `value` →
    /// `""`, `type` → `None`, `variablesReference` → `0` (no children).
    #[must_use]
    pub fn from_dap_json(v: &Value) -> VariableDto {
        VariableDto {
            name: v
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("?")
                .to_string(),
            value: v
                .get("value")
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_string(),
            var_type: v
                .get("type")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string()),
            variables_reference: v
                .get("variablesReference")
                .and_then(|r| r.as_i64())
                .unwrap_or(0),
        }
    }
}

// ── Domain enums (internal + IPC parsing) ──────────────────────────────────

/// Session lifecycle status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStatus {
    /// Adapter is initializing.
    Starting,
    /// Program is executing.
    Running,
    /// Program stopped at a breakpoint or exception.
    Stopped,
    /// Session ended (normally or by disconnect).
    Terminated,
}

impl SessionStatus {
    /// Return the wire-format string for this status.
    #[allow(clippy::must_use_candidate)]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Starting => "starting",
            Self::Running => "running",
            Self::Stopped => "stopped",
            Self::Terminated => "terminated",
        }
    }
}

/// Debugger control actions from the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlAction {
    /// Resume execution.
    Continue,
    /// Step over (next line).
    Next,
    /// Step into function call.
    StepIn,
    /// Step out of current function.
    StepOut,
    /// Pause execution.
    Pause,
}

impl ControlAction {
    /// Parse a control action from a UI-provided string.
    pub fn parse(action: &str) -> Result<Self, AppError> {
        match action {
            "continue" => Ok(Self::Continue),
            "next" => Ok(Self::Next),
            "stepIn" | "step_in" => Ok(Self::StepIn),
            "stepOut" | "step_out" => Ok(Self::StepOut),
            "pause" => Ok(Self::Pause),
            other => Err(AppError::Dap(format!("unknown control action: {other}"))),
        }
    }

    /// Return the DAP protocol command string for this action.
    #[allow(clippy::must_use_candidate)]
    pub const fn dap_command(self) -> &'static str {
        match self {
            Self::Continue => "continue",
            Self::Next => "next",
            Self::StepIn => "stepIn",
            Self::StepOut => "stepOut",
            Self::Pause => "pause",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_parse_control_actions() {
        assert_eq!(
            ControlAction::parse("continue").unwrap(),
            ControlAction::Continue
        );
        assert_eq!(
            ControlAction::parse("step_in").unwrap(),
            ControlAction::StepIn
        );
        assert!(ControlAction::parse("nope").is_err());
    }

    #[test]
    fn should_map_adapter_kind_from_config_type() {
        assert_eq!(
            AdapterKind::from_config_type("go").unwrap(),
            AdapterKind::Go
        );
        assert_eq!(
            AdapterKind::from_config_type("rust").unwrap(),
            AdapterKind::Lldb
        );
        assert!(AdapterKind::from_config_type("python").is_err());
    }

    #[test]
    fn should_expose_session_status_wire_strings() {
        assert_eq!(SessionStatus::Stopped.as_str(), "stopped");
        assert_eq!(SessionStatus::Terminated.as_str(), "terminated");
    }

    /// Editor inline test debug sends a synthetic launch config over IPC.
    /// The exact frontend payload shape (camelCase, optional cwd, args list)
    /// must deserialize into LaunchConfig unchanged.
    #[test]
    fn should_deserialize_synthetic_test_debug_launch_config() {
        let payload = serde_json::json!({
            "name": "Debug test: parse_simple",
            "type": "lldb",
            "request": "launch",
            "program": "/proj/target/debug/deps/neeko-abc123",
            "cwd": "/proj",
            "args": ["parse_simple"],
            "stopOnEntry": false
        });
        let cfg: LaunchConfig = serde_json::from_value(payload).expect("deserialize");
        assert_eq!(cfg.name, "Debug test: parse_simple");
        assert_eq!(cfg.type_, "lldb");
        assert_eq!(cfg.request, "launch");
        assert_eq!(
            cfg.program.as_deref(),
            Some("/proj/target/debug/deps/neeko-abc123")
        );
        assert_eq!(cfg.cwd.as_deref(), Some("/proj"));
        assert_eq!(cfg.args, vec!["parse_simple".to_string()]);
        assert_eq!(cfg.stop_on_entry, Some(false));
    }

    #[test]
    fn build_output_deserializes_snake_case() {
        let out: DebugBuildOutput = serde_json::from_str(
            r#"{"exit_code":101,"stdout":"error","stderr":"go: cannot find main module"}"#,
        )
        .expect("valid dto");
        assert_eq!(
            out,
            DebugBuildOutput {
                exit_code: 101,
                stdout: "error".into(),
                stderr: "go: cannot find main module".into()
            }
        );
        let back = serde_json::to_value(&out).expect("serializable");
        assert_eq!(back["exit_code"], 101);
        assert_eq!(back["stdout"], "error");
        assert_eq!(back["stderr"], "go: cannot find main module");
    }

    #[test]
    fn should_parse_dap_variable_wire_object() {
        let v = serde_json::json!({
            "name": "m",
            "value": "map[string]string{...}",
            "type": "map[string]string",
            "variablesReference": 42
        });
        let dto = VariableDto::from_dap_json(&v);
        assert_eq!(dto.name, "m");
        assert_eq!(dto.value, "map[string]string{...}");
        assert_eq!(dto.var_type.as_deref(), Some("map[string]string"));
        assert_eq!(dto.variables_reference, 42);
    }

    #[test]
    fn should_default_missing_dap_variable_fields() {
        let dto = VariableDto::from_dap_json(&serde_json::json!({}));
        assert_eq!(dto.name, "?");
        assert_eq!(dto.value, "");
        assert_eq!(dto.var_type, None);
        assert_eq!(dto.variables_reference, 0);

        // Non-string type / non-integer reference fall back too.
        let weird = serde_json::json!({ "name": "x", "type": 1, "variablesReference": "n" });
        let dto = VariableDto::from_dap_json(&weird);
        assert_eq!(dto.name, "x");
        assert_eq!(dto.value, "");
        assert_eq!(dto.var_type, None);
        assert_eq!(dto.variables_reference, 0);
    }
}

/// Supported debug adapter families.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdapterKind {
    /// Go / Delve debugger.
    Go,
    /// LLDB-based debugger for Rust and native binaries.
    Lldb,
    /// Java debug host（自写 JVM 托管 com.microsoft.java.debug.core，attach-first）。
    Java,
}

impl AdapterKind {
    /// Map launch.json `type` field to a known adapter family.
    pub fn from_config_type(type_: &str) -> Result<Self, AppError> {
        match type_ {
            "go" | "delve" => Ok(Self::Go),
            "lldb" | "rust" | "codelldb" => Ok(Self::Lldb),
            "java" | "junit" => Ok(Self::Java),
            other => Err(AppError::Dap(format!("Unsupported debug type: {other}"))),
        }
    }

    /// Config key for per-adapter overrides（`dap.adapterBinaries.<kind>`）。
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Go => "go",
            Self::Lldb => "lldb",
            Self::Java => "java",
        }
    }
}

/// `dap.javaBackend` 的取值：Java 调试后端选择。
///
/// 缺键 / 非法值 / 读取失败一律按 [`JavaDebugBackend::Auto`]（配置契约）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JavaDebugBackend {
    /// 默认：优先 B'（JDTLS 内 java-debug）；不可用时**不自动换引擎**，由前端按
    /// `statically_detectable` 决定"一次性询问"还是"报错 + 显式入口"。
    Auto,
    /// 只用 B'：任何不可用都只报错（不询问）。
    Jdtls,
    /// 只用 A（自写 host，功能受限）；前端直接走 `debug_java_attach`。
    Host,
}

impl JavaDebugBackend {
    /// 解析配置值（大小写敏感，与既有配置键风格一致）。
    #[must_use]
    pub fn parse(raw: Option<&str>) -> Self {
        match raw {
            Some("jdtls") => Self::Jdtls,
            Some("host") => Self::Host,
            _ => Self::Auto,
        }
    }

    /// 配置值字面量。
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Jdtls => "jdtls",
            Self::Host => "host",
        }
    }

    /// 是否允许走 B'（`host` 明确不允许）。
    #[must_use]
    pub const fn allows_jdtls(self) -> bool {
        !matches!(self, Self::Host)
    }
}

/// B'（JDTLS 后端）的调试目标：一次编辑器 Debug 动作产出的结构化身份 + 启动参数。
///
/// **参数构造单点化（D8）**：`args` 与 `main_class` 由前端**唯一一份**用例身份 →
/// 启动参数构造逻辑产出（Run 与 Debug 同源），Rust 侧只补齐真值 classpath 与
/// Console Launcher jar，不重复实现选择器拼装。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaJdtlsTarget {
    /// 能力探测用的类（测试类或 main 类 FQCN）。
    pub probe_class: String,
    /// 运行目录（模块根）。
    pub cwd: String,
    /// 会话显示名中的用例名。
    pub test_name: String,
    /// DAP `mainClass`（测试为 Console Launcher，应用调试为目标 main 类）。
    pub main_class: String,
    /// DAP `args`（前端单点构造）。
    #[serde(default)]
    pub args: Vec<String>,
    /// 测试目标附带 Console Launcher jar（加入 classPaths）；应用调试为 `None`。
    #[serde(default)]
    pub launcher_jar: Option<String>,
    /// 多模块消歧用的 project name；缺省时由后端按项目目录名推导。
    #[serde(default)]
    pub project_name: Option<String>,
}

/// How Neeko speaks DAP with the adapter process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdapterTransport {
    /// Content-Length framing on adapter stdin/stdout (`lldb-dap`).
    Stdio,
    /// Adapter listens on TCP and prints listen address on stdout (`dlv dap`).
    TcpListen,
}

/// How to spawn a debug adapter process (resolved against ExecTarget).
#[derive(Debug, Clone)]
pub struct AdapterSpawn {
    /// Adapter binary name or path.
    pub program: String,
    /// Command-line arguments for the adapter.
    pub args: Vec<String>,
    /// Stdio or TCP transport mode.
    pub transport: AdapterTransport,
}

/// Delve vs generic DAP configuration order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandshakeOrder {
    /// initialize → launch → initialized → breakpoints → configurationDone
    LaunchBeforeBreakpoints,
    /// initialize → initialized → breakpoints → configurationDone → launch
    BreakpointsBeforeLaunch,
    /// lldb-dap (LLVM 22+): launch 请求内启动进程并门控响应——必须 pipelined：
    /// launch 先发不等响应 → 收 `initialized` → setBreakpoints → configurationDone
    /// → launch 响应才返回（实测：顺序 await 会 timeout waiting for launch）。
    PipelinedLaunch,
}

/// 无头构建产物（IPC DTO；cargo 语义解析留前端纯函数，服务层只做执行 + 截断）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DebugBuildOutput {
    /// Process exit code (non-zero = build failed, short-circuit per C2).
    pub exit_code: i32,
    /// Piped stdout, truncated to the per-stream limit (clean pipe input for the
    /// artifact parser — never mixed with stderr).
    pub stdout: String,
    /// Piped stderr, truncated to the per-stream limit. go/cargo 的构建报错走此流
    /// （诊断展示用；前端 `pushBuildLogTail` 与 stdout 合并渲染，不参与产物解析）。
    pub stderr: String,
}

#[cfg(test)]
mod java_backend_tests {
    use super::*;

    /// 缺键 / 非法 / 空串一律 `auto`（配置契约：读取失败不阻断调试）。
    #[test]
    fn java_backend_defaults_to_auto() {
        for raw in [None, Some(""), Some("AUTO"), Some("jdtl"), Some("nope")] {
            assert_eq!(
                JavaDebugBackend::parse(raw),
                JavaDebugBackend::Auto,
                "{raw:?}"
            );
        }
        assert_eq!(
            JavaDebugBackend::parse(Some("jdtls")),
            JavaDebugBackend::Jdtls
        );
        assert_eq!(
            JavaDebugBackend::parse(Some("host")),
            JavaDebugBackend::Host
        );
    }

    /// 只有显式 `host` 才禁止 B'；`auto` 与 `jdtls` 都允许（差异只在前端 UX）。
    #[test]
    fn only_host_forbids_jdtls() {
        assert!(JavaDebugBackend::Auto.allows_jdtls());
        assert!(JavaDebugBackend::Jdtls.allows_jdtls());
        assert!(!JavaDebugBackend::Host.allows_jdtls());
        for b in [
            JavaDebugBackend::Auto,
            JavaDebugBackend::Jdtls,
            JavaDebugBackend::Host,
        ] {
            assert_eq!(
                JavaDebugBackend::parse(Some(b.as_str())),
                b,
                "字面量必须可回环"
            );
        }
    }

    /// IPC 契约：`JavaJdtlsTarget` 为 camelCase；`launcherJar` 缺省为 None。
    #[test]
    fn jdtls_target_deserializes_camel_case_with_defaults() {
        let target: JavaJdtlsTarget = serde_json::from_value(serde_json::json!({
            "probeClass": "com.example.CalcTest",
            "cwd": "/proj",
            "testName": "testAdd",
            "mainClass": "org.junit.platform.console.ConsoleLauncher"
        }))
        .expect("deserialize");
        assert_eq!(target.probe_class, "com.example.CalcTest");
        assert!(target.args.is_empty());
        assert!(target.launcher_jar.is_none());
        assert!(target.project_name.is_none());
    }

    /// 结果三态以 `kind` 为 tag（前端按 kind 分发）——断言统一的 `DebugStartOutcome`
    ///（`debug_java_start` 的 IPC 契约与旧 `JavaDebugStartOutcome` 同构）。
    #[test]
    fn start_outcome_is_tagged_by_kind() {
        use crate::dap::adapter::DebugStartOutcome;
        let warming = serde_json::to_value(DebugStartOutcome::Warming {
            detail: "import running".into(),
        })
        .expect("serialize");
        assert_eq!(warming["kind"], "warming");
        assert_eq!(warming["detail"], "import running");

        let unavailable = serde_json::to_value(DebugStartOutcome::Unavailable {
            message: "no bundle".into(),
            statically_detectable: true,
        })
        .expect("serialize");
        assert_eq!(unavailable["kind"], "unavailable");
        assert_eq!(unavailable["staticallyDetectable"], true);
        assert_eq!(unavailable["message"], "no bundle");
    }
}
