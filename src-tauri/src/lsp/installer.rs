//! Auto-install language servers in a project [`ExecTarget`].

#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashSet;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::Emitter;

use crate::common::executor::factory::ExecTarget;
use crate::lsp::plugin::types::InstallOp;
use crate::lsp::plugin::LspPlugin;
use crate::lsp::process::run_command_streaming;
use crate::lsp::types::LSP_INSTALL_PROGRESS_EVENT;

/// Track in-progress installs to avoid concurrent attempts per language.
static INSTALL_IN_PROGRESS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));
#[derive(Debug, Clone, Serialize)]
struct LspInstallProgress {
    language_id: String,
    phase: String,
    message: String,
    /// 累计安装日志（stdout/stderr 行），前端可实时查看。
    log: String,
}

fn emit_progress(
    app_handle: &tauri::AppHandle,
    language_id: &str,
    phase: &str,
    message: &str,
    log: &str,
) {
    let payload = LspInstallProgress {
        language_id: language_id.to_string(),
        phase: phase.to_string(),
        message: message.to_string(),
        log: log.to_string(),
    };
    if let Err(e) = app_handle.emit(LSP_INSTALL_PROGRESS_EVENT, payload) {
        log::error!("[LSP] Failed to emit install progress: {}", e);
    }
}

/// 安装日志尾部保留上限（字节）。进度事件只携带尾部窗口：安装输出可能上万行，
/// 全量随每次事件传递会 O(n²) 拷贝并触碰单次 IPC 2MB 红线。
const INSTALL_LOG_TAIL_LIMIT: usize = 64 * 1024;

/// 进度事件节流间隔：`[stage]` 之外的工具输出可能逐行刷屏，逐行 emit 会灌爆 IPC。
const INSTALL_LOG_THROTTLE: Duration = Duration::from_millis(200);

/// 安装日志累加器：有界尾部缓冲 + 发射节流。作为安装日志的唯一来源，
/// `run_command_streaming` 不再自建第二份副本。
#[derive(Default)]
struct InstallLog {
    tail: String,
    last_emit: Option<Instant>,
}

impl InstallLog {
    /// 追加一行，并把缓冲裁剪到尾部窗口（切点回退到 UTF-8 字符边界）。
    fn push(&mut self, line: &str) {
        self.tail.push_str(line);
        self.tail.push('\n');
        if self.tail.len() > INSTALL_LOG_TAIL_LIMIT {
            let mut start = self.tail.len() - INSTALL_LOG_TAIL_LIMIT;
            while start < self.tail.len() && !self.tail.is_char_boundary(start) {
                start += 1;
            }
            self.tail.drain(..start);
        }
    }

    /// 是否到达下一次发射窗口（首行立即放行，其后按 [`INSTALL_LOG_THROTTLE`] 节流）。
    fn should_emit(&mut self) -> bool {
        let now = Instant::now();
        match self.last_emit {
            Some(prev) if now.duration_since(prev) < INSTALL_LOG_THROTTLE => false,
            _ => {
                self.last_emit = Some(now);
                true
            }
        }
    }

    fn snapshot(&self) -> &str {
        &self.tail
    }
}

/// Whether `binary` exists in the project execution environment.
#[must_use]
pub fn check_binary_installed(binary: &str, target: &ExecTarget) -> bool {
    let found = crate::core::exec::command_exists_blocking(target, binary);
    log::info!(
        "[LSP][installer] check binary={} target={:?} found={}",
        binary,
        std::mem::discriminant(target),
        found,
    );
    found
}

/// Check whether the plugin's language server binary exists on `target`.
#[must_use]
pub fn check_plugin_installed(plugin: &LspPlugin, target: &ExecTarget) -> bool {
    if plugin.server_binary.is_empty() {
        return false;
    }
    check_binary_installed(&plugin.server_binary, target)
}

/// Try to auto-install the plugin's server **in the project's environment**.
///
/// Returns `Ok(true)` if install ran successfully, `Ok(false)` if the plugin
/// has no install recipe, `Err` on failure.
pub fn install_plugin_server(
    plugin: &LspPlugin,
    app_handle: &tauri::AppHandle,
    target: &ExecTarget,
) -> Result<bool, String> {
    let language_id = plugin.language_id.as_str();
    {
        let mut in_progress = INSTALL_IN_PROGRESS.lock().map_err(|e| {
            log::warn!("[LSP] Install lock poisoned: {}", e);
            e.to_string()
        })?;
        if in_progress.contains(language_id) {
            log::info!("[LSP] Install already in progress for: {}", language_id);
            return Err("Install already in progress".to_string());
        }
        in_progress.insert(language_id.to_string());
    }

    let result = install_plugin_server_impl(plugin, app_handle, target);

    {
        let mut in_progress = INSTALL_IN_PROGRESS.lock().map_err(|e| {
            log::warn!("[LSP] Install lock poisoned: {}", e);
            e.to_string()
        })?;
        in_progress.remove(language_id);
    }

    result
}

