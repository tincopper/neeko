//! Java attach-first 的 debuggee（测试 JVM）生命周期封装。
//!
//! `DapManager::start_java_attach` 只做编排；「spawn JVM → 解析 jdwp 端口 →
//! 泵 stdout/stderr → 建 reaper/kill」四件事内聚在本模块，使 manager 不再
//! 平铺进程控制细节（高内聚 / SRP），且可脱离 manager 单测。

use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{mpsc, Mutex};

use crate::common::executor::factory::ExecTarget;
use crate::common::executor::{BoxAsyncRead, ProcessGuard};
use crate::AppError;

/// Debug Console 输出通道容量（行）。有界 + `try_send` 丢弃策略：既防 chatty
/// 测试套件把内存撑爆（无界通道在消费任务挂上前的窗口内会无上限累积），又保证
/// 泵线程永不阻塞 debuggee 管道。
const JAVA_OUT_CHANNEL_CAPACITY: usize = 2048;

/// 已启动并完成端口发现的测试 JVM。
pub(crate) struct JavaDebuggee {
    /// jdwp 监听端口（供 DAP attach 配置）。
    pub(crate) port: u16,
    /// stdout/stderr 行流（`("<stream>", line)`），供会话转发为 output 事件。
    pub(crate) output_rx: mpsc::Receiver<(String, String)>,
    /// 进程清理守卫：由会话条目持有，随条目消亡 RAII 终止。
    pub(crate) guard: ProcessGuard,
}

impl JavaDebuggee {
    /// spawn 测试 JVM 并等待其打印 jdwp 监听端口。
    ///
    /// 失败路径（端口解析超时/EOF）自带清理：先 kill 子进程再返回错误，调用方
    /// 无需再做兜底。成功返回后子进程生命周期由 [`ProcessGuard`] 接管。
    pub(crate) async fn launch(
        target: &ExecTarget,
        shell: &str,
        args: &[&str],
        dir: &str,
    ) -> Result<Self, AppError> {
        // ── 1. spawn 测试 JVM（suspend=y 挂到 attach 后才跑测试）──────────────
        let mut child = crate::core::exec::spawn_with(target, shell, args, Some(dir))
            .await
            .map_err(|e| AppError::Dap(format!("java debug JVM spawn failed: {e}")))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::Dap("java debug JVM has no stdout".into()))?;
        // stderr 汇入共享缓冲（≤4KB）：端口解析超时/失败时把 JVM 真实报错（如
        // jar 缺失 / 类找不到）附进错误信息；同时经 output 通道转发进会话
        // output 事件（Debug Console 可见）。
        let stderr = child.stderr.take();
        let stderr_buf = Arc::new(Mutex::new(String::new()));
        let (tx, output_rx) = mpsc::channel(JAVA_OUT_CHANNEL_CAPACITY);
        drain_java_stderr(stderr, Arc::clone(&stderr_buf), tx.clone());

        let (port, reader) = match read_jdwp_port(stdout).await {
            Ok(pair) => pair,
            Err(e) => {
                let detail = stderr_buf.lock().await.trim().to_string();
                let _ = child.kill().await;
                return Err(if detail.is_empty() {
                    e
                } else {
                    AppError::Dap(format!("{e} | JVM stderr: {detail}"))
                });
            }
        };

        // ── 2. 泵剩余 stdout（防管道填满 + 转发进会话 output 事件）─────────────
        drain_java_stdout(reader, tx);

        // ── 3. JVM 生命周期：交给共享 ProcessGuard（异步 terminate + RAII）─────
        let (wait_fut, kill_fn) = child.into_wait_and_kill();
        Ok(Self {
            port,
            output_rx,
            guard: ProcessGuard::new(wait_fut, kill_fn),
        })
    }
}

/// Forward one output line to the bounded channel, dropping (never blocking)
/// when the consumer has not caught up — the debuggee pipe must stay drained.
fn forward(tx: &mpsc::Sender<(String, String)>, category: &str, line: &str) {
    if tx
        .try_send((category.to_string(), line.to_string()))
        .is_err()
    {
        log::debug!("[java-debug] output buffer full, dropping {category} line: {line}");
    }
}

