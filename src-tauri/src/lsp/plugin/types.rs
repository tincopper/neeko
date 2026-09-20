//! Core plugin types and user-facing settings (no language table).

use serde::{Deserialize, Serialize};

/// When to spawn a language server process.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum LspAutoStart {
    /// Spawn only when a matching file is opened (default).
    #[default]
    OnFirstFile,
    /// Spawn when the project becomes active (if detected as primary / marker hit).
    OnProjectSelect,
    /// Never auto-spawn; user must start manually.
    Manual,
}

impl LspAutoStart {
    /// Parse an auto-start policy string.
    #[must_use]
    pub fn parse(s: &str) -> Self {
        match s {
            "onProjectSelect" | "on_project_select" => Self::OnProjectSelect,
            "manual" => Self::Manual,
            _ => Self::OnFirstFile,
        }
    }

    /// Get the string representation of the auto-start policy.
    #[allow(clippy::must_use_candidate)]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::OnFirstFile => "onFirstFile",
            Self::OnProjectSelect => "onProjectSelect",
            Self::Manual => "manual",
        }
    }
}

/// 一条安装命令的形态。
///
/// 取代此前的裸 argv 表示（`&'static [&'static str]`）：那种表示下「工具名」只能
/// 靠 `argv[0]` 猜、`sh -c <脚本>` 只能靠「首个元素恰好是 sh」的形状巧合被当作
/// 可探测的工具，也无法表达 URL / 解压等非 argv 形态的安装法。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallOp {
    /// 直接执行 `tool args…`；可用性判据 = `tool` 能否在目标环境解析。
    Exec {
        /// 可执行文件名（同时是可用性探测目标）。
        tool: &'static str,
        /// 传给 `tool` 的参数。
        args: &'static [&'static str],
    },
    /// 经 POSIX shell 执行脚本体；可用性判据 = `shell` 能否解析。
    /// 脚本自带 curl/tar 等依赖，不依赖环境 PATH 里的 npm/brew。
    Script {
        /// shell 可执行文件名（可用性探测目标，通常 `sh`）。
        shell: &'static str,
        /// 脚本正文（`[stage] <描述>` 行上报进度，见 `ProgressHint`）。
        body: &'static str,
    },
}

impl InstallOp {
    /// `tool args…` 形态。
    #[must_use]
    pub const fn exec(tool: &'static str, args: &'static [&'static str]) -> Self {
        Self::Exec { tool, args }
    }

    /// POSIX shell 脚本形态（探测 `sh`）。
    #[must_use]
    pub const fn script(body: &'static str) -> Self {
        Self::Script { shell: "sh", body }
    }

    /// 可用性探测目标（可执行文件名）。
    #[must_use]
    pub const fn probe_tool(self) -> &'static str {
        match self {
            Self::Exec { tool, .. } => tool,
            Self::Script { shell, .. } => shell,
        }
    }

    /// 错误信息里的人类可读标识。
    #[must_use]
    pub const fn describe(self) -> &'static str {
        match self {
            Self::Exec { tool, .. } => tool,
            Self::Script { .. } => "download script",
        }
    }

    /// 展开为 `(program, args)`（Script → `shell -c body`）。
    #[must_use]
    pub fn command(self) -> (&'static str, Vec<&'static str>) {
        match self {
            Self::Exec { tool, args } => (tool, args.to_vec()),
            Self::Script { shell, body } => (shell, vec!["-c", body]),
        }
    }
}

/// Installation recipe for an LSP server (typically built-in).
#[derive(Debug, Clone)]
pub struct LspInstallMethod {
    /// Human-readable prerequisite description (e.g. "Node.js >= 18").
    pub prerequisite: &'static str,
    /// 首选安装操作。
    pub primary: InstallOp,
    /// 回退链：首选工具不可解析或安装失败时按序尝试。
    /// 例：fnm/nvm 只管 shell-init PATH 时 npm 不可达 → brew / 官方下载兜底。
    pub fallbacks: &'static [InstallOp],
}

