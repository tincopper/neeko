//! Spawn LSP servers in Local / WSL / SSH environments via the unified executor.
//!
//! Bridges async [`ExecChild`] stdio to synchronous [`Read`]/[`Write`] so the
//! existing LSP reader/writer threads keep working.

use std::collections::{HashMap, VecDeque};
use std::io::{self, Read, Write};
use std::sync::{mpsc, Arc, LazyLock, Mutex};

use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc as tokio_mpsc;

use crate::common::executor::factory::{create_executor, ExecTarget};
use crate::common::executor::{BoxAsyncRead, ExecChild, SpawnOptions};
use crate::common::runtime::AppRuntime;

/// Long-lived LSP process with sync stdio + kill handle.
pub struct LspProcess {
    stdin: Option<Box<dyn Write + Send>>,
    stdout: Option<Box<dyn Read + Send>>,
    stderr: Option<Box<dyn Read + Send>>,
    kill: Option<Box<dyn FnOnce() + Send>>,
    /// Best-effort OS / remote process id.
    pub pid: Option<u32>,
}

/// 从 `java -XshowSettings:properties -version` 输出解析 `java.home`。
///
/// - **空格形态**：`key = value` 与 `key=value` 均可（不同 JDK 发行版 / 包装脚本
///   会改写这份属性表；旧实现只认前者，形态一变就静默取不到 → JAVA_HOME 不注入，
///   jdtls 的 JDK 源码映射随之降级）。
/// - **完整键名匹配**：只接受键名恰好为 `java.home`（`java.home.xxx` / 值里出现
///   `java.home` 的行都不会误命中）。
/// - 键与值各自 `trim`（顺带吃掉 CRLF）；值成对引号时剥离（防御手工粘贴的输出）。
fn parse_java_home(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        if key.trim() != "java.home" {
            return None;
        }
        let value = value.trim();
        let value = match value.strip_prefix('"').and_then(|v| v.strip_suffix('"')) {
            Some(unquoted) => unquoted,
            None => value,
        };
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    })
}

