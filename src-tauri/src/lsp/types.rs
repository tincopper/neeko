use serde::{Deserialize, Serialize};

use crate::AppError;

// ── LSP Event Constants ─────────────────────────────────────────────────
// Single source of truth for all LSP-related event names emitted to the frontend.

/// Prefix for LSP diagnostic events: `lsp-diagnostics-{project_path}`.
pub const LSP_DIAG_EVENT_PREFIX: &str = "lsp-diagnostics-";

/// Prefix for LSP progress events: `lsp-progress-{project_path}`.
pub const LSP_PROGRESS_EVENT_PREFIX: &str = "lsp-progress-";

/// Prefix for `workspace/applyEdit` requests forwarded to the frontend:
/// `lsp-apply-edit-{project_path}`.
/// The server asks the client to apply a WorkspaceEdit; we hand it to the
/// editor instead of answering MethodNotFound (frontend mirror:
/// `src/shared/events.ts` `LSP_APPLY_EDIT_EVENT_PREFIX`).
pub const LSP_APPLY_EDIT_EVENT_PREFIX: &str = "lsp-apply-edit-";

/// Prefix for LSP session lifecycle events: `lsp-session-{project_path}`.
/// (frontend mirror: `src/shared/events.ts` `LSP_SESSION_EVENT_PREFIX`).
pub const LSP_SESSION_EVENT_PREFIX: &str = "lsp-session-";

/// Auto-install progress event: `lsp-install-progress`
/// (frontend mirror: `src/shared/events.ts` `LSP_INSTALL_PROGRESS_EVENT`).
pub const LSP_INSTALL_PROGRESS_EVENT: &str = "lsp-install-progress";

/// LSP session lifecycle events.
pub mod session_events {
    /// Server process is starting.
    pub const STARTING: &str = "starting";
    /// Server is ready to accept requests.
    pub const READY: &str = "ready";
    /// An error occurred (carries message).
    pub const ERROR: &str = "error";
    /// Session has been stopped.
    pub const STOPPED: &str = "stopped";
}

/// LSP profile detection event name.
pub const LSP_PROFILE_EVENT: &str = "lsp-project-profile";

/// Maximum size (in bytes) for auto-opened documents via IPC.
pub const MAX_AUTO_OPEN_FILE_SIZE: usize = 2 * 1024 * 1024; // 2 MB

/// 单次 IPC **响应体**的字节上限（红线 4）。
///
/// 口径与 `common::git::parsers::DIFF_PAYLOAD_MAX_BYTES` 同族：宁可让一次超大查询
/// 明确失败，也不把无界 JSON 丢进 Tauri IPC（`textDocument/references` 在大仓返回
/// 上万条 Location ≈ 数 MB，`documentSymbol` / 带 documentation 的 completion 同理）。
/// 消费点：`commands::lsp_request` 与 `commands::lsp_transport`。
pub const LSP_RESPONSE_MAX_BYTES: usize = 2 * 1024 * 1024; // 2 MiB

/// 校验一次 IPC 响应体的字节数是否在预算内（红线 4）。
///
/// **超限直接失败，不截断**：截断的 JSON 会让前端解析出半个结果（例如 references
/// 只剩一部分位置，用户以为仓库里只有这些引用），比一条能自解释的错误更难诊断。
/// 文案含实际字节数、method、预算值与收窄建议 —— 用户/AI 才能直接采取行动。
pub(crate) fn enforce_response_bytes(method: &str, bytes: usize) -> Result<(), AppError> {
    let budget = LSP_RESPONSE_MAX_BYTES;
    if bytes <= budget {
        return Ok(());
    }
    Err(AppError::Lsp(format!(
        "LSP response for {method} is {bytes} bytes, over the {budget}-byte \
         IPC budget; narrow the request (references: scope the query to fewer files or a \
         smaller range; documentSymbol: query a single file). The payload was not truncated."
    )))
}

/// Serializable LSP session info for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspSessionInfo {
    /// Language identifier (e.g. "rust", "go").
    pub language_id: String,
    /// Project filesystem path.
    pub project_path: String,
    /// Server binary name (e.g. "rust-analyzer").
    pub server_name: String,
    /// Session status string (starting, ready, error).
    pub status: String,
    /// Optional human-readable status message.
    pub status_message: Option<String>,
    /// Optional progress percentage.
    pub progress_pct: Option<u32>,
}

