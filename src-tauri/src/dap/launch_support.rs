//! DAP 启动期共享支持：构建目录校验、Windows 命令转引、shell argv 构造。
//!
//! 这些是 `commands`（IPC 控制层）与 `manager`（领域编排层）共用的纯逻辑。
//! 独立成模块后两者都依赖本模块，而不是让 `manager`（编排）反向依赖
//! `commands`（控制层）—— 符合依赖倒置：高层编排不依赖控制层。

use std::future::Future;

use crate::common::executor::factory::ExecTarget;
use crate::AppError;

/// Validate the build working directory against the **execution unit root**:
/// Local → canonicalize + containment in the unit root (blocking FS isolated via
/// spawn_blocking); remote → lexical NUL rejection only.
///
/// `unit_root` 是调用方经 `project_context::ExecUnit::root` 得到的**单元根**
/// （主仓 = 项目根；linked worktree = worktree 根）。传入项目根会让默认路径
/// `~/.neeko/worktrees/<name>` 下的调试构建被误拒 —— 那不是「越界」，是基准选错。
pub(crate) async fn resolve_build_dir(
    target: &ExecTarget,
    unit_root: &str,
    cwd: &str,
) -> Result<String, AppError> {
    match target {
        ExecTarget::Local => {
            let root = unit_root.to_string();
            let cwd = cwd.to_string();
            tokio::task::spawn_blocking(move || {
                let canonical_root = std::path::Path::new(&root).canonicalize().map_err(|e| {
                    AppError::InvalidInput(format!("invalid unit root `{root}`: {e}"))
                })?;
                let canonical = std::path::Path::new(&cwd).canonicalize().map_err(|_| {
                    AppError::InvalidInput(format!("build cwd not found or inaccessible: {cwd}"))
                })?;
                if !canonical.starts_with(&canonical_root) {
                    return Err(AppError::InvalidInput(
                        "build cwd is outside the execution unit root".into(),
                    ));
                }
                Ok(canonical.to_string_lossy().to_string())
            })
            .await
            .map_err(|e| AppError::Io(e.to_string()))?
        }
        _ => {
            if cwd.contains('\0') {
                return Err(AppError::InvalidInput("build cwd contains NUL".into()));
            }
            Ok(cwd.to_string())
        }
    }
}

/// Rewrite POSIX single-quoted args (`'arg'`) into cmd double quotes (`"arg"`)
/// for a command string destined for Windows `cmd /C` — cmd treats single
/// quotes as literal characters, so the frontend's `cargo test 'name'` shape
/// would otherwise pass `'name'` as part of the test filter. Only the safe
/// identifier shape is rewritten: quoted args with no embedded `"` / `\`
/// (Rust test-name identifiers / relative manifest paths). Args containing
/// `"` / `\` and unterminated quotes are left verbatim.
pub(crate) fn windows_cmd_quote(cmd: &str) -> String {
    let mut out = String::with_capacity(cmd.len());
    let mut rest = cmd;
    loop {
        let Some(open) = rest.find('\'') else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..open]);
        let body = &rest[open + 1..];
        let Some(close) = body.find('\'') else {
            // Unterminated quote: keep the rest verbatim.
            out.push('\'');
            out.push_str(body);
            break;
        };
        let inner = &body[..close];
        if inner.contains(['"', '\\']) {
            // Not the safe identifier shape — keep the single quotes literal.
            out.push('\'');
            out.push_str(inner);
            out.push('\'');
        } else {
            out.push('"');
            out.push_str(inner);
            out.push('"');
        }
        rest = &body[close + 1..];
    }
    out
}

