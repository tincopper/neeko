//! Asynchronous output collection for [`CommandExecutor`].

use tokio::io::AsyncReadExt;

use super::factory::{create_executor, ExecTarget};
use super::{BoxAsyncRead, ExecChild, ExecError, ExecOutput};

/// Create an executor for `target`, run a command without input, and collect
/// its raw output for both successful and non-zero exits.
pub async fn collect_output(
    target: &ExecTarget,
    cmd: &str,
    args: &[&str],
) -> Result<ExecOutput, ExecError> {
    let executor = create_executor(target);
    let child = executor.spawn(cmd, args).await?;
    collect_child_output(child).await
}

/// Collect a child process after closing stdin and draining both output streams
/// concurrently.
pub async fn collect_child_output(mut child: ExecChild) -> Result<ExecOutput, ExecError> {
    drop(child.stdin.take());

    let stdout = drain(child.stdout.take());
    let stderr = drain(child.stderr.take());
    let wait = child.wait;
    let (stdout, stderr, exit_code) = tokio::try_join!(stdout, stderr, wait)?;

    Ok(ExecOutput {
        stdout,
        stderr,
        exit_code,
    })
}

/// Run a command and return lossy UTF-8 stdout only when it exits successfully.
pub async fn exec_on(target: &ExecTarget, cmd: &str, args: &[&str]) -> Result<String, ExecError> {
    let output = collect_output(target, cmd, args).await?;
    if output.exit_code == 0 {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(ExecError::CommandFailed {
            code: output.exit_code,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }
}

async fn drain(mut reader: Option<BoxAsyncRead>) -> Result<Vec<u8>, ExecError> {
    let mut bytes = Vec::new();
    if let Some(reader) = reader.as_mut() {
        reader.read_to_end(&mut bytes).await?;
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use futures::FutureExt;
    use tokio::io::{duplex, AsyncWriteExt};

    use super::*;

    fn fake_child(stdout: Vec<u8>, stderr: Vec<u8>, exit_code: i32) -> ExecChild {
        let (mut stdout_writer, stdout_reader) = duplex(64);
        let (mut stderr_writer, stderr_reader) = duplex(64);
        tokio::spawn(async move {
            stdout_writer.write_all(&stdout).await.unwrap();
        });
        tokio::spawn(async move {
            stderr_writer.write_all(&stderr).await.unwrap();
        });

        ExecChild::new(
            None,
            Some(Box::pin(stdout_reader) as BoxAsyncRead),
            Some(Box::pin(stderr_reader) as BoxAsyncRead),
            async move { Ok(exit_code) },
            || async { Ok(()) }.boxed(),
        )
    }

    #[tokio::test]
    async fn collect_child_output_preserves_raw_bytes_and_nonzero_exit() {
        let output = collect_child_output(fake_child(vec![0xff, 0x00], vec![0xfe], 7))
            .await
            .unwrap();

        assert_eq!(
            output,
            ExecOutput {
                stdout: vec![0xff, 0x00],
                stderr: vec![0xfe],
                exit_code: 7,
            }
        );
    }

    #[tokio::test]
    async fn collect_output_runs_inside_tokio_runtime() {
        let output = collect_output(&ExecTarget::Local, "sh", &["-c", "printf runtime-ok"])
            .await
            .unwrap();

        assert_eq!(output.stdout, b"runtime-ok");
        assert_eq!(output.exit_code, 0);
    }

    #[tokio::test]
    async fn collect_output_closes_stdin_for_eof_waiting_command() {
        let output = tokio::time::timeout(
            Duration::from_secs(3),
            collect_output(
                &ExecTarget::Local,
                "sh",
                &["-c", "cat >/dev/null; printf eof"],
            ),
        )
        .await
        .expect("collection should not wait indefinitely for stdin EOF")
        .unwrap();

        assert_eq!(output.stdout, b"eof");
    }

    #[tokio::test]
    async fn collect_output_drains_large_stdout_and_stderr_concurrently() {
        let output = tokio::time::timeout(
            Duration::from_secs(5),
            collect_output(
                &ExecTarget::Local,
                "sh",
                &[
                    "-c",
                    "yes o | head -c 1048576 & yes e | head -c 1048576 >&2 & wait",
                ],
            ),
        )
        .await
        .expect("collection should not deadlock on full stdio pipes")
        .unwrap();

        assert_eq!(output.stdout.len(), 1_048_576);
        assert_eq!(output.stderr.len(), 1_048_576);
    }

    #[tokio::test]
    async fn exec_on_returns_structured_command_failure() {
        let error = exec_on(
            &ExecTarget::Local,
            "sh",
            &["-c", "printf out; printf err >&2; exit 9"],
        )
        .await
        .unwrap_err();

        match error {
            ExecError::CommandFailed {
                code,
                stdout,
                stderr,
            } => {
                assert_eq!(code, 9);
                assert_eq!(stdout, b"out");
                assert_eq!(stderr, b"err");
            }
            other => panic!("expected CommandFailed, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn collect_child_output_handles_overflow_stdout_before_exit() {
        // 模拟 PID 帧后附带首段命令输出（SSH PID+溢出场景）
        let output = collect_child_output(fake_child(b"line1\noutput-data".to_vec(), vec![], 0))
            .await
            .unwrap();
        assert_eq!(output.stdout, b"line1\noutput-data");
        assert_eq!(output.exit_code, 0);
    }

    #[tokio::test]
    async fn collect_child_output_normal_exit_not_killed() {
        // 验证正常退出不会返回 Killed
        let child = ExecChild::new(None, None, None, async move { Ok(0) }, || {
            async { Ok(()) }.boxed()
        });
        let output = collect_child_output(child).await.unwrap();
        assert_eq!(output.exit_code, 0);
    }

    #[tokio::test]
    async fn collect_child_output_nonzero_exit_not_killed() {
        // 验证非零退出仍然返回 Ok(ExecOutput)，不是 Killed
        let child = ExecChild::new(None, None, None, async move { Ok(7) }, || {
            async { Ok(()) }.boxed()
        });
        let output = collect_child_output(child).await.unwrap();
        assert_eq!(output.exit_code, 7);
    }

    #[cfg(not(target_os = "windows"))]
    #[tokio::test]
    async fn wsl_target_is_constructible_and_returns_wsl_error() {
        let target = ExecTarget::Wsl {
            distro: "Ubuntu".to_string(),
        };
        let error = collect_output(&target, "true", &[]).await.unwrap_err();

        assert!(matches!(error, ExecError::Wsl(_)));
    }
}