fn install_plugin_server_impl(
    plugin: &LspPlugin,
    app_handle: &tauri::AppHandle,
    target: &ExecTarget,
) -> Result<bool, String> {
    let language_id = plugin.language_id.as_str();
    let bin = plugin.server_binary.as_str();
    if bin.is_empty() {
        return Ok(false);
    }

    let Some(install) = plugin.install.as_ref() else {
        return Ok(false);
    };

    // 依次尝试 [primary, fallback…]：操作不可用（工具不可解析，如 fnm/nvm 管理的
    // npm 不在 GUI 默认 PATH）或安装失败时，走到下一个。全部失败才报错（含各步原因）。
    let mut methods: Vec<InstallOp> = vec![install.primary];
    methods.extend_from_slice(install.fallbacks);

    let mut reasons: Vec<String> = Vec::new();
    let mut remaining: &[InstallOp] = &methods;
    while !remaining.is_empty() {
        // 下一个可用（探测目标可解析）的安装操作；之前的不可用操作记录原因后跳过。
        let Some(idx) = first_available_method(remaining, &|op| {
            check_binary_installed(op.probe_tool(), target)
        }) else {
            for op in remaining {
                reasons.push(format!(
                    "`{}` not found in the project environment",
                    op.describe()
                ));
            }
            break;
        };
        for op in &remaining[..idx] {
            reasons.push(format!(
                "`{}` not found in the project environment",
                op.describe()
            ));
        }
        let op = remaining[idx];
        remaining = &remaining[idx + 1..];
        // 展开为 (program, args)：Exec → `tool args…`；Script → `sh -c body`。
        let (program, args) = op.command();
        let method = op.describe();
        // 流式执行：日志行 → 有界尾部缓冲（节流 emit），message=当前 stage。
        let log = Arc::new(parking_lot::Mutex::new(InstallLog::default()));
        let on_line = {
            let app_handle = app_handle.clone();
            let language_id = language_id.to_string();
            let bin = bin.to_string();
            let method = method.to_string();
            let log = Arc::clone(&log);
            move |line: &str| {
                let mut log = log.lock();
                log.push(line);
                if !log.should_emit() {
                    return;
                }
                let message = match ProgressHint::parse(line) {
                    ProgressHint::Stage(stage) => format!("Installing {bin}: {stage}"),
                    ProgressHint::Output => format!("Installing {bin} (via {method})..."),
                };
                emit_progress(
                    &app_handle,
                    &language_id,
                    "installing",
                    &message,
                    log.snapshot(),
                );
            }
        };
        let code = run_command_streaming(target, program, &args, on_line)
            .map_err(|e| format!("Install command failed: {}", e))?;
        let log = log.lock().snapshot().to_string();
        if code == 0 {
            emit_progress(
                app_handle,
                language_id,
                "done",
                &format!("{} installed", bin),
                &log,
            );
            return Ok(true);
        }
        let tail = log.trim();
        reasons.push(format!(
            "`{method}` failed (exit {code}): {}",
            if tail.is_empty() { "no output" } else { tail }
        ));
        log::warn!("[LSP] install method {method} failed for {language_id}, trying fallback");
    }

    let detail = if reasons.is_empty() {
        "no install method available".to_string()
    } else {
        reasons.join("; ")
    };
    emit_progress(
        app_handle,
        language_id,
        "error",
        &format!("Install failed: {detail}"),
        &detail,
    );
    Err(format!("Install failed with code 1: {detail}"))
}

/// 顺序选择第一个可用的安装操作；`available(op)` 注入探测（由调用方取
/// [`InstallOp::probe_tool`]）。全不可用 → None。
fn first_available_method(
    methods: &[InstallOp],
    available: &impl Fn(InstallOp) -> bool,
) -> Option<usize> {
    methods.iter().position(|op| available(*op))
}

