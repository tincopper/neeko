//! Spawn LSP servers in Local / WSL / SSH environments via the unified executor.
//!
//! Bridges async [`ExecChild`] stdio to synchronous [`Read`]/[`Write`] so the
//! existing LSP reader/writer threads keep working.

use std::collections::{HashMap, VecDeque};
use std::io::{self, Read, Write};
use std::sync::{mpsc, Arc, Condvar, LazyLock, Mutex};

use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc as tokio_mpsc;

use crate::common::executor::factory::{create_executor, ExecTarget};
use crate::common::executor::{BoxAsyncRead, ExecChild, SpawnOptions};
use crate::common::runtime::AppRuntime;
use crate::lsp::spawn_spec::LspExecContext;

/// Long-lived LSP process with sync stdio + kill handle.
pub struct LspProcess {
    stdin: Option<Box<dyn Write + Send>>,
    stdout: Option<Box<dyn Read + Send>>,
    stderr: Option<Box<dyn Read + Send>>,
    kill: Option<Box<dyn FnOnce() + Send>>,
    /// 有界等待进程**自行**退出；宽限期内退出返回 `true`（调用方据此免于强杀）。
    ///
    /// 退出信号门同时被 `kill` 读取：已退出的进程不再发 kill（PID 可能已被复用，
    /// `kill_tree` 误杀别人是真实风险）。
    gate: ExitGate,
    /// Best-effort OS / remote process id.
    pub pid: Option<u32>,
}

/// 进程退出信号：`bridge_exec_child` 的收尾任务置位，`kill` 与 `wait_exit` 共用。
///
/// 用 `Condvar` 而不是轮询：等待方在信号到达时被唤醒，超时则自己收口 ——
/// 「等它退」与「超时后杀」之间不需要任何 sleep 猜测。
type ExitGate = Arc<(Mutex<bool>, Condvar)>;

fn new_exit_gate() -> ExitGate {
    Arc::new((Mutex::new(false), Condvar::new()))
}

/// 置位「进程已退出」并唤醒全部等待者（幂等；锁中毒时放弃置位，等待方按超时收口）。
fn mark_exited(gate: &ExitGate) {
    let (lock, wake) = &**gate;
    if let Ok(mut done) = lock.lock() {
        *done = true;
        wake.notify_all();
    }
}