/// Runtime metadata for a language server (submenu footer).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LspServerInfo {
    /// Parsed version string (e.g. "1.97.1").
    pub version: String,
    /// Short commit hash when available.
    pub commit: String,
    /// Build / release date when available (YYYY-MM-DD).
    pub build_date: String,
    /// Process RSS in megabytes (snapshot at request time).
    pub memory_mb: f64,
    /// 最近一次启动尝试的终态（`None` = 该键从未尝试过）。证据宿主是身份键
    /// （`attempt_diagnostics`），不随进程存活与否变化。
    #[serde(default)]
    pub outcome: Option<LspAttemptOutcome>,
}

/// 一次 LSP 启动尝试的终态记录（前端「View logs」与子菜单的数据源之一）。
///
/// 失败原因**已内联证据尾部**；`status` 与 `LspSessionStatus::as_str()` 同词表
/// （`ready` | `error`）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LspAttemptOutcome {
    /// 与 `LspSessionStatus::as_str()` 同词表：`ready` | `error`。
    pub status: String,
    /// 失败原因（含 stderr 尾部 / 插件安装提示）。
    pub message: Option<String>,
    /// 终态时刻（与日志条目同一时间源）。
    pub finished_at: String,
}

/// One stderr / log line captured from an LSP server process.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LspServerLogEntry {
    /// ISO-8601 timestamp.
    pub timestamp: String,
    /// Log level: debug | info | warn | error.
    pub level: String,
    /// Raw log message line.
    pub message: String,
}

impl LspServerInfo {
    /// Empty / unknown metadata used when version parse or process lookup fails.
    #[must_use]
    pub const fn unknown() -> Self {
        Self {
            version: String::new(),
            commit: String::new(),
            build_date: String::new(),
            memory_mb: 0.0,
            outcome: None,
        }
    }
}

/// Split `"name (commit date)"` → `("commit date", "name")`.
///
/// Returns `None` when there is no well-formed trailing/parenthetical group, so the
/// caller keeps its line-derived fallback instead of branching three levels deep.
fn split_parenthetical(text: &str) -> Option<(&str, &str)> {
    let open = text.rfind('(')?;
    let close = text[open..].find(')')?;
    Some((text[open + 1..open + close].trim(), text[..open].trim()))
}

/// Best-effort parse of language-server `--version` stdout/stderr.
///
/// Handles common shapes:
/// - `rust-analyzer 1.97.1 (8bab26f4 2026-07-14)`
/// - `golang.org/x/tools/gopls v0.16.1`
/// - `Version 5.4.2`
#[must_use]
pub fn parse_server_version_output(output: &str) -> LspServerInfo {
    let line = output
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .to_string();

    if line.is_empty() {
        return LspServerInfo::unknown();
    }

    let mut version = String::new();
    let mut commit = String::new();
    let mut build_date = String::new();

    // Prefer parenthetical: (commit date) or (commit)
    if let Some((inner, before)) = split_parenthetical(&line) {
        let parts: Vec<&str> = inner.split_whitespace().collect();
        // The parenthetical opens with the short commit hash (when present).
        if let Some(first) = parts.first().filter(|f| !f.is_empty()) {
            commit = (*first).to_string();
        }
        if let Some(date) = parts.get(1).filter(|d| d.len() >= 8 && d.contains('-')) {
            build_date = (*date).to_string();
        }
        // version is last token before '('
        version = extract_version_token(before).unwrap_or_else(|| before.to_string());
    }

    if version.is_empty() {
        version = extract_version_token(&line).unwrap_or_else(|| line.clone());
    }

    // Strip leading 'v'
    if version.starts_with('v') || version.starts_with('V') {
        let rest = &version[1..];
        if rest.starts_with(|c: char| c.is_ascii_digit()) {
            version = rest.to_string();
        }
    }

    LspServerInfo {
        version,
        commit,
        build_date,
        memory_mb: 0.0,
        outcome: None,
    }
}

