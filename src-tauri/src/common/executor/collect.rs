//! 子进程输出采集（`CommandExecutor` 的规范实现）。
//!
//! 业务代码不直接调用——`core::exec::{collect, run}` 是本模块的
//! facade；仅「自己 spawn 后要收集」的少数场景（git transport 自建通道）直接用
//! [`collect_child_output`] / [`collect_child_output_streaming`]。

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use tokio::io::AsyncReadExt;

use super::{BoxAsyncRead, ExecChild, ExecChunkSink, ExecError, ExecOutput, ExecStream};

/// 关闭 stdin 后并发抽干 stdout/stderr 并等待退出，返回原始字节与退出码。
pub async fn collect_child_output(child: ExecChild) -> Result<ExecOutput, ExecError> {
    collect_child_output_streaming(child, None).await
}

/// [`collect_child_output`] 的流式变体：输出**合流**后交给 `on_output`。
///
/// * 聚合返回值与 [`collect_child_output`] 完全一致（原始字节与退出码）；
/// * `on_output` 收到的是**按 UTF-8 边界切分**的文本块——跨读边界拆开的多字节
///   字符会等到补齐后再交付（不产生 `U+FFFD` 假字符）；真实编码错误按 lossy 交付；
/// * 高频小读按 [`FLUSH_BYTES`] / [`FLUSH_INTERVAL`] 合流成低频事件（EOF 强制冲刷尾巴），
///   避免逐读块 `emit` 把长操作输出风暴放大成 macOS 事件 eval 内存压力；
/// * 两个流并发抽干，块顺序是各流自身的真实到达顺序。
pub async fn collect_child_output_streaming(
    child: ExecChild,
    on_output: Option<ExecChunkSink>,
) -> Result<ExecOutput, ExecError> {
    collect_child_output_streaming_cancellable(child, on_output, std::future::pending()).await
}

/// 取消时等待 kill 确认的上界：远端（SSH `kill -9` 新通道）可能永不到达；
/// 无界等待会让单飞槽被永久占用（前端 tab 永远 `stopping`）。超时仍按 Killed 返回。
const KILL_GRACE: Duration = Duration::from_secs(5);

/// kill 闭包类型（与 [`ExecChild::into_wait_and_kill`] 的产出同形）。
type KillFn =
    Box<dyn FnOnce() -> Pin<Box<dyn Future<Output = Result<(), ExecError>> + Send>> + Send>;

/// 有界等待 kill 确认：`true` = 在 `grace` 内收敛。
/// 远端确认可能永不到达（见 [`KILL_GRACE`]），不能无界 await。
async fn await_kill_bounded(kill_fn: KillFn, grace: Duration) -> bool {
    tokio::time::timeout(grace, kill_fn()).await.is_ok()
}

/// [`collect_child_output_streaming`] 的可取消变体：`cancel` 完成时**杀掉子进程**
/// （是否连后代一起清理取决于 spawn 的 `SpawnOptions::kill_tree`）并返回
/// [`ExecError::Killed`]。
///
/// 调用方必须在 spawn 时启用 `kill_tree`（包装器 → hook → 测试进程树），
/// 否则只杀直接子进程、后代变孤儿。kill 的确认有界（[`KILL_GRACE`]）。
pub async fn collect_child_output_streaming_cancellable<C>(
    mut child: ExecChild,
    on_output: Option<ExecChunkSink>,
    cancel: C,
) -> Result<ExecOutput, ExecError>
where
    C: Future<Output = ()> + Send,
{
    let (stdin, stdout, stderr) = child.take_stdio();
    // EOF 等待的命令（cat 等）不得因 stdin 未关而挂起（与 collect_child_output 同约定）。
    drop(stdin);
    let (wait, kill_fn) = child.into_wait_and_kill();

    tokio::select! {
        result = collect_streams(stdout, stderr, wait, on_output) => result,
        () = cancel => {
            // 有界收尾：kill 信号已尽力发出（`kill_tree` 在 kill 闭包内），
            // 但确认可能永不到达 —— 宁可放行调用方也不让单飞槽永久卡死。
            if !await_kill_bounded(kill_fn, KILL_GRACE).await {
                log::warn!(
                    "[exec] child kill did not settle within {KILL_GRACE:?}; releasing caller anyway"
                );
            }
            Err(ExecError::Killed)
        }
    }
}