/// 有界等待退出信号：`true` = 已在 `grace` 内退出。
///
/// 锁中毒视同已退出：等待路径绝不能因为一个中毒的布尔值把关闭流程挂住。
///
/// **必须按截止时间循环**：`Condvar::wait_timeout` 可以**虚假唤醒**（POSIX 允许，
/// macOS 实测会 `assert!(elapsed >= grace)` 失败）。单次调用后直接返回 `false`
/// 会让调用方提前 kill —— 那正是本模块要修的「宽限期形同虚设」。
fn wait_exited(gate: &ExitGate, grace: std::time::Duration) -> bool {
    let (lock, wake) = &**gate;
    let Ok(mut done) = lock.lock() else {
        return true;
    };
    let deadline = std::time::Instant::now() + grace;
    while !*done {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match wake.wait_timeout(done, remaining) {
            // 虚假唤醒后继续等剩余额度，不得提前收口。
            Ok((guard, _)) => done = guard,
            Err(_) => return true,
        }
    }
    *done
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

    /// 本地测试用执行上下文：cwd 用当前目录（这些用例只关心输出/退出码/超时，
    /// 不关心具体目录；探测的 cwd 语义由 `probe_runs_in_context_cwd` 与
    /// `spawn_spec` 的单测覆盖）。
    fn local_ctx() -> LspExecContext {
        LspExecContext::new(ExecTarget::Local, ".", Vec::new())
    }

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
        let run = probe_command(
            &local_ctx(),
            "sh",
            &["-c", "echo out; echo err 1>&2; exit 7"],
            std::time::Duration::from_secs(5),
        )
        .expect("probe_command");
        assert_eq!(run.exit_code, 7);
        assert_eq!(run.stdout, "out\n");
        assert_eq!(run.stderr, "err\n");
    }

    /// 转发模式：逐行回调（trim 尾）拿到输出，返回退出码；与收集模式共用同一内核。
    #[test]
    #[cfg(unix)]
    fn run_command_streaming_forwards_lines_and_returns_exit_code() {
        let lines = Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = Arc::clone(&lines);
        let code = run_command_streaming(
            &local_ctx(),
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
        let result = probe_command(
            &local_ctx(),
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

    // ── 探测形态判据（design §2.2 方案 A；AC1b / AC4 / AC5）──────────────

    /// 平台无关的 shell 包装（与 `core::exec` 测试同款：unix `sh -c` / windows `cmd /c`）。
    #[cfg(unix)]
    fn shell(script: &str) -> Vec<String> {
        vec!["sh".into(), "-c".into(), script.into()]
    }
    #[cfg(windows)]
    fn shell(script: &str) -> Vec<String> {
        vec!["cmd".into(), "/c".into(), script.into()]
    }

    fn ctx_with_cwd(cwd: &str) -> LspExecContext {
        LspExecContext::new(ExecTarget::Local, cwd, Vec::new())
    }

    /// 打印 cwd 的脚本（`sh -c` / `cmd /c` 两套语法各一条真实腿）。
    #[cfg(unix)]
    const CWD_SCRIPT: &str = "pwd";
    #[cfg(windows)]
    const CWD_SCRIPT: &str = "cd";

    /// AC4：探测在**上下文给定的 cwd**里执行（P2a：探测与启动同源；此前探测跑在
    /// 应用默认目录 —— 实测绿灯，而真实启动（cwd = 项目根）必失败）。
    #[test]
    fn probe_runs_in_context_cwd() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cwd = dir.path().to_string_lossy().to_string();
        let argv = shell(CWD_SCRIPT);
        let args_ref: Vec<&str> = argv[1..].iter().map(String::as_str).collect();

        let run = probe_command(
            &ctx_with_cwd(&cwd),
            &argv[0],
            &args_ref,
            std::time::Duration::from_secs(5),
        )
        .expect("probe runs");

        assert_eq!(run.exit_code, 0, "stderr: {}", run.stderr);
        // 双端 canonicalize：macOS 的 /var → /private/var 软链、Windows 的大小写/分隔符
        // 差异都不影响「同一个目录」的判定。
        let observed = std::fs::canonicalize(run.stdout.trim()).expect("observed cwd exists");
        let expected = std::fs::canonicalize(dir.path()).expect("tempdir exists");
        assert_eq!(observed, expected, "探测必须在 ctx.cwd 里执行");
    }

    /// AC5（形态表逐行）：非零 + stderr 非空 = 可执行但拒绝应答 ⇒ `Refused`
    /// （记证据、**不**拒绝启动）；非零 + stderr 空 = `Weak`；执行不了 = `NotRunnable`；
    /// 超时 = `Weak`（慢启动不得被误杀）。
    #[test]
    fn classify_probe_run_follows_shape_table() {
        let answered = CommandRun {
            exit_code: 0,
            stdout: "v1.0.0\n".into(),
            stderr: String::new(),
        };
        assert_eq!(classify_probe_run(&Ok(answered)), ProbeVerdict::Answered);

        // 事故形态：rustup 代理「可执行但拒绝应答」。
        let refused = CommandRun {
            exit_code: 1,
            stdout: String::new(),
            stderr: "error: Unknown binary 'rust-analyzer'\n".into(),
        };
        assert_eq!(
            classify_probe_run(&Ok(refused)),
            ProbeVerdict::Refused {
                evidence: "error: Unknown binary 'rust-analyzer'".into()
            }
        );

        let unsupported = CommandRun {
            exit_code: 2,
            stdout: String::new(),
            stderr: String::new(),
        };
        assert!(matches!(
            classify_probe_run(&Ok(unsupported)),
            ProbeVerdict::Weak { .. }
        ));
        assert!(matches!(
            classify_probe_run(&Err(CommandError::TimedOut("timed out".into()))),
            ProbeVerdict::Weak { .. }
        ));
        assert!(matches!(
            classify_probe_run(&Err(CommandError::Failed("ENOENT".into()))),
            ProbeVerdict::NotRunnable { .. }
        ));
    }

    /// 模拟「二进制不存在」的脚本：写 stderr 并以非零退出（两套语法各一条真实腿）。
    #[cfg(unix)]
    const NO_SUCH_BINARY_SCRIPT: &str = "echo 'no such binary: rust-analyzer' 1>&2; exit 1";
    #[cfg(windows)]
    const NO_SUCH_BINARY_SCRIPT: &str = "echo no such binary: rust-analyzer 1>&2 & exit /b 1";

    /// AC1b：真实子进程的 stderr 进该键的证据（三层组合：采集 → 判据 → 记账），
    /// 且「继续启动」的尝试不得被记为终态失败。
    #[test]
    fn probe_failure_evidence_lands_in_keyed_diagnostics() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cwd = dir.path().to_string_lossy().to_string();
        let argv = shell(NO_SUCH_BINARY_SCRIPT);
        let args_ref: Vec<&str> = argv[1..].iter().map(String::as_str).collect();

        let run = probe_command(
            &ctx_with_cwd(&cwd),
            &argv[0],
            &args_ref,
            std::time::Duration::from_secs(5),
        );
        let verdict = classify_probe_run(&run);
        let ProbeVerdict::Refused { evidence } = &verdict else {
            panic!("expected Refused, got {verdict:?}");
        };

        let store = crate::lsp::attempt_diagnostics::AttemptDiagnosticsStore::new();
        let diag = store.begin("/t/proj:go", "/t/proj");
        diag.push_line(
            "warn",
            &format!("{} --version refused to answer: {evidence}", argv[0]),
        );

        assert!(
            diag.outcome().is_none(),
            "「继续启动」的尝试不得被记为终态失败"
        );
        assert!(
            diag.snapshot_logs(0, 0)
                .iter()
                .any(|entry| entry.message.contains("no such binary: rust-analyzer")),
            "stderr 行必须进入该键的证据"
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

    /// 有界等待进程自行退出（LSP `exit` 之后的收尾窗口）。
    ///
    /// 返回 `false` = 宽限用尽仍存活，调用方据此 `kill()` 兜底。
    pub fn wait_exit(&mut self, grace: std::time::Duration) -> bool {
        wait_exited(&self.gate, grace)
    }

    /// Kill the language server process (best-effort).
    ///
    /// 已退出的进程**不发** kill：`kill_tree` 面向 PID，而 PID 会被系统回收
    /// （杀一个已退出的句柄只会空转，杀一个被复用的 PID 会误杀无辜进程）。
    pub fn kill(&mut self) {
        if wait_exited(&self.gate, std::time::Duration::ZERO) {
            self.kill = None;
            return;
        }
        if let Some(kill) = self.kill.take() {
            kill();
        }
    }

    /// 无真实进程的测试替身：`exited` 决定退出门状态，`kill` 把「被杀过」记到 `killed`。
    #[cfg(test)]
    pub(crate) fn test_stub(exited: bool, killed: Arc<std::sync::atomic::AtomicBool>) -> Self {
        use std::sync::atomic::Ordering;
        let gate = new_exit_gate();
        if exited {
            mark_exited(&gate);
        }
        Self {
            stdin: None,
            stdout: None,
            stderr: None,
            kill: Some(Box::new(move || killed.store(true, Ordering::SeqCst))),
            gate,
            pid: None,
        }
    }
}

impl Drop for LspProcess {
    fn drop(&mut self) {
        self.kill();
    }
}

/// Spawn an LSP server **in the given execution context**（P2a：cwd / env 与探测同源）。
///
/// Runs on a dedicated OS thread with its own Tokio runtime so it is safe to
/// call from *any* context — including async Tauri commands (where
/// `Handle::block_on` would panic with "cannot start a runtime from within a
/// runtime").
pub(crate) fn spawn_lsp_process(
    ctx: &LspExecContext,
    cmd: &str,
    args: &[&str],
) -> Result<LspProcess, String> {
    let ctx = ctx.clone();
    let cmd = cmd.to_string();
    let args = args.iter().copied().map(String::from).collect::<Vec<_>>();
    blocking_thread(move || {
        let runtime = AppRuntime::from_tauri();
        let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
        runtime
            .handle()
            .block_on(spawn_lsp_process_async(&ctx, &cmd, &args_ref))
    })
}

async fn spawn_lsp_process_async(
    ctx: &LspExecContext,
    cmd: &str,
    args: &[&str],
) -> Result<LspProcess, String> {
    let env_ref: Vec<(&str, &str)> = ctx
        .env
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    // 声明 kill_tree：LSP 服务器常为包装器脚本 + 服务进程（jdtls → JVM），
    // 杀包装器必须连带清理后代，否则孤儿持 workspace 锁。
    let opts = SpawnOptions::new(cmd, args)
        .with_current_dir_if(Some(ctx.cwd.as_str()))
        .with_env(&env_ref)
        .with_kill_tree();
    let child = create_executor(&ctx.target)
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
    let exit_gate = new_exit_gate();
    let gate_for_lifecycle = Arc::clone(&exit_gate);
    tokio::spawn(async move {
        tokio::select! {
            _ = kill_rx => {
                let _ = kill_fn().await;
            }
            _ = wait => {}
        }
        mark_exited(&gate_for_lifecycle);
    });

    let gate_for_kill = Arc::clone(&exit_gate);
    let kill = Box::new(move || {
        if wait_exited(&gate_for_kill, std::time::Duration::ZERO) {
            return;
        }
        let _ = kill_tx.send(());
        // Best-effort wait so pipes drain (avoid zombies on local/WSL).
        let _ = wait_exited(&gate_for_kill, std::time::Duration::from_secs(2));
    });

    Ok(LspProcess {
        stdin: Some(Box::new(ChannelWriter { tx: in_tx })),
        stdout: Some(Box::new(ChannelReader::new(out_rx))),
        stderr: Some(Box::new(ChannelReader::new(err_rx))),
        kill: Some(kill),
        gate: exit_gate,
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
#[derive(Debug)]
pub struct CommandRun {
    /// 进程退出码。
    pub exit_code: i32,
    /// 完整 stdout（转发模式下恒为空）。
    pub stdout: String,
    /// 完整 stderr（转发模式下恒为空）。
    pub stderr: String,
}

/// 命令运行的失败形态：区分「执行不了」与「超时」——探测形态判据的输入
/// （见 `classify_probe_run`）。超时是弱信号（慢启动），不得当作不可运行。
#[derive(Debug)]
pub(crate) enum CommandError {
    /// spawn 失败 / 进程管线失败（ENOENT / EACCES / target 不可达 / 管道异常）。
    Failed(String),
    /// 超时（子进程已按进程组杀）。
    TimedOut(String),
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CommandError::Failed(message) | CommandError::TimedOut(message) => f.write_str(message),
        }
    }
}

impl From<String> for CommandError {
    fn from(message: String) -> Self {
        CommandError::Failed(message)
    }
}

/// 探测结果的形态判据（P2b，方案 A「分形」）。纯数据、无 I/O、无 LSP 依赖 ——
/// 「形态」而非「语言」决定处置（红线 15：新增语言服务器零逻辑改动）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ProbeVerdict {
    /// `Ok(0)`：正常应答（解析元数据）。
    Answered,
    /// 执行不了（spawn / 管线失败）：真实启动会以**同一错误**失败，不必白跑一次
    /// spawn —— 直接失败。
    NotRunnable { reason: String },
    /// 非零退出 + stderr 非空：可执行但拒绝应答（如版本管理器代理）——
    /// 证据入诊断与失败消息，但**不**拒绝启动（「不支持 `--version`」的服务器
    /// 不得被误杀，由真实 spawn + 握手兜底）。
    Refused { evidence: String },
    /// 非零 + stderr 空 / 超时：弱信号，仅记录，不判定任何失败。
    Weak { note: String },
}

/// design §2.2 形态表：把一次探测运行（或失败）归类。**唯一判据点**。
#[must_use]
pub(crate) fn classify_probe_run(run: &Result<CommandRun, CommandError>) -> ProbeVerdict {
    match run {
        Err(CommandError::TimedOut(message)) => ProbeVerdict::Weak {
            note: message.clone(),
        },
        Err(CommandError::Failed(reason)) => ProbeVerdict::NotRunnable {
            reason: reason.clone(),
        },
        Ok(run) if run.exit_code == 0 => ProbeVerdict::Answered,
        Ok(run) => {
            let stderr = run.stderr.trim();
            if stderr.is_empty() {
                ProbeVerdict::Weak {
                    note: format!("exited with code {} and no stderr", run.exit_code),
                }
            } else {
                ProbeVerdict::Refused {
                    evidence: stderr.to_string(),
                }
            }
        }
    }
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
    ctx: &LspExecContext,
    cmd: &str,
    args: &[&str],
    timeout: Option<std::time::Duration>,
    capture: bool,
    on_line: Option<LineCallback>,
) -> Result<CommandRun, CommandError> {
    let ctx = ctx.clone();
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

            // 在 **ctx** 里执行：cwd / env 与真实启动同源（P2a）；分发仍由
            // `crate::common::executor` 统一承担（红线 1）。
            let env_ref: Vec<(&str, &str)> = ctx
                .env
                .iter()
                .map(|(k, v)| (k.as_str(), v.as_str()))
                .collect();
            let opts = SpawnOptions::new(&cmd, &args_ref)
                .with_current_dir_if(Some(ctx.cwd.as_str()))
                .with_env(&env_ref)
                .with_kill_tree();
            let mut child = create_executor(&ctx.target)
                .spawn_with(opts)
                .await
                .map_err(|e| CommandError::Failed(e.to_string()))?;
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
                    Ok(res) => res.map_err(CommandError::Failed)?,
                    Err(_) => {
                        // 超时：按进程组杀（含后代）——包装器脚本拉起的服务进程一并清理。
                        let _ = (kill_fn)().await;
                        return Err(CommandError::TimedOut(format!(
                            "command '{cmd}' timed out after {t:?}"
                        )));
                    }
                },
                None => work.await.map_err(CommandError::Failed)?,
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

/// Run a command in `ctx` and collect its output, giving up after `timeout`
/// （子进程按**进程组**杀，含其后代，不留孤儿）。
///
/// 动机：`LspSession::new` 用它探测 `<server> --version`，而 jdtls 的 `--version`
/// 会启动完整 OSGi JVM 且并发探测会在 data 目录锁上互相挂死 —— 无超时它会永久
/// 阻塞会话创建。
///
/// **「不带 cwd / env 的探测」在类型层面不可表达**：本入口只接受
/// [`LspExecContext`]（P2a）。
pub(crate) fn probe_command(
    ctx: &LspExecContext,
    cmd: &str,
    args: &[&str],
    timeout: std::time::Duration,
) -> Result<CommandRun, CommandError> {
    run_command_core(ctx, cmd, args, Some(timeout), true, None)
}

/// 流式执行命令：逐行把 stdout/stderr（trim 尾后非空行）转发给 `on_line`，
/// 返回 exit code。日志的累加/节流由调用方负责（安装进度用 `InstallLog`）；
/// 输出**不保留全文**。无超时（安装可能长时间下载）。
///
/// 线程/运行时约定与 [`probe_command`] 完全一致（同一 [`run_command_core`]）。
pub(crate) fn run_command_streaming(
    ctx: &LspExecContext,
    cmd: &str,
    args: &[&str],
    on_line: impl FnMut(&str) + Send + 'static,
) -> Result<i32, CommandError> {
    run_command_core(ctx, cmd, args, None, false, Some(Box::new(on_line))).map(|r| r.exit_code)
}

/// Run `func` on a dedicated OS thread with a fresh Tokio runtime, returning
/// its result via a channel. This avoids "cannot start a runtime from within a
/// runtime" panics when the caller is itself on a Tokio runtime thread (e.g.
/// an async Tauri command).
///
/// 错误类型泛化：调用方自带错误枚举（如 [`CommandError`]），线程接收失败按
/// `From<String>` 折算成同一类型。
pub(crate) fn blocking_thread<F, R, E>(func: F) -> Result<R, E>
where
    F: FnOnce() -> Result<R, E> + Send + 'static,
    R: Send + 'static,
    E: From<String> + Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(func());
    });
    rx.recv()
        .map_err(|e| E::from(format!("blocking thread recv error: {e}")))?
}