impl LspInstallMethod {
    /// Preferred-only recipe (empty fallback chain) —— 绝大多数插件的形态，
    /// 免去每个 builtin 手写空回退。
    #[must_use]
    pub const fn new(prerequisite: &'static str, primary: InstallOp) -> Self {
        Self {
            prerequisite,
            primary,
            fallbacks: &[],
        }
    }

    /// 附加有序回退链（首选方法之后依次尝试）。
    #[must_use]
    pub const fn with_fallbacks(mut self, fallbacks: &'static [InstallOp]) -> Self {
        self.fallbacks = fallbacks;
        self
    }
}

/// 服务器特有的会话调优（builtin 自带；通用插件用 `Default`）。
///
/// 收编此前散在两处的 jdtls 特判 —— `version_probe` bool 与 session 层的
/// `language_id == "java"`。两种知识都挂到插件自身，session 层只读数据、不再按
/// 语言名分支：第二个 Java 系服务器只需声明同一 tuning，无需改 session。
#[derive(Debug, Clone, Copy)]
pub struct LspServerTuning {
    /// 创建会话前是否探测 `<server> --version` 取版本元数据。
    ///
    /// 某些服务器的 `--version` 会启动重量级运行时（如 jdtls 的完整 OSGi JVM），
    /// 且并发探测会在 workspace 锁上互挂 → 这类服务器声明 `false`（版本降级为
    /// unknown），避免 `--version` 阻塞会话创建。
    pub version_probe: bool,
    /// 是否从项目环境 PATH 的 `java` 解析并注入 `JAVA_HOME`
    /// （对齐 VSCode `java.jdt.ls.java.home` 的 "Tooling JDK" 语义：服务器启动器
    /// 默认可能取最新版 JDK，超出其支持范围会导致 JDK 源码映射失效）。
    pub java_home_from_path: bool,
}

impl Default for LspServerTuning {
    /// 通用默认：探测版本、不注入 `JAVA_HOME`。
    fn default() -> Self {
        Self {
            version_probe: true,
            java_home_from_path: false,
        }
    }
}

/// 会话根的解析范围。
///
/// 第一性原理：**是否按文档定根、按哪些 marker 定根**是"语言服务器怎么找自己的
/// 工程"的特性，不是会话编排的知识。放进插件数据后，`session::root` 才能保持语言
/// 无关（新增语言只加数据、不改代码 —— 与 `tuning` 同构）。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum RootScope {
    /// 会话根 = 项目根（默认）。服务器按自己的 markers 找工程。
    #[default]
    ProjectScoped,
    /// 会话根 = 从打开文档向上找到的、含任一 `markers` 的**最近**目录（VS Code 语义）。
    ///
    /// 自带 markers 而**不复用** `root_markers`：后者回答"这个项目用什么语言"
    /// （`typescript` 插件只认 `tsconfig.json`），这里回答"TS/JS 工程根在哪" ——
    /// `typescript-language-server` 需要含 `package.json` 的目录才能解析到
    /// `node_modules/typescript`。复用会让没有 tsconfig 的子包被误判回项目根。
    DocumentScoped {
        /// 向上寻找的工程根 marker（任一存在即认定为根）。
        markers: Vec<String>,
    },
}

impl RootScope {
    /// 便捷构造：`DocumentScoped` 自带 markers。
    #[must_use]
    pub fn document_scoped(markers: &[&str]) -> Self {
        Self::DocumentScoped {
            markers: markers.iter().map(|m| (*m).to_string()).collect(),
        }
    }

    /// 文档定根时要向上寻找的 marker；`None` = 始终使用项目根。
    #[must_use]
    pub fn walk_markers(&self) -> Option<&[String]> {
        match self {
            Self::ProjectScoped => None,
            Self::DocumentScoped { markers } => Some(markers),
        }
    }
}