/// 进程退出 future 的类型（与 [`ExecChild::into_wait_and_kill`] 的产出同形）。
type WaitFuture = Pin<Box<dyn Future<Output = Result<i32, ExecError>> + Send>>;

/// spawn 拆包后的共享核心：并发抽干双流 + 等退出。
async fn collect_streams(
    stdout: Option<BoxAsyncRead>,
    stderr: Option<BoxAsyncRead>,
    wait: WaitFuture,
    sink: Option<ExecChunkSink>,
) -> Result<ExecOutput, ExecError> {
    let stdout = drain_stream(stdout, ExecStream::Stdout, sink.clone());
    let stderr = drain_stream(stderr, ExecStream::Stderr, sink);
    let (stdout, stderr, exit_code) = tokio::try_join!(stdout, stderr, wait)?;

    Ok(ExecOutput {
        stdout,
        stderr,
        exit_code,
    })
}

/// 合流阈值：攒够这么多已成型文本就立即交付一次。
const FLUSH_BYTES: usize = 16 * 1024;
/// 合流宽限：有积压但未达阈值时，最多等这么久就交付（慢速输出的可见性）。
const FLUSH_INTERVAL: Duration = Duration::from_millis(50);

/// 抽干单个流：原始字节始终聚合；`sink` 存在时按完整 UTF-8 前缀**合流交付**。
async fn drain_stream(
    mut reader: Option<BoxAsyncRead>,
    stream: ExecStream,
    sink: Option<ExecChunkSink>,
) -> Result<Vec<u8>, ExecError> {
    let mut bytes = Vec::new();
    let Some(reader) = reader.as_mut() else {
        return Ok(bytes);
    };
    let Some(sink) = sink else {
        // 无流式出口：聚合语义与旧实现逐字一致。
        reader.read_to_end(&mut bytes).await?;
        return Ok(bytes);
    };
    let sink: &(dyn Fn(ExecStream, &str) + Send + Sync) = &*sink;

    let mut buf = [0u8; 8192];
    // 未闭合的多字节 UTF-8 序列（最多 3 字节）：等下一块补齐后再交付。
    let mut carry: Vec<u8> = Vec::new();
    // 已成块、待合流交付的完整 UTF-8 文本。
    let mut pending: Vec<u8> = Vec::new();

    loop {
        // 有积压时给读加宽限：慢速输出也要在窗口内可见，而不是一直等阈值。
        let n = if pending.is_empty() {
            reader.read(&mut buf).await?
        } else {
            tokio::select! {
                n = reader.read(&mut buf) => n?,
                () = tokio::time::sleep(FLUSH_INTERVAL) => {
                    deliver(sink, stream, &pending);
                    pending.clear();
                    continue;
                }
            }
        };
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&buf[..n]);
        carry.extend_from_slice(&buf[..n]);
        push_complete_utf8(&mut carry, &mut pending);
        if pending.len() >= FLUSH_BYTES {
            deliver(sink, stream, &pending);
            pending.clear();
        }
    }
    // EOF：残留的不完整序列 lossy 补上，再冲刷最后的尾巴（一次运行的最后输出不得丢）。
    if !carry.is_empty() {
        pending.extend_from_slice(String::from_utf8_lossy(&carry).as_bytes());
    }
    if !pending.is_empty() {
        deliver(sink, stream, &pending);
    }
    Ok(bytes)
}

