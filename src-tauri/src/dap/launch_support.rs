//! DAP 启动期共享支持：构建目录校验、Windows 命令转引、shell argv 构造。
//!
//! 这些是 `commands`（IPC 控制层）与 `manager`（领域编排层）共用的纯逻辑。
//! 独立成模块后两者都依赖本模块，而不是让 `manager`（编排）反向依赖
//! `commands`（控制层）—— 符合依赖倒置：高层编排不依赖控制层。

use crate::common::executor::factory::ExecTarget;
use crate::AppError;

/// Validate the build working directory: Local → canonicalize + containment in
/// the project root (blocking FS call isolated via spawn_blocking); remote →
/// lexical NUL rejection only.
pub(crate) async fn resolve_build_dir(
    target: &ExecTarget,
    project_root: &str,
    cwd: &str,
) -> Result<String, AppError> {
    match target {
        ExecTarget::Local => {
            let root = project_root.to_string();
            let cwd = cwd.to_string();
            tokio::task::spawn_blocking(move || {
                let canonical_root = std::path::Path::new(&root).canonicalize().map_err(|e| {
                    AppError::InvalidInput(format!("invalid project root `{root}`: {e}"))
                })?;
                let canonical = std::path::Path::new(&cwd).canonicalize().map_err(|_| {
                    AppError::InvalidInput(format!("build cwd not found or inaccessible: {cwd}"))
                })?;
                if !canonical.starts_with(&canonical_root) {
                    return Err(AppError::InvalidInput(
                        "build cwd is outside the project root".into(),
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

/// Shell argv for an opaque build command string: Unix `sh -c`, Windows
/// `cmd /C` (mirrors `platform::shell_launch` without the PTY builder).
pub(crate) const fn build_shell_argv(command: &str) -> (&'static str, [&str; 2]) {
    #[cfg(windows)]
    {
        ("cmd", ["/C", command])
    }
    #[cfg(not(windows))]
    {
        ("sh", ["-c", command])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(unix)]
    fn shell_argv_uses_sh_dash_c_on_unix() {
        let (shell, args) = build_shell_argv("cargo test --no-run");
        assert_eq!(shell, "sh");
        assert_eq!(args, ["-c", "cargo test --no-run"]);
    }

    #[test]
    fn shell_argv_carries_full_command_verbatim() {
        let cmd = "cargo test 'parse_simple' --no-run --message-format=json";
        let (_, args) = build_shell_argv(cmd);
        assert_eq!(args[1], cmd);
    }

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
}