/// Descriptor for a language server plugin (built-in or custom).
///
/// Built-ins are produced by modules under [`super::builtins`]; customs via
/// [`LspPlugin::from_custom`]. The registry never hard-codes languages itself.
#[derive(Debug, Clone)]
pub struct LspPlugin {
    /// Language identifier (e.g. "rust", "go", "typescript").
    pub language_id: String,
    /// File extensions this server handles (e.g. ["rs"]).
    pub extensions: Vec<String>,
    /// Server binary name (e.g. "rust-analyzer").
    pub server_binary: String,
    /// Full server command vector (binary + args).
    pub server_command: Vec<String>,
    /// Optional install recipe if the server may be missing.
    pub install: Option<LspInstallMethod>,
    /// Root marker files for project profile detection (e.g. `Cargo.toml`).
    pub root_markers: Vec<String>,
    /// Lower = preferred when multiple languages are detected (primary selection).
    pub detect_priority: u32,
    /// When to auto-spawn the language server.
    pub auto_start: LspAutoStart,
    /// Whether this plugin comes from a user custom config.
    pub is_custom: bool,
    /// Optional `InitializeParams.initializationOptions` for the server.
    pub initialization_options: Option<serde_json::Value>,
    /// 运行时 `initializationOptions` 提供者（会话创建时求值，**覆盖**上面的静态值）。
    ///
    /// 用于载荷必须在会话创建那一刻才确定的服务器 —— 典型是 jdtls 的 `bundles`：
    /// 它必须指向**真实存在**的绝对路径，而该文件可能由 Neeko 在用户首次调试 Java 时
    /// 才下载。用 `fn` 指针（无捕获、`Send + Sync`）即可满足，无需闭包或多态。
    ///
    /// 说明：`bundles` 只在 jdtls `initialize` 时读取，因此"下载后重启会话"这一
    /// 缓解手段**只有**在载荷每次会话重新求值时才成立 —— 这正是本字段存在的理由。
    pub initialization_options_provider: Option<fn() -> serde_json::Value>,
    /// Optional `InitializeParams.initializationOptions.extendedClientCapabilities`
    /// (vendor-specific, e.g. jdtls `classFileContentsSupport`). `None` for
    /// all languages except those whose server gates features on it.
    pub extended_client_capabilities: Option<serde_json::Value>,
    /// Optional extra `InitializeParams.capabilities`（服务端专属客户端能力）。
    ///
    /// 与 `extended_client_capabilities` 的区别：后者喂 jdtls 的
    /// `initializationOptions.extendedClientCapabilities`（JDT 只读那里），本字段合并进
    /// **`capabilities` 顶层** —— rust-analyzer 的 `experimental.runnables` 只有客户端在
    /// `capabilities.experimental.runnables.kinds` 声明之后才应答（实测 1.97.1：声明前
    /// 该方法无结果）。`None`（默认）时 initialize 载荷与既有完全一致，因此不影响
    /// gopls / jdtls / 其它语言。
    pub client_capabilities: Option<serde_json::Value>,
    /// 服务器特有的会话调优（探测策略 / 环境注入）。通用插件保持 `Default`；
    /// 仅声明与默认不同的行为，session 层据此决策而不按语言名分支。
    pub tuning: LspServerTuning,
    /// 会话根解析范围（默认 `ProjectScoped` = 项目根；自定义 LSP 行为零变化）。
    /// session 层据此决策，不按语言名分支。
    pub root_scope: RootScope,
    /// 检测压制标记：这些文件**同时存在**时本插件不参与候选（更特定的同族语言接管）。
    ///
    /// 例：`javascript` 被 `tsconfig.json` 压制 —— package.json + tsconfig 说明该
    /// 工程是 TS。**不含 `jsconfig.json`**：它是 JS 工程配置，压制 javascript 是
    /// 语义错误（单测 `jsconfig_does_not_suppress_javascript` 钉住）。
    pub detect_suppressed_by: Vec<String>,
}