/// 把 `carry` 中**完整**的 UTF-8 前缀推进 `pending`，尾部不完整序列留在 `carry` 等补齐。
/// 真实编码错误按 lossy 推进（保证进展，不阻塞后续输出）。
fn push_complete_utf8(carry: &mut Vec<u8>, pending: &mut Vec<u8>) {
    match split_utf8(carry) {
        Utf8Split::Complete => {
            pending.extend_from_slice(carry);
            carry.clear();
        }
        Utf8Split::Prefix(len) => {
            if len > 0 {
                pending.extend_from_slice(&carry[..len]);
                carry.drain(..len);
            }
        }
        Utf8Split::Lossy => {
            pending.extend_from_slice(String::from_utf8_lossy(carry).as_bytes());
            carry.clear();
        }
    }
}

/// UTF-8 切分决策（纯函数，单测在下方）。
enum Utf8Split {
    /// 缓冲整体是完整 UTF-8（含空）。
    Complete,
    /// 前 `len` 字节是完整 UTF-8；尾部序列不完整，等更多字节。
    Prefix(usize),
    /// 存在真实编码错误：调用方按 lossy 交付整个缓冲以取得进展。
    Lossy,
}

const fn split_utf8(bytes: &[u8]) -> Utf8Split {
    match std::str::from_utf8(bytes) {
        Ok(_) => Utf8Split::Complete,
        // `error_len() == None` ⇒ 只能是「尾部不完整」→ 等下一块。
        Err(e) if e.error_len().is_none() => Utf8Split::Prefix(e.valid_up_to()),
        Err(_) => Utf8Split::Lossy,
    }
}