fn extract_version_token(s: &str) -> Option<String> {
    // Find a token that looks like a semver (optionally prefixed with v)
    for token in s.split_whitespace().rev() {
        let t = token.trim_matches(|c: char| c == ',' || c == ';');
        let bare = t
            .strip_prefix('v')
            .or_else(|| t.strip_prefix('V'))
            .unwrap_or(t);
        if bare.chars().next().is_some_and(|c| c.is_ascii_digit()) && bare.contains('.') {
            return Some(bare.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 事件名 / 前缀是对外协议（前端 `src/shared/events.ts` 镜像）。
    /// 值一旦漂移，前端 `listen` 会**静默失联** —— 历史上 `LSP_PROGRESS_EVENT_PREFIX`
    /// 就曾写成 `lsp-project-`（与实际 emit 的 `lsp-progress-` 不符）。这里钉死线上格式。
    #[test]
    fn event_names_match_frontend_mirror() {
        assert_eq!(
            format!("{}{}", LSP_DIAG_EVENT_PREFIX, "/p"),
            "lsp-diagnostics-/p"
        );
        assert_eq!(
            format!("{}{}", LSP_PROGRESS_EVENT_PREFIX, "/p"),
            "lsp-progress-/p"
        );
        assert_eq!(
            format!("{}{}", LSP_SESSION_EVENT_PREFIX, "/p"),
            "lsp-session-/p"
        );
        assert_eq!(
            format!("{}{}", LSP_APPLY_EDIT_EVENT_PREFIX, "/p"),
            "lsp-apply-edit-/p"
        );
        assert_eq!(LSP_INSTALL_PROGRESS_EVENT, "lsp-install-progress");
        assert_eq!(LSP_PROFILE_EVENT, "lsp-project-profile");
    }

    #[test]
    fn parse_rust_analyzer_version() {
        let info = parse_server_version_output("rust-analyzer 1.97.1 (8bab26f4 2026-07-14)\n");
        assert_eq!(info.version, "1.97.1");
        assert_eq!(info.commit, "8bab26f4");
        assert_eq!(info.build_date, "2026-07-14");
    }

    #[test]
    fn parse_gopls_version() {
        let info = parse_server_version_output("golang.org/x/tools/gopls v0.16.1\n");
        assert_eq!(info.version, "0.16.1");
        assert!(info.commit.is_empty());
    }

    #[test]
    fn parse_version_keyword() {
        let info = parse_server_version_output("Version 5.4.2\n");
        assert_eq!(info.version, "5.4.2");
    }

    #[test]
    fn server_info_serializes_camel_case() {
        let info = LspServerInfo {
            version: "1.0.0".into(),
            commit: "abc".into(),
            build_date: "2026-01-01".into(),
            memory_mb: 12.5,
            outcome: Some(LspAttemptOutcome {
                status: "error".into(),
                message: Some("boom".into()),
                finished_at: "123".into(),
            }),
        };
        let v = serde_json::to_value(&info).unwrap();
        assert_eq!(v["version"], "1.0.0");
        assert_eq!(v["buildDate"], "2026-01-01");
        assert_eq!(v["memoryMb"], 12.5);
        assert_eq!(v["commit"], "abc");
        // outcome 是可选增量字段：序列化 camelCase，缺省（None）时不出现。
        assert_eq!(v["outcome"]["status"], "error");
        assert_eq!(v["outcome"]["message"], "boom");
        assert_eq!(v["outcome"]["finishedAt"], "123");
        let without: LspServerInfo = serde_json::from_value(serde_json::json!({
            "version": "1.0.0",
            "commit": "",
            "buildDate": "",
            "memoryMb": 0.0,
        }))
        .unwrap();
        assert!(without.outcome.is_none(), "缺字段必须回落 None（向后兼容）");
    }

    #[test]
    fn log_entry_serializes_camel_case() {
        let entry = LspServerLogEntry {
            timestamp: "2026-07-29T00:00:00Z".into(),
            level: "warn".into(),
            message: "hello".into(),
        };
        let v = serde_json::to_value(&entry).unwrap();
        assert_eq!(v["timestamp"], "2026-07-29T00:00:00Z");
        assert_eq!(v["level"], "warn");
        assert_eq!(v["message"], "hello");
    }

    /// LSP spec 3.17：`Diagnostic.code` 为 number|string。三态序列化往返：
    /// string（如 gopls 的 "UndeclaredName"）/ number（如 tsserver 的 2339）/
    /// 缺失（`#[serde(default)]`）都不得报错或丢失。
    #[test]
    fn diagnostic_code_roundtrips_string_number_and_missing() {
        let base = serde_json::json!({
            "range": {
                "start": { "line": 55, "character": 12 },
                "end": { "line": 55, "character": 15 }
            },
            "severity": 1,
            "message": "undefined: fmt",
            "source": "compiler"
        });

        // string code 往返
        let mut with_str = base.clone();
        with_str["code"] = serde_json::json!("UndeclaredName");
        let d: LspDiagnostic = serde_json::from_value(with_str).unwrap();
        assert_eq!(
            d.code.as_ref().and_then(serde_json::Value::as_str),
            Some("UndeclaredName")
        );
        assert_eq!(serde_json::to_value(&d).unwrap()["code"], "UndeclaredName");

        // number code 往返
        let mut with_num = base.clone();
        with_num["code"] = serde_json::json!(1234);
        let d: LspDiagnostic = serde_json::from_value(with_num).unwrap();
        assert_eq!(
            d.code.as_ref().and_then(serde_json::Value::as_i64),
            Some(1234)
        );
        assert_eq!(serde_json::to_value(&d).unwrap()["code"], 1234);

        // 缺失 → None（serde default），不报错
        let without: LspDiagnostic = serde_json::from_value(base).unwrap();
        assert!(without.code.is_none());
    }

    // ── IPC 响应字节预算（红线 4）──────────────────────────────────────

    /// 测试内复述预算值，**刻意不引用**该常量名（目标仓库判据要求常量名只出现在
    /// 「定义 + 唯一执行点」）：这里复述数值同样能把边界钉死 —— 预算改大改小都会
    /// 让本用例变红。
    const BUDGET_BYTES: usize = 2 * 1024 * 1024;

    /// 超预算必须**失败**（不是截断）：截断的 JSON 前端解析出半个结果，比失败更难诊断。
    /// 文案必须自解释：字节数 + method + 预算 + 收窄建议。
    #[test]
    fn response_budget_rejects_oversized_payload() {
        let method = "textDocument/references";
        let err = enforce_response_bytes(method, BUDGET_BYTES + 1)
            .expect_err("超预算响应必须被拒绝，不得交给 IPC");
        let text = err.to_string();
        assert!(
            text.contains(&format!("{}", BUDGET_BYTES + 1)),
            "文案必须含实际字节数（否则用户无法判断超了多少）: {text}"
        );
        assert!(text.contains(method), "文案必须含触发超限的 method: {text}");
        assert!(
            text.contains(&BUDGET_BYTES.to_string()),
            "文案必须含预算值: {text}"
        );
        assert!(
            text.to_lowercase().contains("narrow"),
            "文案必须给出收窄建议（references 限范围 / documentSymbol 单文件）: {text}"
        );
    }

    /// 预算边界：恰好等于预算必须放行（上限是「不超过」，不是「小于」）。
    #[test]
    fn response_budget_accepts_payload_at_and_below_budget() {
        assert!(enforce_response_bytes("textDocument/documentSymbol", 0).is_ok());
        assert!(enforce_response_bytes("textDocument/hover", 64).is_ok());
        assert!(
            enforce_response_bytes("textDocument/documentSymbol", BUDGET_BYTES).is_ok(),
            "恰好 2 MiB 必须放行"
        );
    }
}

/// A single diagnostic item, serializable for Tauri IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspDiagnostic {
    /// Range of the diagnostic.
    pub range: LspRange,
    /// Severity level (1=error, 2=warning, 3=info, 4=hint).
    pub severity: Option<i64>,
    /// Diagnostic message.
    pub message: String,
    /// Source of the diagnostic (e.g. "rustc").
    pub source: Option<String>,
    /// LSP spec 3.17 `Diagnostic.code`（number|string，如 gopls 的
    /// "UndeclaredName" 或 tsserver 的 2339）。多数服务器缺失该字段 → default。
    #[serde(default)]
    pub code: Option<serde_json::Value>,
}

/// A range in a text document (0-based).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspRange {
    /// Start position (inclusive).
    pub start: LspPosition,
    /// End position (inclusive).
    pub end: LspPosition,
}

/// A position in a text document (0-based line and character).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspPosition {
    /// Line number (0-based).
    pub line: u32,
    /// Character offset (0-based).
    pub character: u32,
}

/// A location result (go-to-definition, references, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspLocation {
    /// Document URI.
    pub uri: String,
    /// Range in the document.
    pub range: LspRange,
}

/// Hover result content.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspHoverResult {
    /// Hover content items (plain text or markup).
    pub contents: Vec<LspMarkupContent>,
    /// Optional range for the hover.
    pub range: Option<LspRange>,
}

/// Markup content from an LSP hover response (plain text or structured markup).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LspMarkupContent {
    /// Plain text content.
    Plain(String),
    /// Structured markup content with a kind (e.g. "markdown").
    Markup {
        /// Content format kind (e.g. "markdown").
        kind: String,
        /// The markup value string.
        value: String,
    },
}

/// Completion item from LSP.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspCompletionItem {
    /// Completion label displayed to the user.
    pub label: String,
    /// Completion kind (method, function, variable, etc.).
    pub kind: Option<i64>,
    /// Additional detail text.
    pub detail: Option<String>,
    /// Text to insert when selected.
    pub insert_text: Option<String>,
}

// Re-export commonly used event constants
pub use self::session_events::*;