impl LspPlugin {
    /// Construct a built-in language descriptor (used by `builtins/*` modules).
    #[must_use]
    pub fn builtin(
        language_id: &str,
        extensions: &[&str],
        server_binary: &str,
        server_command: &[&str],
        install: Option<LspInstallMethod>,
    ) -> Self {
        Self {
            language_id: language_id.to_string(),
            extensions: extensions.iter().map(|s| (*s).to_string()).collect(),
            server_binary: server_binary.to_string(),
            server_command: server_command.iter().map(|s| (*s).to_string()).collect(),
            install,
            root_markers: Vec::new(),
            detect_priority: 100,
            auto_start: LspAutoStart::OnFirstFile,
            is_custom: false,
            initialization_options: None,
            initialization_options_provider: None,
            extended_client_capabilities: None,
            client_capabilities: None,
            tuning: LspServerTuning::default(),
            root_scope: RootScope::default(),
            detect_suppressed_by: Vec::new(),
        }
    }

    /// 声明会话根解析范围（默认项目根）。
    #[must_use]
    pub fn with_root_scope(mut self, scope: RootScope) -> Self {
        self.root_scope = scope;
        self
    }

    /// 声明检测压制标记（见 [`LspPlugin::detect_suppressed_by`]）。
    #[must_use]
    pub fn with_detect_suppressed_by(mut self, markers: &[&str]) -> Self {
        self.detect_suppressed_by = markers.iter().map(|s| (*s).to_string()).collect();
        self
    }

    /// Set root marker files for project detection.
    #[must_use]
    pub fn with_root_markers(mut self, markers: &[&str]) -> Self {
        self.root_markers = markers.iter().map(|s| (*s).to_string()).collect();
        self
    }

    /// Set detection priority (lower wins).
    #[must_use]
    pub const fn with_detect_priority(mut self, priority: u32) -> Self {
        self.detect_priority = priority;
        self
    }

    /// Set the auto-start policy.
    #[must_use]
    pub const fn with_auto_start(mut self, auto_start: LspAutoStart) -> Self {
        self.auto_start = auto_start;
        self
    }

    /// Override the server-specific session tuning (probe policy / env injection).
    #[must_use]
    pub const fn with_tuning(mut self, tuning: LspServerTuning) -> Self {
        self.tuning = tuning;
        self
    }

    /// Set LSP initialization options.
    #[must_use]
    pub fn with_initialization_options(mut self, opts: serde_json::Value) -> Self {
        self.initialization_options = Some(opts);
        self
    }

    /// 设置**运行时** `initializationOptions` 提供者（每次会话创建时求值）。
    #[must_use]
    pub const fn with_initialization_options_provider(
        mut self,
        provider: fn() -> serde_json::Value,
    ) -> Self {
        self.initialization_options_provider = Some(provider);
        self
    }

    /// Set vendor-specific extended client capabilities.
    #[must_use]
    pub fn with_extended_client_capabilities(mut self, caps: serde_json::Value) -> Self {
        self.extended_client_capabilities = Some(caps);
        self
    }

    /// Set extra top-level `capabilities` for this server (merged over the base set).
    #[must_use]
    pub fn with_client_capabilities(mut self, caps: serde_json::Value) -> Self {
        self.client_capabilities = Some(caps);
        self
    }