/// 进程级缓存：`ExecTarget` 环境 → PATH `java` 对应的 JDK home（每环境探测一次）。
///
/// 按 [`ExecTarget::cache_key`] 键控：Local / WSL / SSH 的 `java` 互不相同，
/// 单槽缓存会把远端结果串给本地（或反之），注入错误的 `JAVA_HOME`。
static JAVA_HOME_CACHE: LazyLock<Mutex<HashMap<String, Option<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 探测 target 环境里 PATH `java` 对应的 JDK home。
///
/// 供 jdtls spawn 注入 `JAVA_HOME`（对齐 VSCode `java.jdt.ls.java.home` 的
/// "Tooling JDK" 语义）：brew 的 jdtls 启动器默认 `JAVA_HOME=/opt/homebrew/opt/openjdk`
///（= 最新版，本机 26），可能超出 jdtls 支持范围导致 JDK 源码映射失效；改为跟随
/// 用户 PATH `java` 的 JDK（本机 21）。仅 java 会话创建时调用一次（缓存）。
/// 仅从 spawn_blocking 线程调用（`collect_blocking` 为同步桥）。
pub fn resolve_java_home(target: &ExecTarget) -> Option<String> {
    let cache_key = target.cache_key();
    if let Ok(guard) = JAVA_HOME_CACHE.lock() {
        if let Some(cached) = guard.get(&cache_key) {
            return cached.clone();
        }
    }
    let resolved = (|| {
        let output = crate::core::exec::collect_blocking(
            target,
            "java",
            &["-XshowSettings:properties", "-version"],
        )
        .ok()?;
        let combined = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        parse_java_home(&combined)
    })();
    if let Ok(mut guard) = JAVA_HOME_CACHE.lock() {
        guard.insert(cache_key, resolved.clone());
    }
    if resolved.is_none() {
        log::warn!("[LSP] Failed to resolve java.home from PATH `java`");
    } else {
        log::info!("[LSP] Resolved java.home for jdtls: {:?}", resolved);
    }
    resolved
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_java_home_extracts_path_from_xshowsettings() {
        let out = "    java.home = /opt/homebrew/Cellar/openjdk@21/21.0.12.1/libexec/openjdk.jdk/Contents/Home\n    java.version = 21.0.12.1\n";
        assert_eq!(
            parse_java_home(out),
            Some(
                "/opt/homebrew/Cellar/openjdk@21/21.0.12.1/libexec/openjdk.jdk/Contents/Home"
                    .to_string()
            )
        );
    }

    /// L4 回归：`key=value`（无空格）与多余空白形态都要能解析 —— 旧实现只认
    /// `java.home =`，形态一变即静默取空 → JAVA_HOME 不注入。
    #[test]
    fn parse_java_home_accepts_whitespace_variants() {
        let expected = Some("/p/jdk".to_string());
        assert_eq!(parse_java_home("java.home=/p/jdk\n"), expected);
        assert_eq!(parse_java_home("  java.home   =   /p/jdk  \n"), expected);
        assert_eq!(parse_java_home("\tjava.home\t=\t/p/jdk\n"), expected);
        // CRLF（Windows 输出）不得把 \r 带进值里
        assert_eq!(parse_java_home("java.home = /p/jdk\r\n"), expected);
    }

    /// 值带成对引号时剥离（防御手工粘贴/包装脚本改写）。
    #[test]
    fn parse_java_home_strips_surrounding_quotes() {
        assert_eq!(
            parse_java_home("java.home = \"/Applications/Java 21.jdk/Contents/Home\"\n"),
            Some("/Applications/Java 21.jdk/Contents/Home".to_string())
        );
        // 只有单侧引号 → 原样保留（不猜语义）
        assert_eq!(
            parse_java_home("java.home = \"/p/jdk\n"),
            Some("\"/p/jdk".to_string())
        );
    }

    /// 只认完整键名：`java.home.xxx` 前缀相似键、值中出现 `java.home` 的行都不命中。
    #[test]
    fn parse_java_home_requires_exact_key() {
        assert_eq!(parse_java_home("java.home.extra = /p/jdk\n"), None);
        assert_eq!(parse_java_home("some.prop = java.home = /p/jdk\n"), None);
        // 非匹配行在前时仍应继续查找
        assert_eq!(
            parse_java_home("java.version=21\njava.home=/p/jdk\n"),
            Some("/p/jdk".to_string())
        );
        // 值含 `=` 时按首个 `=` 切分且完整取值
        assert_eq!(
            parse_java_home("java.home = /p/a=b/jdk\n"),
            Some("/p/a=b/jdk".to_string())
        );
    }

    #[test]
    fn parse_java_home_returns_none_when_absent() {
        assert_eq!(parse_java_home("openjdk version \"21\"\n"), None);
        assert_eq!(parse_java_home("java.home =\n"), None);
        assert_eq!(parse_java_home(""), None);
    }

    /// 收集模式：stdout/stderr 分离且**字节保真**（统一内核由 `read_to_end` 改为
    /// 逐行泵后，必须仍按原样含换行符）。
    #[test]
    #[cfg(unix)]
    fn run_command_blocking_collects_stdout_and_stderr_verbatim() {
        let (code, out, err) = run_command_blocking(
            &ExecTarget::Local,
            "sh",
            &["-c", "echo out; echo err 1>&2; exit 7"],
            std::time::Duration::from_secs(5),
        )
        .expect("run_command_blocking");
        assert_eq!(code, 7);
        assert_eq!(out, "out\n");
        assert_eq!(err, "err\n");
    }

    /// 转发模式：逐行回调（trim 尾）拿到输出，返回退出码；与收集模式共用同一内核。
    #[test]
    #[cfg(unix)]
    fn run_command_streaming_forwards_lines_and_returns_exit_code() {
        let lines = Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = Arc::clone(&lines);
        let code = run_command_streaming(
            &ExecTarget::Local,
            "sh",
            &["-c", "echo one; echo two; exit 3"],
            move |line| sink.lock().expect("lock").push(line.to_string()),
        )
        .expect("run_command_streaming");
        assert_eq!(code, 3);
        assert_eq!(*lines.lock().expect("lock"), vec!["one", "two"]);
    }

    #[test]
    fn run_command_blocking_times_out_and_kills_child() {
        let started = std::time::Instant::now();
        let result = run_command_blocking(
            &ExecTarget::Local,
            "sh",
            &["-c", "sleep 30"],
            std::time::Duration::from_millis(300),
        );
        assert!(result.is_err(), "expected timeout error, got {result:?}");
        assert!(
            started.elapsed() < std::time::Duration::from_secs(10),
            "timeout did not bound the wait"
        );
    }

    /// 缓存容器必须按环境隔离：写入本地与 WSL 两个键后互不覆盖。
    /// （直接验证容器契约，不触发 `java` 探测，避免依赖宿主是否装有 JDK。）
    #[test]
    fn java_home_cache_is_keyed_per_environment() {
        let local = ExecTarget::Local.cache_key();
        let wsl = ExecTarget::Wsl {
            distro: "Ubuntu-22.04".into(),
        }
        .cache_key();
        assert_ne!(local, wsl, "不同环境必须产出不同缓存键");

        {
            let mut guard = JAVA_HOME_CACHE.lock().expect("cache lock");
            guard.clear();
            guard.insert(local.clone(), Some("/local/jdk".into()));
            guard.insert(wsl.clone(), Some("/wsl/jdk".into()));
        }
        {
            let guard = JAVA_HOME_CACHE.lock().expect("cache lock");
            assert_eq!(
                guard.get(&local).cloned().flatten().as_deref(),
                Some("/local/jdk"),
                "本地缓存不得被 WSL 结果覆盖"
            );
            assert_eq!(
                guard.get(&wsl).cloned().flatten().as_deref(),
                Some("/wsl/jdk")
            );
        }
        JAVA_HOME_CACHE.lock().expect("cache lock").clear();
    }
}

