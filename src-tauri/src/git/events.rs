//! Git 域事件常量与 payload（长操作的 Console 可见性）。
//!
//! 红线 5：事件名双端只允许来自单一常量源 —— 前端常量见
//! `src/shared/events.ts`、payload 见 `src/shared/types/git.ts`，改任一端必须同步另一端。

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::common::executor::{ExecChunkSink, ExecStream};

/// 长时 git 操作（push / fetch / pull / commit）的实时输出块。
pub const GIT_OPERATION_OUTPUT_EVENT: &str = "git-operation-output";

/// 输出块来自哪条流（JSON: `"stdout"` / `"stderr"`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GitOutputStream {
    /// Standard output.
    Stdout,
    /// Standard error.
    Stderr,
}

/// One streamed chunk of a running git command.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOperationOutputEvent {
    /// Console run id supplied by the caller（`console_run_id` 原样回传）。
    pub run_id: String,
    /// Which stream the chunk came from.
    pub stream: GitOutputStream,
    /// UTF-8 文本块（跨读边界的多字节字符已由采集层补齐）。
    pub chunk: String,
}

/// Console run id 上限：它会被回显进每个事件，防超长参数放大事件体积。
const MAX_RUN_ID_LEN: usize = 128;

/// 从命令参数构造输出回调；`None` / 空白 / 超长 ⇒ 不开启流式（等价旧行为）。
pub(crate) fn output_sink(app: &AppHandle, run_id: Option<&str>) -> Option<ExecChunkSink> {
    let app = app.clone();
    output_sink_with(run_id, move |event| {
        if let Err(e) = app.emit(GIT_OPERATION_OUTPUT_EVENT, event) {
            log::warn!("[git] failed to emit output chunk: {e}");
        }
    })
}

/// [`output_sink`] 的纯逻辑核心：校验 run id，把 `emit` 包成 [`ExecChunkSink`]。
fn output_sink_with<F>(run_id: Option<&str>, emit: F) -> Option<ExecChunkSink>
where
    F: Fn(GitOperationOutputEvent) + Send + Sync + 'static,
{
    let run_id = run_id
        .map(str::trim)
        .filter(|id| !id.is_empty() && id.len() <= MAX_RUN_ID_LEN)?;
    let run_id = run_id.to_string();
    Some(Arc::new(move |stream, text: &str| {
        emit(GitOperationOutputEvent {
            run_id: run_id.clone(),
            stream: match stream {
                ExecStream::Stdout => GitOutputStream::Stdout,
                ExecStream::Stderr => GitOutputStream::Stderr,
            },
            chunk: text.to_string(),
        });
    }))
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc as StdArc, Mutex};

    use super::*;

    #[test]
    fn output_sink_requires_a_usable_run_id() {
        assert!(output_sink_with(None, |_| {}).is_none());
        assert!(output_sink_with(Some("   "), |_| {}).is_none());
        assert!(output_sink_with(Some(&"x".repeat(MAX_RUN_ID_LEN + 1)), |_| {}).is_none());
        assert!(output_sink_with(Some("run-1"), |_| {}).is_some());
    }

    #[test]
    fn output_sink_forwards_stream_and_text_and_echoes_run_id() {
        let seen: StdArc<Mutex<Vec<(String, GitOutputStream, String)>>> =
            StdArc::new(Mutex::new(Vec::new()));
        let sink = output_sink_with(Some(" run-42 "), {
            let seen = StdArc::clone(&seen);
            move |event| {
                seen.lock()
                    .unwrap()
                    .push((event.run_id, event.stream, event.chunk));
            }
        })
        .expect("valid run id");

        sink(ExecStream::Stdout, "hello");
        sink(ExecStream::Stderr, "warn");

        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 2);
        assert_eq!(
            seen[0],
            (
                "run-42".to_string(),
                GitOutputStream::Stdout,
                "hello".to_string()
            )
        );
        assert_eq!(
            seen[1],
            (
                "run-42".to_string(),
                GitOutputStream::Stderr,
                "warn".to_string()
            )
        );
    }
}