fn deliver(sink: &(dyn Fn(ExecStream, &str) + Send + Sync), stream: ExecStream, bytes: &[u8]) {
    if bytes.is_empty() {
        return;
    }
    // Complete / Prefix(n) 由 `split_utf8` 保证是合法 UTF-8；lossy 仅为不 panic 兜底。
    sink(stream, &String::from_utf8_lossy(bytes));
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use futures::FutureExt;
    use tokio::io::{duplex, AsyncWriteExt};

    use super::*;

    type Calls = Arc<Mutex<Vec<(ExecStream, String)>>>;

    /// 写入器任务随 write 顺序推进；reader 侧何时读到哪一段由调度决定，
    /// 因此涉及切分的断言只依赖「内容正确 + 无替换字符」，不依赖具体块边界。
    fn fake_child(
        stdout_writes: Vec<Vec<u8>>,
        stderr_writes: Vec<Vec<u8>>,
        exit_code: i32,
    ) -> ExecChild {
        let stdout = pipe_of_writes(stdout_writes);
        let stderr = pipe_of_writes(stderr_writes);
        ExecChild::new(
            None,
            Some(Box::pin(stdout) as BoxAsyncRead),
            Some(Box::pin(stderr) as BoxAsyncRead),
            async move { Ok(exit_code) },
            || async { Ok(()) }.boxed(),
        )
    }

    fn pipe_of_writes(writes: Vec<Vec<u8>>) -> tokio::io::DuplexStream {
        let (mut writer, reader) = duplex(64);
        tokio::spawn(async move {
            for chunk in writes {
                if chunk.is_empty() {
                    continue;
                }
                if writer.write_all(&chunk).await.is_err() {
                    return;
                }
                // 让 reader 有机会读到「半截」序列。
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        });
        reader
    }

    fn sink_into(calls: &Calls) -> ExecChunkSink {
        let calls = Arc::clone(calls);
        Arc::new(move |stream, text: &str| {
            calls.lock().unwrap().push((stream, text.to_string()));
        })
    }

    fn joined(calls: &Calls, stream: ExecStream) -> String {
        calls
            .lock()
            .unwrap()
            .iter()
            .filter(|(s, _)| *s == stream)
            .map(|(_, t)| t.as_str())
            .collect()
    }

    #[tokio::test]
    async fn collect_child_output_preserves_raw_bytes_and_nonzero_exit() {
        let output = collect_child_output(fake_child(vec![vec![0xff, 0x00]], vec![vec![0xfe]], 7))
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
        let output =
            collect_child_output(fake_child(vec![b"line1\noutput-data".to_vec()], vec![], 0))
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

    // ── 流式变体 ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn streaming_sink_sees_chunks_and_aggregate_is_unchanged() {
        let calls: Calls = Arc::new(Mutex::new(Vec::new()));
        let sink = sink_into(&calls);

        let output = collect_child_output_streaming(
            fake_child(vec![b"hello\n".to_vec()], vec![b"warn\n".to_vec()], 0),
            Some(sink),
        )
        .await
        .unwrap();

        assert_eq!(output.stdout, b"hello\n");
        assert_eq!(output.stderr, b"warn\n");
        assert_eq!(joined(&calls, ExecStream::Stdout), "hello\n");
        assert_eq!(joined(&calls, ExecStream::Stderr), "warn\n");
    }

    #[tokio::test]
    async fn streaming_sink_split_multibyte_char_is_rejoined_without_replacement() {
        // "你" = E4 BD A0：拆成 [E4] + [BD A0] 两次写，读侧必须等补齐后交付。
        let calls: Calls = Arc::new(Mutex::new(Vec::new()));
        let sink = sink_into(&calls);

        let output = collect_child_output_streaming(
            fake_child(vec![vec![0xE4], vec![0xBD, 0xA0]], vec![], 0),
            Some(sink),
        )
        .await
        .unwrap();

        assert_eq!(output.stdout, "你".as_bytes());
        let text = joined(&calls, ExecStream::Stdout);
        assert_eq!(text, "你");
        assert!(
            !text.contains('\u{FFFD}'),
            "跨读边界的多字节字符不得产生替换字符: {text:?}"
        );
    }

    #[tokio::test]
    async fn streaming_lossy_path_makes_progress_on_invalid_bytes() {
        // 真实编码错误：交付后必须清空 carry，不允许卡死后续输出。
        let calls: Calls = Arc::new(Mutex::new(Vec::new()));
        let sink = sink_into(&calls);

        let output = collect_child_output_streaming(
            fake_child(vec![vec![0xFF], b"ok".to_vec()], vec![], 0),
            Some(sink),
        )
        .await
        .unwrap();

        assert_eq!(output.stdout, vec![0xFF, b'o', b'k']);
        let text = joined(&calls, ExecStream::Stdout);
        assert!(
            text.contains("ok"),
            "无效字节之后仍需交付后续内容: {text:?}"
        );
    }

    #[test]
    fn split_utf8_classifies_complete_prefix_and_lossy() {
        assert!(matches!(split_utf8(b""), Utf8Split::Complete));
        assert!(matches!(split_utf8(b"abc"), Utf8Split::Complete));
        assert!(matches!(split_utf8("你好".as_bytes()), Utf8Split::Complete));

        // 尾部不完整 → 等待补齐
        assert!(matches!(split_utf8(&[0xE4]), Utf8Split::Prefix(0)));
        assert!(matches!(
            split_utf8(&[b'a', b'b', 0xE4]),
            Utf8Split::Prefix(2)
        ));
        let mut with_partial = "你好".as_bytes().to_vec();
        with_partial.push(0xE4);
        assert!(matches!(split_utf8(&with_partial), Utf8Split::Prefix(6)));

        // 真实编码错误 → lossy
        assert!(matches!(split_utf8(&[0xFF]), Utf8Split::Lossy));
        assert!(matches!(split_utf8(&[b'a', 0xFF]), Utf8Split::Lossy));
    }

    // ── 合流 ─────────────────────────────────────────────────────────────

    /// 小读合流：多次小写不应变成同等次数的事件；EOF 必须冲刷尾巴（最后输出不丢）。
    #[tokio::test]
    async fn drain_stream_coalesces_small_reads_and_flushes_tail_at_eof() {
        let calls: Calls = Arc::new(Mutex::new(Vec::new()));
        let sink = sink_into(&calls);
        let (mut tx, rx) = duplex(1024 * 1024);
        tokio::spawn(async move {
            for _ in 0..4 {
                tx.write_all(&[b'a'; 1024]).await.unwrap();
            }
            // drop(tx) ⇒ EOF
        });

        let bytes = drain_stream(
            Some(Box::pin(rx) as BoxAsyncRead),
            ExecStream::Stdout,
            Some(sink),
        )
        .await
        .unwrap();

        assert_eq!(bytes.len(), 4096, "聚合字节不得受合流影响");
        assert_eq!(joined(&calls, ExecStream::Stdout), "a".repeat(4096));
        let deliveries = calls.lock().unwrap().len();
        assert!(
            (1..4).contains(&deliveries),
            "小读应合流为更少的事件，实际交付 {deliveries} 次"
        );
    }

    /// 慢速输出：积压未达阈值时必须在合流宽限内交付，而不是一直等 EOF（可见性）。
    #[tokio::test]
    async fn drain_stream_flushes_pending_after_interval() {
        let calls: Calls = Arc::new(Mutex::new(Vec::new()));
        let sink = sink_into(&calls);
        let (mut tx, rx) = duplex(64);
        let task = tokio::spawn(drain_stream(
            Some(Box::pin(rx) as BoxAsyncRead),
            ExecStream::Stdout,
            Some(sink),
        ));

        tx.write_all(b"partial").await.unwrap();
        tokio::time::sleep(Duration::from_millis(120)).await;
        assert_eq!(
            joined(&calls, ExecStream::Stdout),
            "partial",
            "积压未达阈值时必须在合流宽限内交付"
        );

        drop(tx); // EOF ⇒ 任务收敛
        task.await.unwrap().unwrap();
    }

    // ── 可取消变体 ─────────────────────────────────────────────────────────

    #[tokio::test]
    async fn cancellable_collect_kills_child_and_returns_killed() {
        use std::sync::atomic::{AtomicBool, Ordering};

        // stdout 管道保持打开且无数据：不取消则 drain 永远挂起 —— 正是长操作中
        // 「卡住等输出」的形态；取消必须杀进程（走 kill 闭包）并立刻返回 Killed。
        let (_writer_alive, reader) = duplex(64);
        let killed = Arc::new(AtomicBool::new(false));
        let killed_for_kill = Arc::clone(&killed);

        let child = ExecChild::new(
            None,
            Some(Box::pin(reader) as BoxAsyncRead),
            None,
            async move { Ok(0) },
            move || {
                let killed = Arc::clone(&killed_for_kill);
                Box::pin(async move {
                    killed.store(true, Ordering::SeqCst);
                    Ok(())
                }) as Pin<Box<dyn Future<Output = Result<(), ExecError>> + Send>>
            },
        );

        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(30)).await;
            let _ = tx.send(());
        });

        let result = collect_child_output_streaming_cancellable(child, None, async {
            let _ = rx.await;
        })
        .await;

        assert!(
            matches!(result, Err(ExecError::Killed)),
            "cancel must surface as Killed"
        );
        assert!(
            killed.load(Ordering::SeqCst),
            "cancel must invoke the kill closure (process tree cleanup hook)"
        );
    }

    /// kill 确认可能永不到达（SSH 远端 `kill -9` 的新通道）：取消必须**有界**返回，
    /// 否则单飞槽被永久占用、前端 tab 永远 stopping。
    #[tokio::test]
    async fn await_kill_bounded_returns_false_when_kill_hangs() {
        let settled = await_kill_bounded(
            Box::new(|| Box::pin(std::future::pending::<Result<(), ExecError>>())),
            Duration::from_millis(20),
        )
        .await;
        assert!(!settled, "kill 不收敛时应有界返回 false（放行单飞槽）");
    }

    #[tokio::test]
    async fn await_kill_bounded_returns_true_when_kill_settles() {
        let settled = await_kill_bounded(
            Box::new(|| Box::pin(async { Ok(()) })),
            Duration::from_millis(200),
        )
        .await;
        assert!(settled);
    }
}