/// Parse the JDWP agent's ephemeral listen port from a JVM stdout line.
///
/// `-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=0` 下 JVM 打印
/// `Listening for transport dt_socket at address: 45678`（实证：dt_socket 自选
/// 端口时走该行，非 `address=0` 的固定端口也会打印）。取该行后首个十进制串。
fn parse_jdwp_listen_port(line: &str) -> Option<u16> {
    const MARKER: &str = "Listening for transport dt_socket at address:";
    let idx = line.find(MARKER)?;
    let rest = line[idx + MARKER.len()..].trim_start();
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<u16>().ok()
}

/// Read the test JVM stdout line-by-line until the jdwp listen port appears
/// (≤30s，suspend=y 下 JVM 在 main 前打印）。返回端口 + 仍打开的 reader
/// （调用方用 [`drain_java_stdout`] 继续泵剩余输出，防管道填满阻塞 JVM）。
async fn read_jdwp_port(stdout: BoxAsyncRead) -> Result<(u16, BufReader<BoxAsyncRead>), AppError> {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    for _ in 0..30 {
        line.clear();
        match tokio::time::timeout(Duration::from_secs(1), reader.read_line(&mut line)).await {
            Ok(Ok(0)) | Ok(Err(_)) => break, // EOF / read error → JVM 未打印端口就退出
            Ok(Ok(_)) => {
                let trimmed = line.trim();
                log::debug!("[java-debug] test JVM stdout: {trimmed}");
                if let Some(port) = parse_jdwp_listen_port(trimmed) {
                    return Ok((port, reader));
                }
            }
            Err(_) => break, // 1s 窗口内无输出 → 超时
        }
    }
    Err(AppError::Dap(
        "Timed out waiting for the test JVM to print its JDWP listen port \
         (expected `Listening for transport dt_socket at address: <port>`). \
         The JVM may have failed to start or `java` is not a real JVM."
            .into(),
    ))
}

/// Pump the remaining test-JVM stdout to EOF, forwarding every non-empty line
/// to `tx` (`("stdout", line)`) while keeping the pipe open so a chatty test
/// suite cannot block the debuggee. Ends on JVM exit (EOF).
fn drain_java_stdout(mut stdout: BufReader<BoxAsyncRead>, tx: mpsc::Sender<(String, String)>) {
    tokio::spawn(async move {
        let mut line = String::new();
        loop {
            line.clear();
            match stdout.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    log::debug!("[java-debug] test JVM stdout: {trimmed}");
                    forward(&tx, "stdout", trimmed);
                }
            }
        }
    });
}