    /// Build a plugin from a user-defined custom server config.
    pub fn from_custom(cfg: &CustomLspServerConfig) -> Self {
        let binary = cfg
            .command
            .first()
            .cloned()
            .unwrap_or_else(|| cfg.language_id.clone());
        let exts: Vec<String> = cfg
            .file_extensions
            .iter()
            .map(|e| e.trim_start_matches('.').to_lowercase())
            .filter(|e| !e.is_empty())
            .collect();
        Self {
            language_id: cfg.language_id.clone(),
            extensions: exts,
            server_binary: binary,
            server_command: cfg.command.clone(),
            install: None,
            root_markers: cfg.root_markers.clone(),
            // Customs rank after built-ins for primary selection unless markers-only.
            detect_priority: 200,
            auto_start: cfg
                .auto_start
                .as_deref()
                .map(LspAutoStart::parse)
                .unwrap_or(LspAutoStart::OnFirstFile),
            is_custom: true,
            initialization_options: cfg.initialization_options.clone(),
            initialization_options_provider: None,
            extended_client_capabilities: None,
            client_capabilities: None,
            tuning: LspServerTuning::default(),
            root_scope: RootScope::default(),
            detect_suppressed_by: Vec::new(),
        }
    }
}

/// User-defined language server (stored in config.json under `lsp.customServers`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomLspServerConfig {
    /// Unique identifier for this custom server config.
    pub id: String,
    /// Language identifier (e.g. "proto").
    pub language_id: String,
    /// Optional human-readable display name for the UI.
    #[serde(default)]
    pub display_name: Option<String>,
    /// argv, e.g. ["foo-lsp", "--stdio"]
    pub command: Vec<String>,
    /// File extensions without leading dots, e.g. ["proto", "foo"].
    #[serde(default, rename = "file_extensions", alias = "fileExtensions")]
    pub file_extensions: Vec<String>,
    /// Root marker files for project detection (e.g. ["buf.yaml"]).
    #[serde(default)]
    pub root_markers: Vec<String>,
    /// "onFirstFile" | "onProjectSelect" | "manual"
    #[serde(default)]
    pub auto_start: Option<String>,
    /// Passed as LSP `InitializeParams.initializationOptions`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initialization_options: Option<serde_json::Value>,
}

/// An extension claimed by more than one language server (later registration wins).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspExtensionConflict {
    /// File extension that caused the conflict.
    pub extension: String,
    /// Language that won the conflict (last registration wins).
    pub winner_language_id: String,
    /// Languages displaced by the winner.
    pub displaced_language_ids: Vec<String>,
}

/// Global LSP settings stored in config.json under `lsp`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspSettings {
    /// Auto-start policy string ("onFirstFile", "onProjectSelect", "manual").
    #[serde(default = "default_auto_start")]
    pub auto_start: String,
    /// Minutes of inactivity before auto-stopping a server.
    #[serde(default = "default_deactivate_minutes")]
    pub deactivate_stop_minutes: u64,
    /// User-defined custom LSP server configurations.
    #[serde(default)]
    pub custom_servers: Vec<CustomLspServerConfig>,
    /// M4 导入策略三态（R4/AC4）：补全接受时是否自动应用附加编辑
    /// ("auto" | "ask" | "never")。纯前端策略，后端只做持久化透传，
    /// 缺字段回落 `auto`（老 config.json 向后兼容）。
    #[serde(default = "default_import_strategy")]
    pub import_strategy: String,
}

fn default_auto_start() -> String {
    "onFirstFile".into()
}

fn default_import_strategy() -> String {
    "auto".into()
}

const fn default_deactivate_minutes() -> u64 {
    30
}

impl Default for LspSettings {
    fn default() -> Self {
        Self {
            auto_start: default_auto_start(),
            deactivate_stop_minutes: default_deactivate_minutes(),
            custom_servers: Vec::new(),
            import_strategy: default_import_strategy(),
        }
    }
}