/// 安装输出行 → 结构化进度提示。
///
/// **协议唯一事实源**：安装脚本以 `[stage] <描述>` 上报阶段（见平台层的 jdtls
/// 下载脚本），其余行按普通输出处理。Rust 侧只在此处解释该前缀，不再散落
/// `strip_prefix` 魔法串。
enum ProgressHint {
    /// 阶段标记：进度 message 展示描述。
    Stage(String),
    /// 普通输出：只进日志。
    Output,
}

impl ProgressHint {
    /// 脚本阶段标记行前缀（脚本侧与解析侧共用的唯一事实源）。
    const STAGE_PREFIX: &'static str = "[stage]";

    /// 解析一行输出。
    fn parse(line: &str) -> Self {
        match line.trim_start().strip_prefix(Self::STAGE_PREFIX) {
            Some(rest) if !rest.trim().is_empty() => Self::Stage(rest.trim().to_string()),
            _ => Self::Output,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 顺序选择第一个可用操作；全不可用返回 None。`InstallOp` 的探测目标是其
    /// `probe_tool()`（Script 形态为 `sh`，不再靠 argv[0] 猜）。
    #[test]
    fn picks_first_available_method_in_order() {
        let methods: &[InstallOp] = &[
            InstallOp::exec("npm", &["install", "-g", "x"]),
            InstallOp::exec("brew", &["install", "x"]),
            InstallOp::script("echo hi"),
        ];
        // npm 不可用（fnm 管理的 npm 不在 GUI PATH）→ 跳到 brew
        let available = |op: InstallOp| op.probe_tool() != "npm";
        assert_eq!(
            first_available_method(methods, &available),
            Some(1),
            "npm 不可用时应回退到 brew"
        );
        // 全部可解析 → 首选
        assert_eq!(first_available_method(methods, &|_| true), Some(0));
        // 全部不可用 → None
        assert_eq!(first_available_method(methods, &|_| false), None);
        // Script 形态的探测目标是 sh（而非把它当成「名为 sh 的安装工具」）
        assert_eq!(methods[2].probe_tool(), "sh");
    }

    #[test]
    fn extracts_stage_markers_from_progress_hint() {
        match ProgressHint::parse("[stage] 下载 jdtls 1.61.0") {
            ProgressHint::Stage(s) => assert_eq!(s, "下载 jdtls 1.61.0"),
            ProgressHint::Output => panic!("应识别为 stage"),
        }
        match ProgressHint::parse("  [stage] 解压") {
            ProgressHint::Stage(s) => assert_eq!(s, "解压"),
            ProgressHint::Output => panic!("应识别为 stage"),
        }
    }

    /// 非 stage 行（含空前缀/纯工具输出）一律按普通输出处理，只进日志。
    #[test]
    fn non_stage_lines_are_plain_output() {
        for line in ["[stage]", "100% |##########| 42MB", "Downloading 100%", ""] {
            assert!(
                matches!(ProgressHint::parse(line), ProgressHint::Output),
                "{line:?} 应为普通输出"
            );
        }
    }

    /// 日志只保留尾部窗口：连续写入远超上限后总长不超上限（不再 O(n²) 增长）。
    #[test]
    fn install_log_keeps_bounded_tail() {
        let mut log = InstallLog::default();
        let line = "x".repeat(1024);
        for _ in 0..100 {
            log.push(&line);
        }
        assert!(
            log.snapshot().len() <= INSTALL_LOG_TAIL_LIMIT,
            "尾部缓冲必须被裁剪到上限内"
        );
        assert!(log.snapshot().ends_with("xxx\n"), "保留的是最新输出");
    }

    /// 截断切点回退到 UTF-8 字符边界：多字节行不得 panic / 撕裂字符。
    #[test]
    fn install_log_truncation_respects_char_boundary() {
        let mut log = InstallLog::default();
        let line = "é".repeat(600); // 1200 bytes / 行
        for _ in 0..80 {
            log.push(&line);
        }
        assert!(!log.snapshot().is_empty());
        assert!(log.snapshot().len() <= INSTALL_LOG_TAIL_LIMIT);
    }

    /// 节流：首行立即放行，节流窗口内的紧邻行被抑制（不逐行 emit）。
    #[test]
    fn install_log_throttles_burst_emits() {
        let mut log = InstallLog::default();
        assert!(log.should_emit(), "首行必须立即放行");
        log.last_emit = Some(Instant::now());
        assert!(!log.should_emit(), "节流窗口内的紧邻行必须被抑制");
    }
}