/// Drain test-JVM stderr into a shared buffer (≤4KB ring) for startup-failure
/// diagnostics, forwarding every non-empty line to `tx` (`("stderr", line)`).
/// Ends on JVM exit (EOF).
fn drain_java_stderr(
    stderr: Option<BoxAsyncRead>,
    buf: Arc<Mutex<String>>,
    tx: mpsc::Sender<(String, String)>,
) {
    if let Some(stderr) = stderr {
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        log::debug!("[java-debug] test JVM stderr: {trimmed}");
                        forward(&tx, "stderr", trimmed);
                        let mut b = buf.lock().await;
                        if b.len() < 4096 {
                            b.push_str(trimmed);
                            b.push('\n');
                        }
                    }
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jdwp_port_parses_ephemeral_listen_line() {
        assert_eq!(
            parse_jdwp_listen_port("Listening for transport dt_socket at address: 45678"),
            Some(45678)
        );
        assert_eq!(
            parse_jdwp_listen_port(
                "Agent logs: Listening for transport dt_socket at address: 34567\n"
            ),
            Some(34567)
        );
    }

    #[test]
    fn jdwp_port_rejects_lines_without_marker_or_digits() {
        assert_eq!(
            parse_jdwp_listen_port("Picked up JAVA_TOOL_OPTIONS: -Xmx2g"),
            None
        );
        assert_eq!(
            parse_jdwp_listen_port("Listening for transport dt_socket at address: "),
            None
        );
        assert_eq!(parse_jdwp_listen_port(""), None);
        assert_eq!(
            parse_jdwp_listen_port("Listening for transport dt_socket"),
            None
        );
    }

    #[test]
    fn jdwp_port_rejects_out_of_range_port() {
        assert_eq!(
            parse_jdwp_listen_port("Listening for transport dt_socket at address: 99999"),
            None
        );
    }

    /// 有界通道满时 `forward` 丢弃而非阻塞（chatty 套件不得拖住 debuggee 管道）。
    #[tokio::test]
    async fn forward_drops_when_buffer_full_without_blocking() {
        let (tx, mut rx) = mpsc::channel(2);
        forward(&tx, "stdout", "one");
        forward(&tx, "stdout", "two");
        // 第三次超出容量：必须立即返回（丢弃），不 await。
        forward(&tx, "stdout", "three");
        assert_eq!(rx.recv().await, Some(("stdout".into(), "one".into())));
        assert_eq!(rx.recv().await, Some(("stdout".into(), "two".into())));
        // 被丢弃的那条不会出现。
        assert!(rx.try_recv().is_err());
    }

    fn empty_reader() -> BoxAsyncRead {
        Box::pin(tokio::io::empty())
    }

    /// 非空行按顺序转发（空行丢弃），**EOF 后通道关闭**。
    #[tokio::test]
    async fn stdout_lines_are_forwarded_then_the_channel_closes() {
        let (tx, mut rx) = mpsc::channel(4);
        drain_java_stdout(BufReader::new(Box::pin(&b"hello\n\nworld\n"[..])), tx);

        assert_eq!(rx.recv().await, Some(("stdout".into(), "hello".into())));
        // 中间的空行被丢弃（不产生空日志行）。
        assert_eq!(rx.recv().await, Some(("stdout".into(), "world".into())));
        assert_eq!(rx.recv().await, None, "EOF 后必须能观察到通道关闭");
    }

    /// **会话收尾依赖的不变式**：两路管道都 EOF（= 被调试 JVM 已退出）后，输出通道必然
    /// 关闭 —— A 路径的输出泵据此判定进程结束并让会话收尾（`DapSession::debuggee_exited`）。
    ///
    /// sender 的持有关系与 `JavaDebuggee::launch` 一致：原始 `tx` 移入 stdout 泵，
    /// stderr 泵持 clone，因此**不存在多余的 sender** 让通道假性存活。
    #[tokio::test]
    async fn eof_on_both_pipes_closes_the_output_channel() {
        let (tx, mut rx) = mpsc::channel(4);
        drain_java_stderr(
            Some(empty_reader()),
            Arc::new(Mutex::new(String::new())),
            tx.clone(),
        );
        drain_java_stdout(BufReader::new(empty_reader()), tx);

        let closed = tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("两层管道 EOF 后通道必须及时关闭（不得挂住）");
        assert_eq!(closed, None);
    }

    /// **接线不变式**：`pump_output` 先把所有输出转发完，再在通道关闭后**恰好一次**触发收尾。
    ///
    /// 顺序很关键：收尾（`debuggee_exited`）会把会话标记 terminated，若它在输出排空前触发，
    /// 最后几行测试输出会被丢掉。
    #[tokio::test]
    async fn pump_output_forwards_all_lines_then_signals_exit_once() {
        let (tx, rx) = mpsc::channel(4);
        forward(&tx, "stdout", "one");
        forward(&tx, "stderr", "two");
        drop(tx); // 通道关闭 = 被调试进程已退出

        // 同步锁（std）：`emit_line` / `on_exit` 都是同步回调，用 tokio Mutex 反而要 await。
        let log: Arc<std::sync::Mutex<Vec<String>>> = Arc::new(std::sync::Mutex::new(Vec::new()));
        let lines = Arc::clone(&log);
        let exits = Arc::clone(&log);
        crate::dap::launch_support::pump_output(
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

    /// 与 transport.rs parse_listen_addr_line 的 host 行格式互证：JavaAdapter
    /// 的 host 打印 `neeko-java-host server listening at: 127.0.0.1:<port>`，
    /// 应被既有 TCP 监听地址解析接受（DAP 传输层零改动复用）。
    #[test]
    fn java_host_listen_line_compatible_with_tcp_transport() {
        let addr = crate::dap::transport::parse_listen_addr_line(
            "neeko-java-host server listening at: 127.0.0.1:41234",
        );
        assert_eq!(addr.as_deref(), Some("127.0.0.1:41234"));
    }

    // guard 的 terminate/Drop 语义测试见 common/executor/process_guard.rs
}