/// Extension → languageId map entry for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LspExtensionMapEntry {
    /// File extension (without leading dot).
    pub extension: String,
    /// Language identifier mapped to this extension.
    pub language_id: String,
    /// Server binary name for this entry.
    pub server_name: String,
    /// Whether this mapping comes from a custom server config.
    pub is_custom: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_method_new_has_empty_fallback_chain() {
        let m = LspInstallMethod::new("npm", InstallOp::exec("npm", &["install", "-g", "x"]));
        assert_eq!(m.prerequisite, "npm");
        assert_eq!(m.primary.probe_tool(), "npm");
        assert_eq!(m.primary.command().1, vec!["install", "-g", "x"]);
        assert!(m.fallbacks.is_empty(), "默认无回退链");
    }

    #[test]
    fn install_method_with_fallbacks_attaches_chain_in_order() {
        const CHAIN: &[InstallOp] = &[
            InstallOp::exec("brew", &["install", "x"]),
            InstallOp::script("echo hi"),
        ];
        let m = LspInstallMethod::new("npm", InstallOp::exec("npm", &["i"])).with_fallbacks(CHAIN);
        assert_eq!(m.fallbacks, CHAIN);
    }

    /// `Exec` / `Script` 两种形态的探测目标与展开命令（脚本走 `sh -c body`，
    /// 不再依赖「argv[0] 恰好是 sh」的形状巧合）。
    #[test]
    fn install_op_expands_to_program_and_args() {
        let exec = InstallOp::exec("npm", &["install", "-g", "x"]);
        assert_eq!(exec.probe_tool(), "npm");
        assert_eq!(exec.command(), ("npm", vec!["install", "-g", "x"]));
        assert_eq!(exec.describe(), "npm");

        let script = InstallOp::script(
            "echo one
echo two",
        );
        assert_eq!(script.probe_tool(), "sh");
        assert_eq!(
            script.command(),
            (
                "sh",
                vec![
                    "-c",
                    "echo one
echo two"
                ]
            )
        );
        assert_eq!(script.describe(), "download script");
    }

    /// 通用默认调优：探测版本、不注入 JAVA_HOME —— 未声明 tuning 的插件不受
    /// jdtls 特判影响。
    #[test]
    fn default_tuning_probes_version_without_java_home() {
        let t = LspServerTuning::default();
        assert!(t.version_probe);
        assert!(!t.java_home_from_path);
    }

    #[test]
    fn builtin_plugin_uses_default_tuning() {
        let p = LspPlugin::builtin("go", &["go"], "gopls", &["gopls"], None);
        assert!(p.tuning.version_probe);
        assert!(!p.tuning.java_home_from_path);
        assert!(!p.is_custom);
    }

    #[test]
    fn with_tuning_overrides_only_declared_behaviours() {
        let p = LspPlugin::builtin("java", &["java"], "jdtls", &["jdtls"], None).with_tuning(
            LspServerTuning {
                version_probe: false,
                java_home_from_path: true,
            },
        );
        assert!(!p.tuning.version_probe);
        assert!(p.tuning.java_home_from_path);
    }

    /// M4：老 config.json 的 `lsp` 块缺 `importStrategy` → 回落 `auto`
    ///（前端纯策略，后端只做持久化透传；`#[serde(default)]` 语义）。
    #[test]
    fn lsp_settings_missing_import_strategy_falls_back_to_auto() {
        let s: LspSettings = serde_json::from_value(serde_json::json!({
            "autoStart": "onFirstFile",
            "deactivateStopMinutes": 30,
            "customServers": []
        }))
        .expect("parse");
        assert_eq!(s.import_strategy, "auto");
    }

    /// M4：`importStrategy` roundtrip（透传不丢；非法值不由后端校验）。
    #[test]
    fn lsp_settings_import_strategy_roundtrip() {
        let s: LspSettings = serde_json::from_value(serde_json::json!({
            "autoStart": "onFirstFile",
            "deactivateStopMinutes": 30,
            "customServers": [],
            "importStrategy": "never"
        }))
        .expect("parse");
        assert_eq!(s.import_strategy, "never");
        let back = serde_json::to_value(&s).expect("serialize");
        assert_eq!(
            back.get("importStrategy").and_then(|v| v.as_str()),
            Some("never")
        );
    }
}