impl LspProcess {
    /// Take ownership of stdio handles (for reader/writer threads).
    #[allow(clippy::type_complexity)]
    pub fn take_stdio(
        &mut self,
    ) -> Result<
        (
            Box<dyn Write + Send>,
            Box<dyn Read + Send>,
            Box<dyn Read + Send>,
        ),
        String,
    > {
        let stdin = self
            .stdin
            .take()
            .ok_or_else(|| "LSP stdin already taken".to_string())?;
        let stdout = self
            .stdout
            .take()
            .ok_or_else(|| "LSP stdout already taken".to_string())?;
        let stderr = self
            .stderr
            .take()
            .ok_or_else(|| "LSP stderr already taken".to_string())?;
        Ok((stdin, stdout, stderr))
    }

    /// Kill the language server process (best-effort).
    pub fn kill(&mut self) {
        if let Some(kill) = self.kill.take() {
            kill();
        }
    }
}

impl Drop for LspProcess {
    fn drop(&mut self) {
        self.kill();
    }
}

/// Spawn an LSP server in `target` with optional project working directory.
///
/// Runs on a dedicated OS thread with its own Tokio runtime so it is safe to
/// call from *any* context — including async Tauri commands (where
/// `Handle::block_on` would panic with "cannot start a runtime from within a
/// runtime").
pub fn spawn_lsp_process(
    target: &ExecTarget,
    cmd: &str,
    args: &[&str],
    current_dir: Option<&str>,
    env: &[(&str, &str)],
) -> Result<LspProcess, String> {
    let target = target.clone();
    let cmd = cmd.to_string();
    let args = args.iter().copied().map(String::from).collect::<Vec<_>>();
    let current_dir = current_dir.map(String::from);
    let env = env
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect::<Vec<_>>();
    blocking_thread(move || {
        let runtime = AppRuntime::from_tauri();
        let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
        let env_ref: Vec<(&str, &str)> =
            env.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        runtime.handle().block_on(spawn_lsp_process_async(
            &target,
            &cmd,
            &args_ref,
            current_dir.as_deref(),
            &env_ref,
        ))
    })
}