/// 泵附属 debuggee 的输出（Debug Console）直到通道关闭，随后执行 `on_exit` 收尾。
///
/// **为什么"关闭后收尾"也在这里**：通道关闭（stdout/stderr 双 EOF）是"被调试进程已退出"
/// 的唯一信号（sender 持有关系见调用方，如 `JavaDebuggee::launch`）。把泵与收尾放在同一个
/// 单元，这条不变式（**关闭 ⇒ 收尾恰好一次，且在所有输出之后**）就能脱离真实会话被单测。
///
/// `emit_line` 是**同步**回调：`DapSession::emit_output` 本身没有异步工作（见 `emit_event`
/// 的说明），收尾才需要异步（`on_exit` 返回 future，由本函数 `await`）。
pub(crate) async fn pump_output<F, Fe, Fut>(
    mut output_rx: tokio::sync::mpsc::Receiver<(String, String)>,
    mut emit_line: F,
    on_exit: Fe,
) where
    F: FnMut(&str, &str),
    Fe: FnOnce() -> Fut,
    Fut: Future<Output = ()>,
{
    while let Some((category, line)) = output_rx.recv().await {
        emit_line(&category, &line);
    }
    on_exit().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_cmd_quote_rewrites_posix_quotes_to_cmd_quotes() {
        assert_eq!(
            windows_cmd_quote("cargo test 'parse_simple' --manifest-path 'src-tauri/Cargo.toml'"),
            "cargo test \"parse_simple\" --manifest-path \"src-tauri/Cargo.toml\""
        );
    }

    #[test]
    fn windows_cmd_quote_leaves_unquoted_command_verbatim() {
        let cmd = "cargo test --no-run --message-format=json";
        assert_eq!(windows_cmd_quote(cmd), cmd);
    }

    #[test]
    fn windows_cmd_quote_handles_quoted_args_at_start_and_end() {
        assert_eq!(windows_cmd_quote("'first' cargo"), "\"first\" cargo");
        assert_eq!(windows_cmd_quote("cargo 'last'"), "cargo \"last\"");
    }

    #[test]
    fn windows_cmd_quote_leaves_unsafe_or_unterminated_quotes_verbatim() {
        // 参数内含双引号（非 Rust 标识符形态）→ 保留单引号，不猜语义。
        let embedded = "cargo test 'a\"b'";
        assert_eq!(windows_cmd_quote(embedded), embedded);
        // 未闭合单引号 → 原样保留。
        let unterminated = "cargo test 'unterminated";
        assert_eq!(windows_cmd_quote(unterminated), unterminated);
    }

    #[test]
    fn windows_cmd_quote_output_has_no_literal_single_quotes() {
        // 转引后命令不再含字面单引号：`cmd /C` 下可解析（标识符参数安全域）。
        let rewritten =
            windows_cmd_quote("cargo test 'parse_simple' --manifest-path 'src-tauri/Cargo.toml'");
        assert!(!rewritten.contains('\''));
    }

    /// 泵的输出先排空、随后收尾**恰好一次**（通道关闭 ⟺ 被调试进程退出）。
    #[tokio::test]
    async fn pump_output_forwards_all_lines_then_signals_exit_once() {
        use std::sync::Arc;

        let (tx, rx) = tokio::sync::mpsc::channel(16);
        tx.try_send(("stdout".to_string(), "one".to_string()))
            .expect("send");
        tx.try_send(("stderr".to_string(), "two".to_string()))
            .expect("send");
        drop(tx); // 通道关闭 = 被调试进程已退出

        // 同步锁（std）：`emit_line` / `on_exit` 都是同步回调，用 tokio Mutex 反而要 await。
        let log: Arc<std::sync::Mutex<Vec<String>>> = Arc::new(std::sync::Mutex::new(Vec::new()));
        let lines = Arc::clone(&log);
        let exits = Arc::clone(&log);
        pump_output(
            rx,
            move |category, line| {
                if let Ok(mut guard) = lines.lock() {
                    guard.push(format!("line:{category}:{line}"));
                }
            },
            move || async move {
                if let Ok(mut guard) = exits.lock() {
                    guard.push("exit".to_string());
                }
            },
        )
        .await;

        let recorded = log.lock().expect("log").clone();
        assert_eq!(
            recorded,
            vec![
                "line:stdout:one".to_string(),
                "line:stderr:two".to_string(),
                "exit".to_string(),
            ],
            "必须先排空输出、再恰好收尾一次"
        );
    }

    // ── `resolve_build_dir`：基准是**执行单元根**，不是项目根 ──────────────────────

    /// worktree 根在项目根**之外**（默认 `~/.neeko/worktrees/<name>`）时，
    /// 以单元根为基准的校验必须放行 —— 这是本任务修复的核心症状（S1）。
    #[tokio::test]
    async fn resolve_build_dir_accepts_cwd_inside_unit_root_outside_project_root() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let project_root = tmp.path().join("proj");
        let worktree_root = tmp.path().join("worktrees").join("fix-1");
        let module_dir = worktree_root.join("module-a");
        std::fs::create_dir_all(&project_root).expect("project dir");
        std::fs::create_dir_all(&module_dir).expect("module dir");
        let worktree_root = worktree_root.to_string_lossy().to_string();

        let dir = resolve_build_dir(
            &ExecTarget::Local,
            &worktree_root,
            &module_dir.to_string_lossy(),
        )
        .await
        .expect("cwd inside unit root must be accepted");
        assert_eq!(dir, module_dir.canonicalize().unwrap().to_string_lossy());
    }

    /// 越出单元根仍必须拒绝（fail-closed）；错误文案不得再声称项目根。
    #[tokio::test]
    async fn resolve_build_dir_rejects_cwd_outside_unit_root() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let worktree_root = tmp.path().join("worktrees").join("fix-1");
        let outside = tmp.path().join("elsewhere");
        std::fs::create_dir_all(&worktree_root).expect("worktree dir");
        std::fs::create_dir_all(&outside).expect("outside dir");

        let err = resolve_build_dir(
            &ExecTarget::Local,
            &worktree_root.to_string_lossy(),
            &outside.to_string_lossy(),
        )
        .await
        .expect_err("cwd outside unit root must be rejected");
        assert!(
            err.to_string().contains("execution unit root"),
            "expected unit-root error, got: {err}"
        );
    }

    /// 远端（WSL/SSH）不做 canonicalize，仅做词法 NUL 拒绝 —— 语义不变。
    #[tokio::test]
    async fn resolve_build_dir_remote_only_rejects_nul() {
        let target = ExecTarget::Wsl {
            distro: "Ubuntu".into(),
        };
        assert_eq!(
            resolve_build_dir(&target, "/home/u/wt", "/home/u/wt/mod")
                .await
                .expect("remote passthrough"),
            "/home/u/wt/mod"
        );
        assert!(resolve_build_dir(&target, "/home/u/wt", "bad\0path")
            .await
            .is_err());
    }
}
