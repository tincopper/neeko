//! 子进程输出采集（`CommandExecutor` 的规范实现）。
//!
//! 业务代码不直接调用——`core::exec::{collect, run}` 是本模块的
//! facade；仅「自己 spawn 后要收集」的少数场景（git transport 自建通道）直接用
//! [`collect_child_output`]。

use tokio::io::AsyncReadExt;

use super::{BoxAsyncRead, ExecChild, ExecError, ExecOutput};

/// 关闭 stdin 后并发抽干 stdout/stderr 并等待退出，返回原始字节与退出码。
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

async fn drain(mut reader: Option<BoxAsyncRead>) -> Result<Vec<u8>, ExecError> {
    let mut bytes = Vec::new();
    if let Some(reader) = reader.as_mut() {
        reader.read_to_end(&mut bytes).await?;
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
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

    #[test]
    fn format_command_failed_msg_prefers_stderr_utf8() {
        let msg = crate::common::executor::format_command_failed_msg(1, b"out", b"GraphQL: boom\n");
        assert_eq!(msg, "Command failed with code 1: GraphQL: boom");
        assert!(!msg.contains('['));
    }

    #[test]
    fn format_command_failed_msg_falls_back_to_stdout() {
        let msg = crate::common::executor::format_command_failed_msg(2, b"only-out", b"");
        assert_eq!(msg, "Command failed with code 2: only-out");
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
}