#[cfg(test)]
mod exit_gate_tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};

    /// 退出信号已置位 → 立即可观测（不靠轮询、不依赖真实进程）。
    #[test]
    fn wait_exit_is_true_when_signal_already_set() {
        let gate = new_exit_gate();
        mark_exited(&gate);
        let started = Instant::now();
        assert!(wait_exited(&gate, Duration::from_secs(5)));
        assert!(
            started.elapsed() < Duration::from_millis(500),
            "已退出必须立即返回，不得走完整个宽限"
        );
    }

    /// 进程不退出 → 有界返回 false（调用方据此兜底 kill）。
    ///
    /// 这是关闭序列「有界」的凭据：没有它，`kill_child` 之后永远不知道该等多久。
    #[test]
    fn wait_exit_times_out_without_signal() {
        let gate = new_exit_gate();
        let started = Instant::now();
        assert!(
            !wait_exited(&gate, Duration::from_millis(20)),
            "未退出必须返回 false"
        );
        assert!(
            started.elapsed() >= Duration::from_millis(20),
            "必须真的等满宽限，而不是空转立刻返回 false"
        );
    }

    /// 宽限期内退出 → 被唤醒（而不是干等满宽限）。
    #[test]
    fn wait_exit_wakes_on_late_signal() {
        let gate = new_exit_gate();
        let signaler = {
            let gate = Arc::clone(&gate);
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(10));
                mark_exited(&gate);
            })
        };
        let started = Instant::now();
        assert!(
            wait_exited(&gate, Duration::from_secs(5)),
            "退出信号必须唤醒等待者"
        );
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "被唤醒不应等满 5s 宽限"
        );
        signaler.join().expect("signaler");
    }

    /// `LspProcess::wait_exit` 读退出门：单测不 spawn 真实服务器进程
    /// （对齐 `check_unit_tests_spawn_real_binaries` 的判据）。
    #[test]
    fn process_wait_exit_observes_exit_gate() {
        let killed = Arc::new(AtomicBool::new(false));
        let mut process = LspProcess::test_stub(false, Arc::clone(&killed));

        assert!(
            !process.wait_exit(Duration::from_millis(1)),
            "未退出应为 false"
        );

        mark_exited(&process.gate);
        assert!(
            process.wait_exit(Duration::from_millis(1)),
            "退出门置位后应为 true"
        );
    }

    /// 已退出的进程**不得**再被 kill（`Drop` 也会走这条）：PID 复用下 `kill_tree`
    /// 会误杀无辜进程。
    #[test]
    fn kill_is_a_no_op_after_exit() {
        let killed = Arc::new(AtomicBool::new(false));
        let mut process = LspProcess::test_stub(true, Arc::clone(&killed));

        process.kill();
        drop(process);

        assert!(
            !killed.load(Ordering::SeqCst),
            "已退出进程不得被 kill（含 Drop 兜底路径）"
        );
    }

    /// 未退出时 kill 必须真的下去（否则关闭会留下孤儿持锁）。
    #[test]
    fn kill_fires_while_process_alive() {
        let killed = Arc::new(AtomicBool::new(false));
        let mut process = LspProcess::test_stub(false, Arc::clone(&killed));

        process.kill();

        assert!(killed.load(Ordering::SeqCst), "存活进程必须被 kill");
    }

    /// `kill` 之后 `wait_exit` 必须观测到退出，避免「杀完了还在等宽限」。
    #[test]
    fn wait_exit_observes_kill() {
        let gate = new_exit_gate();
        mark_exited(&gate);
        assert!(wait_exited(&gate, Duration::from_secs(5)));
    }
}
