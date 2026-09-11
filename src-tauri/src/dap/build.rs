//! 无头构建服务：编辑器内联 Debug 的前置构建（Rust / Go / Java classpath 生成）。
//!
//! 命令层只做参数接收 + 调度（AGENTS.md Review Gate #6）：构建参数校验、构建目录
//! 校验、Windows 命令转引、shell argv 组装、执行与双流截断全部内聚在本模块，命令
//! 层不再平铺进程控制细节。产物语义解析仍留前端纯函数（本服务只回原文）。

use super::launch_support::{build_shell_argv, resolve_build_dir, windows_cmd_quote};
use super::types::DebugBuildOutput;
use crate::common::executor::factory::ExecTarget;
use crate::AppError;
use crate::AppStateWrapper;

/// §4 IPC 红线：单次命令返回的 JSON ≤ 2MB —— **双流共享**此总预算（cap 单流，
/// 保证 stdout + stderr 相加不越界）。PTY 合流输出永不进入解析器。
const DEBUG_BUILD_OUTPUT_LIMIT: usize = 2 * 1024 * 1024;

/// 单流（stdout / stderr 各自）的捕获上限 = 总预算一半。
const DEBUG_BUILD_STREAM_LIMIT: usize = DEBUG_BUILD_OUTPUT_LIMIT / 2;

/// 在项目环境执行无头构建命令（piped stdio，永不开 PTY 会话）。
///
/// 返回退出码 + 截断后的双流输出：stdout 是产物解析通道（cargo
/// `--message-format=json` 行，永不与 stderr 混流），stderr 是 go/cargo 的构建
/// 报错流（前端失败时渲染进 DebugPanel console）。
///
/// `cwd` 在 Local 上做 canonicalize + 项目根包含校验（阻塞 FS 调用已在
/// [`resolve_build_dir`] 内隔离到 `spawn_blocking`），远端仅做 NUL 字面检查
/// —— 远程无法 canonicalize。
pub async fn build_test_binary(
    state: &AppStateWrapper,
    project_id: &str,
    command: &str,
    cwd: &str,
) -> Result<DebugBuildOutput, AppError> {
    if command.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "debug build command must not be empty".into(),
        ));
    }
    if cwd.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "debug build cwd must not be empty".into(),
        ));
    }
    let (target, project_root) = state.resolve_project(project_id)?;
    let dir = resolve_build_dir(&target, &project_root, cwd).await?;
    // Windows 本地经 `cmd /C` 执行，前端命令的 POSIX 单引号（`cargo test 'name'`）
    // 在 cmd 下是字面字符——转成 cmd 双引号；非 Windows Local 原样透传。
    let command = if matches!(target, ExecTarget::Local) && cfg!(windows) {
        windows_cmd_quote(command)
    } else {
        command.to_string()
    };
    let (shell, args) = build_shell_argv(&command);
    let output = crate::core::exec::collect(&target, shell, &args, Some(dir.as_str()))
        .await
        .map_err(|e| AppError::Dap(format!("debug build spawn failed: {e}")))?;
    Ok(DebugBuildOutput {
        exit_code: output.exit_code,
        stdout: truncate_build_stream(&output.stdout, DEBUG_BUILD_STREAM_LIMIT),
        stderr: truncate_build_stream(&output.stderr, DEBUG_BUILD_STREAM_LIMIT),
    })
}

/// Truncate one captured build stream to `limit` bytes.
fn truncate_build_stream(raw: &[u8], limit: usize) -> String {
    // Back off over UTF-8 continuation bytes (10xxxxxx) so the cut lands on a
    // char boundary; lossy-decode the (valid-prefix) remainder.
    let mut end = raw.len().min(limit);
    // end == raw.len() is always a boundary; only back off inside the buffer.
    while end > 0 && end < raw.len() && (raw[end] & 0xC0) == 0x80 {
        end -= 1;
    }
    String::from_utf8_lossy(&raw[..end]).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 两流各自截断后总字节仍受 §4 的 2MB IPC 红线约束（共享预算，非每流 2MB）。
    #[test]
    fn per_stream_limit_keeps_two_streams_within_the_ipc_budget() {
        assert_eq!(DEBUG_BUILD_STREAM_LIMIT * 2, DEBUG_BUILD_OUTPUT_LIMIT);
    }

    #[test]
    fn truncate_keeps_short_output_intact() {
        assert_eq!(
            truncate_build_stream(b"ok\n", DEBUG_BUILD_STREAM_LIMIT),
            "ok\n"
        );
        assert_eq!(truncate_build_stream(b"", DEBUG_BUILD_STREAM_LIMIT), "");
    }

    #[test]
    fn truncate_cuts_at_limit_on_char_boundary() {
        // Multi-byte chars: limit inside an `é` (2 bytes) must back off, never panic.
        let raw = "é".repeat(100);
        let out = truncate_build_stream(raw.as_bytes(), 101);
        assert!(out.len() <= 101);
        assert_eq!(out, "é".repeat(50));
        // Exact limit keeps everything.
        let out = truncate_build_stream(raw.as_bytes(), 200);
        assert_eq!(out, raw);
    }

    /// 单流截断不得越界（stdout/stderr 各按上限截断，总输出不超预算）。
    #[test]
    fn truncate_caps_each_stream_at_the_stream_limit() {
        let raw = vec![b'x'; DEBUG_BUILD_STREAM_LIMIT + 4096];
        let out = truncate_build_stream(&raw, DEBUG_BUILD_STREAM_LIMIT);
        assert_eq!(out.len(), DEBUG_BUILD_STREAM_LIMIT);
    }
}