async fn spawn_lsp_process_async(
    target: &ExecTarget,
    cmd: &str,
    args: &[&str],
    current_dir: Option<&str>,
    env: &[(&str, &str)],
) -> Result<LspProcess, String> {
    // 声明 kill_tree：LSP 服务器常为包装器脚本 + 服务进程（jdtls → JVM），
    // 杀包装器必须连带清理后代，否则孤儿持 workspace 锁。
    let opts = SpawnOptions::new(cmd, args)
        .with_current_dir_if(current_dir)
        .with_env(env)
        .with_kill_tree();
    let child = create_executor(target)
        .spawn_with(opts)
        .await
        .map_err(|e| format!("Failed to spawn LSP process: {e}"))?;

    bridge_exec_child(child).await
}

async fn bridge_exec_child(mut child: ExecChild) -> Result<LspProcess, String> {
    let pid = child.pid;
    let (async_stdin, async_stdout, async_stderr) = child.take_stdio();
    let mut async_stdin = async_stdin.ok_or_else(|| "LSP process has no stdin".to_string())?;
    let mut async_stdout = async_stdout.ok_or_else(|| "LSP process has no stdout".to_string())?;
    let mut async_stderr = async_stderr.ok_or_else(|| "LSP process has no stderr".to_string())?;
    let (wait, kill_fn) = child.into_wait_and_kill();

    let (in_tx, mut in_rx) = tokio_mpsc::unbounded_channel::<Vec<u8>>();
    let (out_tx, out_rx) = mpsc::channel::<Vec<u8>>();
    let (err_tx, err_rx) = mpsc::channel::<Vec<u8>>();
    let (kill_tx, kill_rx) = tokio::sync::oneshot::channel::<()>();

    // stdin: sync writer → async process
    tokio::spawn(async move {
        while let Some(chunk) = in_rx.recv().await {
            if async_stdin.write_all(&chunk).await.is_err() {
                break;
            }
            let _ = async_stdin.flush().await;
        }
    });

    // stdout: async process → sync reader
    tokio::spawn(async move {
        let mut buf = vec![0u8; 16 * 1024];
        loop {
            match async_stdout.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    if out_tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // stderr
    tokio::spawn(async move {
        let mut buf = vec![0u8; 8 * 1024];
        loop {
            match async_stderr.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    if err_tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // lifecycle: kill signal or natural exit
    let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();
    tokio::spawn(async move {
        tokio::select! {
            _ = kill_rx => {
                let _ = kill_fn().await;
            }
            _ = wait => {}
        }
        let _ = done_tx.send(());
    });

    let kill = Box::new(move || {
        let _ = kill_tx.send(());
        // Best-effort wait so pipes drain (avoid zombies on local/WSL).
        let _ = done_rx.recv_timeout(std::time::Duration::from_secs(2));
    });

    Ok(LspProcess {
        stdin: Some(Box::new(ChannelWriter { tx: in_tx })),
        stdout: Some(Box::new(ChannelReader::new(out_rx))),
        stderr: Some(Box::new(ChannelReader::new(err_rx))),
        kill: Some(kill),
        pid,
    })
}

// ── Sync adapters ───────────────────────────────────────────────────────

struct ChannelWriter {
    tx: tokio_mpsc::UnboundedSender<Vec<u8>>,
}

impl Write for ChannelWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.tx
            .send(buf.to_vec())
            .map_err(|e| io::Error::new(io::ErrorKind::BrokenPipe, e))?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

struct ChannelReader {
    rx: mpsc::Receiver<Vec<u8>>,
    buf: VecDeque<u8>,
    eof: bool,
}

impl ChannelReader {
    const fn new(rx: mpsc::Receiver<Vec<u8>>) -> Self {
        Self {
            rx,
            buf: VecDeque::new(),
            eof: false,
        }
    }
}

impl Read for ChannelReader {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        while self.buf.is_empty() && !self.eof {
            match self.rx.recv() {
                Ok(chunk) => {
                    self.buf.extend(chunk);
                }
                Err(_) => {
                    self.eof = true;
                }
            }
        }
        if self.buf.is_empty() {
            return Ok(0);
        }
        let n = out.len().min(self.buf.len());
        for (i, b) in self.buf.drain(..n).enumerate() {
            out[i] = b;
        }
        Ok(n)
    }
}

/// 输出行回调（`None` = 只收集、不转发）。
type LineCallback = Box<dyn FnMut(&str) + Send>;

/// 输出行回调的共享句柄（`capture = false` 时由 `run_command_core` 写入；
/// 无转发需求时内部填 no-op 实现，保持泵逻辑单一）。
type LineSink = Arc<parking_lot::Mutex<LineCallback>>;

/// 一次命令运行的产出。**转发模式**（`capture = false`）下 `stdout`/`stderr`
/// 恒为空 —— 调用方只要退出码。
pub struct CommandRun {
    /// 进程退出码。
    pub exit_code: i32,
    /// 完整 stdout（转发模式下恒为空）。
    pub stdout: String,
    /// 完整 stderr（转发模式下恒为空）。
    pub stderr: String,
}

/// 命令运行内核 —— [`run_command_blocking`] 与 [`run_command_streaming`] 的
/// **唯一实现**（此前两者各自 spawn/泵/wait，超时+组杀只修在一边）。
///
/// 专用 OS 线程 + 独立 Tokio runtime（[`blocking_thread`]；**禁止在 async driver
/// 线程直调**）→ 经 [`crate::core::exec`] facade spawn → 并发泵 stdout/stderr → wait。
/// `timeout` 到期按**进程组**杀（`apply_child_flags` 已让子进程自成一组），包装器
/// 脚本拉起的后代一并清理，不留孤儿。
///
/// 输出消费：
/// - `capture = true`：逐行累加全文（按行原样拼接，字节保真），返回 stdout/stderr；
/// - `capture = false`：不保留全文（安装类命令输出量大，累积无意义），仅经
///   `on_line` 逐行转发。
fn run_command_core(
    target: &ExecTarget,
    cmd: &str,
    args: &[&str],
    timeout: Option<std::time::Duration>,
    capture: bool,
    on_line: Option<LineCallback>,
) -> Result<CommandRun, String> {
    let target = target.clone();
    let cmd = cmd.to_string();
    let args = args.iter().copied().map(String::from).collect::<Vec<_>>();
    blocking_thread(move || {
        let runtime = AppRuntime::from_tauri();
        let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
        runtime.handle().block_on(async move {
            /// 逐行泵：转发（trim 尾后的非空行）+（capture 时）累加原行。
            async fn pump(
                reader: BoxAsyncRead,
                acc: Arc<parking_lot::Mutex<String>>,
                capture: bool,
                sink: LineSink,
            ) {
                let mut reader = BufReader::new(reader);
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line).await {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            let trimmed = line.trim_end();
                            if !trimmed.is_empty() {
                                sink.lock()(trimmed);
                            }
                            if capture {
                                acc.lock().push_str(&line);
                            }
                        }
                    }
                }
            }

            let mut child = crate::core::exec::spawn(&target, &cmd, &args_ref)
                .await
                .map_err(|e| e.to_string())?;
            drop(child.stdin.take());
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| "command has no stdout".to_string())?;
            let stderr = child
                .stderr
                .take()
                .ok_or_else(|| "command has no stderr".to_string())?;
            let (wait, kill_fn) = child.into_wait_and_kill();

            let sink: LineSink = Arc::new(parking_lot::Mutex::new(
                on_line.unwrap_or_else(|| Box::new(|_| {})),
            ));
            let out_acc = Arc::new(parking_lot::Mutex::new(String::new()));
            let err_acc = Arc::new(parking_lot::Mutex::new(String::new()));

            let work = {
                let (out, err) = (Arc::clone(&out_acc), Arc::clone(&err_acc));
                let (sink_out, sink_err) = (Arc::clone(&sink), Arc::clone(&sink));
                async move {
                    let (_, _, code) = tokio::try_join!(
                        async {
                            pump(stdout, out, capture, sink_out).await;
                            Ok::<_, String>(())
                        },
                        async {
                            pump(stderr, err, capture, sink_err).await;
                            Ok::<_, String>(())
                        },
                        async { wait.await.map_err(|e| e.to_string()) },
                    )?;
                    Ok::<i32, String>(code)
                }
            };

            let exit_code = match timeout {
                Some(t) => match tokio::time::timeout(t, work).await {
                    Ok(res) => res?,
                    Err(_) => {
                        // 超时：按进程组杀（含后代）——包装器脚本拉起的服务进程一并清理。
                        let _ = (kill_fn)().await;
                        return Err(format!("command '{cmd}' timed out after {t:?}"));
                    }
                },
                None => work.await?,
            };

            let (stdout, stderr) = if capture {
                (out_acc.lock().clone(), err_acc.lock().clone())
            } else {
                (String::new(), String::new())
            };
            Ok(CommandRun {
                exit_code,
                stdout,
                stderr,
            })
        })
    })
}

/// Run a command in `target` and collect its output, giving up after `timeout`
/// （子进程按**进程组**杀，含其后代，不留孤儿）。
///
/// 动机：`LspSession::new` 用它探测 `<server> --version`，而 jdtls 的 `--version`
/// 会启动完整 OSGi JVM 且并发探测会在 data 目录锁上互相挂死 —— 无超时它会永久
/// 阻塞会话创建。
pub fn run_command_blocking(
    target: &ExecTarget,
    cmd: &str,
    args: &[&str],
    timeout: std::time::Duration,
) -> Result<(i32, String, String), String> {
    run_command_core(target, cmd, args, Some(timeout), true, None)
        .map(|run| (run.exit_code, run.stdout, run.stderr))
}

/// 流式执行命令：逐行把 stdout/stderr（trim 尾后非空行）转发给 `on_line`，
/// 返回 exit code。日志的累加/节流由调用方负责（安装进度用 `InstallLog`）；
/// 输出**不保留全文**。无超时（安装可能长时间下载）。
///
/// 线程/运行时约定与 [`run_command_blocking`] 完全一致（同一 [`run_command_core`]）。
pub(crate) fn run_command_streaming(
    target: &ExecTarget,
    cmd: &str,
    args: &[&str],
    on_line: impl FnMut(&str) + Send + 'static,
) -> Result<i32, String> {
    run_command_core(target, cmd, args, None, false, Some(Box::new(on_line))).map(|r| r.exit_code)
}

/// Run `func` on a dedicated OS thread with a fresh Tokio runtime, returning
/// its result via a channel. This avoids "cannot start a runtime from within a
/// runtime" panics when the caller is itself on a Tokio runtime thread (e.g.
/// an async Tauri command).
pub(crate) fn blocking_thread<F, R>(func: F) -> Result<R, String>
where
    F: FnOnce() -> Result<R, String> + Send + 'static,
    R: Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(func());
    });
    rx.recv()
        .map_err(|e| format!("blocking thread recv error: {e}"))?
}
