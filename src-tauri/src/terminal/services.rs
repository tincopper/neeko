// ─── Run Root Resolution ──────────────────────────────────────────────────

/// 工作目录是否落在工作区根之内（**纯字符串**判据，宿主与远端 POSIX 形态通用）。
///
/// 判据：相等，或 `child` 以 `root` 开头且紧跟一个路径分隔符（`/` 或 `\`）——
/// 后者防止 `/repo-other` 被误判为 `/repo` 的子目录。按红线 12/8，通用层不做大小写
/// 折叠或 Unicode 归一（那会造出同一对象的第二种身份）。
#[must_use]
pub fn is_within_workspace_root(root: &str, child: &str) -> bool {
    let root = root.trim_end_matches(['/', '\\']);
    let child = child.trim_end_matches(['/', '\\']);
    if child == root {
        return true;
    }
    match child.strip_prefix(root) {
        Some(rest) => rest.starts_with('/') || rest.starts_with('\\'),
        None => false,
    }
}

/// 解析终端会话的运行根 cwd：缺省为该 Workspace 的根（`repo.root()`），可选
/// `work_dir` 覆盖（语言 runner 的模块子目录）必须落在根之内 —— 越界返回
/// `InvalidInput`，**绝不静默回落主仓**。
///
/// 两个路径都经 [`crate::common::git::CheckoutPath`] 归一（红线 8/12），因此 Local 的
/// 宿主形态与 WSL/SSH 的 POSIX 形态各自自洽。
pub async fn resolve_terminal_cwd(
    target: &crate::common::executor::factory::ExecTarget,
    workspace_root: &str,
    work_dir: Option<&str>,
) -> Result<String, crate::AppError> {
    let base = crate::common::git::CheckoutPath::resolve_async(target, workspace_root)
        .await
        .map_err(crate::AppError::from)?;
    let Some(dir) = work_dir else {
        return Ok(base.exec().to_string());
    };
    let resolved = crate::common::git::CheckoutPath::resolve_async(target, dir)
        .await
        .map_err(crate::AppError::from)?;
    if !is_within_workspace_root(base.exec(), resolved.exec()) {
        return Err(crate::AppError::InvalidInput(format!(
            "Working directory `{dir}` is outside the workspace root `{}`",
            base.exec()
        )));
    }
    Ok(resolved.exec().to_string())
}

// ─── PTY Pipeline Services ────────────────────────────────────────────────
//
// Pure business logic extracted from mod.rs. Contains all PTY orchestration
// functions, process management, and shell resolution.
//
// Types still live in mod.rs (PtyHandle, PipelineConfig, etc.) because they
// are closely coupled to TerminalManager.

use crate::common::terminal::drain::SessionDrainMap;
use crate::common::terminal::events::{terminal_closed_event, terminal_input_event};
use anyhow::Result;
use portable_pty::{native_pty_system, Child, CommandBuilder, PtyPair, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Emitter, EventId, Listener};

use super::manager::{PipelineConfig, PtyHandle, TerminalClosedPayload};

// ─── Pipeline Orchestration ───────────────────────────────────────────────

/// Spawn the full PTY pipeline: reader, writer, watcher threads and emit
/// the initial session state.
///
/// `live` 是本会话的 live-sessions 接线；登记在 `spawn_watcher_thread` **之前**
/// （顺序不变量见 `live_sessions::wiring::pty` 模块注释）。
#[allow(clippy::too_many_arguments)] // pipeline spawn: 9 deps are a stable unit, grouping adds ceremony
pub(super) fn spawn_pty_pipeline(
    id: &str,
    pair: PtyPair,
    child: Box<dyn Child + Send + Sync>,
    config: &PipelineConfig,
    sessions: &Arc<Mutex<HashMap<String, crate::common::terminal::types::TerminalSession>>>,
    pty_handles: &Arc<Mutex<HashMap<String, PtyHandle>>>,
    drains: &SessionDrainMap,
    live: Option<crate::live_sessions::wiring::pty::LiveTerminal<'_>>,
    app_handle: &tauri::AppHandle,
) -> Result<crate::common::terminal::types::TerminalSession> {
    let pid = child.process_id();
    log_info(&format!("{} Shell spawned, PID: {:?}", config.prefix, pid));

    // Windows: create a Job Object and assign the child process to it so that
    // the entire process tree is killed when we close the job handle.
    // Assignment must happen immediately after spawn — before the child has a
    // chance to fork grandchildren — to guarantee full tree coverage.
    #[cfg(windows)]
    let job_handle = {
        match child.as_raw_handle() {
            Some(raw) => match crate::common::utils::job_object::create_job_for_process(raw) {
                Ok(jh) => {
                    log_info(&format!(
                        "{} Job Object created for PID {:?}",
                        config.prefix, pid
                    ));
                    Some(jh)
                }
                Err(e) => {
                    // Non-fatal: fall back to single-process TerminateProcess.
                    log::warn!(
                        "{} Failed to create Job Object for PID {:?}: {} — \
                         child process tree may not be fully terminated on stop",
                        config.prefix,
                        pid,
                        e
                    );
                    None
                }
            },
            None => {
                log::warn!(
                    "{} Could not obtain raw handle for PID {:?} — \
                      skipping Job Object creation",
                    config.prefix,
                    pid
                );
                None
            }
        }
    };

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| anyhow::anyhow!("Failed to clone reader: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| anyhow::anyhow!("Failed to take writer: {}", e))?;

    let session = crate::common::terminal::types::TerminalSession {
        id: id.to_string(),
        pid,
        status: crate::common::terminal::types::TerminalStatus::Idle,
        history: Vec::new(),
        agent: None,
    };

    sessions
        .lock()
        .map_err(|e| anyhow::anyhow!("Lock poisoned: {}", e))?
        .insert(id.to_string(), session.clone());

    drains
        .lock()
        .map_err(|e| anyhow::anyhow!("Lock poisoned: {}", e))?
        .insert(
            id.to_string(),
            Arc::new(crate::common::terminal::drain::SessionDrain::default()),
        );

    let input_listener_id = spawn_writer_listener(id, writer, app_handle, config.prefix);

    // Unix：在 master 被 move 进 PtyHandle 之前取出 fd，交给 poll 泵
    // （及时 flush，消除交互 TUI「静默期不 flush」导致的输出延迟）。
    #[cfg(unix)]
    let master_fd = pair.master.as_raw_fd();

    pty_handles
        .lock()
        .map_err(|e| anyhow::anyhow!("Lock poisoned: {}", e))?
        .insert(
            id.to_string(),
            PtyHandle {
                master: pair.master,
                child,
                #[cfg(windows)]
                job_handle,
                input_listener_id,
                app_handle: app_handle.clone(),
            },
        );

    // live-sessions 登记：会话已在两张表里就绪、进程已存活，而退出信号的唯一生产者
    // （watcher 线程）尚未启动 —— 这是唯一不会「先 exit 后 register」的时机。
    if let Some(live) = live {
        live.register(app_handle, id);
    }

    // 活动探针：reader 线程 stamp，watcher 线程 poll（输出流动 = 在跑 / 静默 = 就绪）。
    let activity = crate::live_sessions::wiring::pty::OutputActivity::new();

    spawn_watcher_thread(
        id,
        config,
        pty_handles,
        sessions,
        drains,
        // 登记已在上方完成（早于本线程启动），线程只需要注册表句柄发退出信号。
        live.map(|live| live.shared_registry()),
        activity.clone(),
        app_handle,
    )?;
    #[cfg(unix)]
    spawn_reader_thread(id, reader, config, drains, activity, master_fd)?;
    #[cfg(not(unix))]
    spawn_reader_thread(id, reader, config, drains, activity)?;

    log_info(&format!("{} Session {} ready", config.prefix, &id[..8]));
    Ok(session)
}

/// Listen for terminal-input-{id} events and write data to the PTY.
///
/// **不在这里判定「用户开始输入」**：这条通道同时承载我们自动启动 agent 的那行命令
/// （`TerminalViewBase` 创建会话后立即写入），后端无从区分。会话标题 / has_user_input 由前端
/// 的 `set_live_session_title`（`source = prompt`）上报 —— 只有前端知道哪次写入来自用户。
fn spawn_writer_listener(
    id: &str,
    writer: Box<dyn Write + Send>,
    app_handle: &tauri::AppHandle,
    prefix: &str,
) -> EventId {
    let writer_mutex = Arc::new(Mutex::new(writer));
    let writer_clone = writer_mutex.clone();
    let prefix_owned = prefix.to_string();

    app_handle.listen(
        terminal_input_event(id),
        move |event| match serde_json::from_str::<Vec<u8>>(event.payload()) {
            Ok(data) => {
                if let Ok(mut w) = writer_clone.lock() {
                    if let Err(e) = w.write_all(&data) {
                        log_error(&format!("{}-WRITER Write error: {}", prefix_owned, e));
                    }
                }
            }
            Err(e) => {
                log_error(&format!(
                    "{}-WRITER Parse error: {} payload={}",
                    prefix_owned,
                    e,
                    event.payload()
                ));
            }
        },
    )
}

/// SSH 会话的 shell 前缀：注入会话身份、终端能力，并切到运行根。
///
/// 抽成纯函数（无 IO）以便直测；`cwd` / id 都经统一 POSIX 转义，
/// `cd` 失败立即退出，避免后续输入在错误目录执行。
#[must_use]
pub(crate) fn remote_shell_prefix(cwd: &str, session_id: &str) -> String {
    use crate::common::utils::command::local::quote_shell_arg;
    format!(
        "export {}={}; export COLORTERM=truecolor; cd {} || exit 1\n",
        crate::live_sessions::SESSION_ID_ENV,
        quote_shell_arg(session_id),
        quote_shell_arg(cwd)
    )
}

#[cfg(test)]
mod tests {
    use super::remote_shell_prefix;

    #[test]
    fn remote_shell_prefix_quotes_cwd_and_session_id() {
        let script = remote_shell_prefix("/tmp/a b'c", "sid'quote");
        assert!(script.contains("export NEEKO_SESSION_ID='sid'\\''quote';"));
        assert!(script.contains("cd '/tmp/a b'\\''c' || exit 1\n"));
    }

    #[test]
    fn remote_shell_prefix_does_not_allow_extra_commands() {
        let script = remote_shell_prefix("/tmp/x; touch /tmp/pwned", "sid");
        assert!(script.contains("cd '/tmp/x; touch /tmp/pwned' || exit 1\n"));
        assert_eq!(script.matches("touch /tmp/pwned").count(), 1);
    }
}

/// Spawn a watcher thread that polls the child process exit status every 100ms.
/// When the child exits, clean up the PTY handle, remove the session, and emit
/// a `terminal-closed-{id}` event.
// watcher 的入参是「会话的三张表 + live 接线 + 事件句柄」：都是 pipeline 已经持有的
// 借用/克隆，收进结构体只会把同一批字段再抄一遍（与 `spawn_pty_pipeline` 同口径）。
#[allow(clippy::too_many_arguments)]
fn spawn_watcher_thread(
    id: &str,
    config: &PipelineConfig,
    pty_handles: &Arc<Mutex<HashMap<String, PtyHandle>>>,
    sessions: &Arc<Mutex<HashMap<String, crate::common::terminal::types::TerminalSession>>>,
    drains: &SessionDrainMap,
    live_sessions: Option<Arc<crate::live_sessions::Registry>>,
    activity: crate::live_sessions::wiring::pty::OutputActivity,
    app_handle: &tauri::AppHandle,
) -> Result<()> {
    let watch_id = id.to_string();
    let watch_pty_handles = pty_handles.clone();
    let watch_sessions = sessions.clone();
    let watch_drains = drains.clone();
    let watch_handle = app_handle.clone();
    let prefix = config.prefix.to_string();
    let prefix_w = prefix.clone();

    thread::Builder::new()
        .name(format!("{}-watcher-{}", config.thread_prefix, &id[..8]))
        .spawn(move || {
            log_info(&format!(
                "{}-WATCHER Thread started for {}",
                prefix_w,
                &watch_id[..8]
            ));

            loop {
                // Returns Some(exit_code) when the child has exited, None when still running.
                let exit_code: Option<i32> = {
                    match watch_pty_handles.lock() {
                        Ok(mut handles) => {
                            if let Some(handle) = handles.get_mut(&watch_id) {
                                #[allow(clippy::cast_possible_wrap)]
                                match handle.child.try_wait() {
                                    Ok(Some(status)) => Some(status.exit_code() as i32),
                                    Ok(None) => None,
                                    Err(_) => Some(1), // treat poll error as failure
                                }
                            } else {
                                log_info(&format!(
                                    "{}-WATCHER Handle gone, exiting for {}",
                                    prefix_w,
                                    &watch_id[..8]
                                ));
                                return;
                            }
                        }
                        Err(_) => return,
                    }
                };

                if let Some(code) = exit_code {
                    log_info(&format!(
                        "{}-WATCHER Child exited for {} with code {}, cleaning up",
                        prefix_w,
                        &watch_id[..8],
                        code
                    ));
                    if let Ok(mut handles) = watch_pty_handles.lock() {
                        // `mut handle` is required on Windows for `job_handle.take()`
                        #[allow(unused_mut)]
                        if let Some(mut handle) = handles.remove(&watch_id) {
                            handle.app_handle.unlisten(handle.input_listener_id);
                            // On Windows: drop the Job Object before the
                            // ConPTY master so that any surviving grandchild
                            // processes (e.g. detached node workers) are
                            // terminated by JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                            // before ClosePseudoConsole runs.
                            #[cfg(windows)]
                            {
                                handle.job_handle.take();
                            } // drop job first
                            drop(handle.master);
                            drop(handle.child);
                        }
                    }
                    if let Ok(mut sessions) = watch_sessions.lock() {
                        sessions.remove(&watch_id);
                    }
                    if let Ok(mut drains) = watch_drains.lock() {
                        // 先 close 再移除（孤儿泵黑洞语义，见 take_session_handle）。
                        if let Some(d) = drains.remove(&watch_id) {
                            d.close();
                        }
                    }
                    let close_event = terminal_closed_event(&watch_id);
                    if let Err(e) =
                        watch_handle.emit(&close_event, TerminalClosedPayload { exit_code: code })
                    {
                        log_error(&format!(
                            "{}-WATCHER Failed to emit close event: {}",
                            prefix_w, e
                        ));
                    }
                    // live-sessions：退出码 → 终止态（0/无 → Stopped，非 0 → Failed），
                    // 随后注销条目。信号是唯一写入口，这里不直接改状态。
                    if let Some(registry) = live_sessions.as_deref() {
                        crate::live_sessions::wiring::pty::exit_and_notify(
                            registry,
                            &watch_handle,
                            &watch_id,
                            Some(code),
                        );
                    }
                    return;
                }

                // live-sessions：输出活动 → 运行 / 就绪。信号是唯一写入口，这里不直接改状态；
                // 状态没变时 `poll` 不 bump（100ms tick 不会变成 IPC 风暴）。
                if let Some(registry) = live_sessions.as_deref() {
                    activity.poll(registry, Some(&watch_handle), &watch_id);
                }

                thread::sleep(Duration::from_millis(100));
            }
        })?;

    Ok(())
}

/// Spawn a reader thread that coalesces PTY output through the bounded
/// [`pump::OutputPump`] into the session's [`SessionDrain`]. The frontend
/// pulls binary chunks via the `terminal_drain` command, driven by a global
/// shared poller (`createPollingDrainScheduler`, 100ms tick) — no wake-hint
/// events are emitted (方案 B 去 eval 化).
///
/// 内存治理（任务 08-25-terminal-memory-governance）：旧实现每次 4KB read 直接
/// JSON emit，事件频率等于设备吞吐频率，前端 writeBuffer 无界积压。
///
/// Unix 平台使用 `run_polling`（poll 超时 flush）：交互式 TUI 输出一批后
/// 停顿等待时，积压数据不再滞留到下一次 read/EOF，窗口内必达 —— 消除
/// 阻塞读泵的「静默期不 flush」折衷导致的终端延迟/卡顿。
fn spawn_reader_thread(
    id: &str,
    reader: Box<dyn Read + Send>,
    config: &PipelineConfig,
    drains: &crate::common::terminal::drain::SessionDrainMap,
    activity: crate::live_sessions::wiring::pty::OutputActivity,
    #[cfg(unix)] master_fd: Option<std::os::fd::RawFd>,
) -> Result<()> {
    let read_id = id.to_string();
    let prefix = config.prefix.to_string();
    let reader = reader;
    let session_drain = drains
        .lock()
        .map_err(|e| anyhow::anyhow!("Lock poisoned: {}", e))?
        .get(id)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("Drain queue missing for session {id}"))?;

    thread::Builder::new()
        .name(format!("{}-reader-{}", config.thread_prefix, &id[..8]))
        .spawn(move || {
            log_info(&format!(
                "{}-READER Thread started for {}",
                prefix,
                &read_id[..8]
            ));
            let started = std::time::Instant::now();
            // 同一 flush 语义复用于两个 pump 变体：有界推入 SessionDrain。
            // long-poll 路径经 Notify 唤醒挂起的 terminal_drain_wait；
            // 轮询降级路径 tick 即唤醒（take_drain 保持空闭包）。
            let flush = |data: &[u8]| {
                // 活动打点：只有「有字节出来」这一件事实，供 watcher 判定运行 / 就绪。
                activity.stamp();
                session_drain.push(data, || session_drain.notify_one())
            };
            #[cfg(unix)]
            let outcome = match master_fd {
                Some(fd) => {
                    super::pump::run_polling(fd, reader, &super::pump::PumpConfig::default(), flush)
                }
                None => super::pump::run(reader, &super::pump::PumpConfig::default(), flush),
            };
            #[cfg(not(unix))]
            let outcome = super::pump::run(reader, &super::pump::PumpConfig::default(), flush);
            log_info(&format!(
                "{}-READER finished for {} in {:?}: {} flushes / {} bytes / {} backpressure pauses",
                prefix,
                &read_id[..8],
                started.elapsed(),
                outcome.stats.flushes,
                outcome.stats.bytes,
                outcome.stats.backpressure_pauses,
            ));
            if let Some(e) = outcome.error {
                log_info(&format!("{}-READER Read ended: {}", prefix, e));
            }
            log_info(&format!(
                "{}-READER Thread exiting for {}",
                prefix,
                &read_id[..8]
            ));
        })?;

    Ok(())
}

// ─── PTY Handle Cleanup ───────────────────────────────────────────────────

/// Close a PTY handle, killing the child process and cleaning up resources.
/// On Windows with a Job Object, drops the Job first to kill the full process
/// tree, then waits for the direct child and closes the ConPTY master.
pub(super) fn close_pty_handle(session_id: &str, mut handle: PtyHandle) {
    handle.app_handle.unlisten(handle.input_listener_id);

    #[cfg(windows)]
    {
        if let Some(job) = handle.job_handle.take() {
            // Drop the Job Object FIRST — before closing the ConPTY master.
            //
            // Why order matters:
            //   drop(master) calls ClosePseudoConsole which lets the Windows
            //   console host kill cmd.exe.  Once cmd.exe is dead its children
            //   that have already detached from the console (e.g. a node.exe
            //   dev server using CREATE_NO_WINDOW or a fork) are no longer
            //   reachable via console teardown.  They ARE still in the Job
            //   Object, so dropping the Job kills them reliably — but only if
            //   we do it before ClosePseudoConsole triggers and the tiny window
            //   opens where detached children could theoretically survive.
            log_info(&format!(
                "[PTY] Killing process tree via Job Object for session {}",
                &session_id[..8.min(session_id.len())]
            ));
            drop(job); // ← JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE fires here
                       // Reap the direct child, then close the ConPTY.
            let _ = handle.child.wait();
            drop(handle.master);
            log_info(&format!(
                "[PTY] Session {} closed (Job Object path)",
                &session_id[..8.min(session_id.len())]
            ));
            return;
        }
        // Fallback: Job Object creation failed at spawn time — use the
        // single-process graceful_kill path below.
        log::warn!(
            "[PTY] No Job Object for session {} — falling back to single-process kill",
            &session_id[..8.min(session_id.len())]
        );
    }

    // Unix path and Windows fallback: close ConPTY first, then kill.
    drop(handle.master);
    // Snapshot the process table BEFORE killing: some tools (CLI agents,
    // language servers) call setsid() themselves and escape the process group
    // killed by graceful_kill.  The snapshot must happen while the shell is
    // still alive — once it is reaped, surviving children are reparented to
    // launchd/init and can no longer be found by the ppid chain.
    #[cfg(unix)]
    let orphans = handle
        .child
        .process_id()
        .map(|pid| super::process_reaper::collect_session_processes(pid.cast_signed()));
    graceful_kill(&mut *handle.child);
    // Reap anything that was still a descendant of (or shares a session
    // with) the shell.
    #[cfg(unix)]
    if let Some(orphans) = orphans {
        super::process_reaper::reap_session_tree(&orphans);
    }
    log_info(&format!(
        "[PTY] Session {} closed",
        &session_id[..8.min(session_id.len())]
    ));
}

// ─── PTY Creation ─────────────────────────────────────────────────────────

/// Open a new PTY pair with the given dimensions.
pub(super) fn create_pty(cols: u16, rows: u16) -> Result<PtyPair> {
    let pty_system = native_pty_system();
    pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| anyhow::anyhow!("Failed to open PTY: {}", e))
}

// ─── Shell Resolution ─────────────────────────────────────────────────────

/// Build a local shell command, respecting user-configured shell override.
pub(super) fn build_local_shell_cmd(shell_override: &Option<String>) -> CommandBuilder {
    if let Some(ref s) = shell_override {
        if !s.is_empty() {
            log_info(&format!("[PTY] Using configured shell: {}", s));
            return build_shell_cmd(s);
        }
    }
    default_shell_cmd()
}

fn build_shell_cmd(shell: &str) -> CommandBuilder {
    let name = std::path::Path::new(shell)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(shell)
        .to_lowercase();

    if name == "powershell.exe" || name == "powershell" || name == "pwsh.exe" || name == "pwsh" {
        let mut c = CommandBuilder::new(shell);
        c.arg("-ExecutionPolicy");
        c.arg("Bypass");
        c.arg("-NoLogo");
        c
    } else {
        CommandBuilder::new(shell)
    }
}

fn default_shell_cmd() -> CommandBuilder {
    if cfg!(target_os = "windows") {
        let mut c = CommandBuilder::new("powershell.exe");
        c.arg("-ExecutionPolicy");
        c.arg("Bypass");
        c.arg("-NoLogo");
        log_info("[PTY] Using default shell: powershell.exe");
        c
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| {
            if std::path::Path::new("/bin/bash").exists() {
                "/bin/bash".to_string()
            } else {
                "/bin/sh".to_string()
            }
        });
        log_info(&format!("[PTY] Using default shell: {}", shell));
        CommandBuilder::new(&shell)
    }
}

// ─── Process Management ───────────────────────────────────────────────────

const GRACEFUL_TIMEOUT_SECS: u64 = 2;

/// Gracefully kill a child process (and its process group on Unix).
/// Sends SIGTERM first, waits up to GRACEFUL_TIMEOUT_SECS, then SIGKILL.
fn graceful_kill(child: &mut dyn Child) {
    let started_at = Instant::now();
    let pid = match child.process_id() {
        Some(p) => p,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return;
        }
    };

    #[cfg(unix)]
    {
        // portable-pty calls setsid() in the child's pre_exec hook, which
        // makes the child the leader of a new session AND a new process group
        // (PGID == PID).  Sending signals to -PGID therefore reaches the
        // entire process tree (shell + any grandchildren such as node, cargo,
        // etc.) without affecting the parent Neeko process.
        #[allow(clippy::cast_possible_wrap)]
        let pgid = pid as i32;

        let sigterm_result = unsafe { libc::kill(-pgid, libc::SIGTERM) };
        if sigterm_result == 0 {
            log_info(&format!(
                "[PTY] Sent SIGTERM to process group {} (PID {})",
                pgid, pid
            ));
        } else {
            // ESRCH means the group is already gone — treat as success.
            let err = std::io::Error::last_os_error();
            if err.raw_os_error() != Some(libc::ESRCH) {
                log::warn!("[PTY] kill(-{}, SIGTERM) failed: {}", pgid, err);
            }
            let _ = child.wait();
            return;
        }

        let deadline = Instant::now() + Duration::from_secs(GRACEFUL_TIMEOUT_SECS);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => {
                    log_info(&format!(
                        "[PTY] Process group {} exited after SIGTERM in {:?}",
                        pgid,
                        started_at.elapsed()
                    ));
                    return;
                }
                Ok(None) => {
                    if Instant::now() >= deadline {
                        break;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
                Err(_) => return,
            }
        }

        log_info(&format!(
            "[PTY] Process group {} did not exit after {}s, sending SIGKILL",
            pgid, GRACEFUL_TIMEOUT_SECS
        ));
        unsafe {
            libc::kill(-pgid, libc::SIGKILL);
        }
        let _ = child.wait();
        log_info(&format!(
            "[PTY] Process group {} killed after SIGKILL in {:?}",
            pgid,
            started_at.elapsed()
        ));
    }

    #[cfg(windows)]
    {
        log_info(&format!(
            "[PTY] Waiting up to {}s for PID {} to exit gracefully",
            GRACEFUL_TIMEOUT_SECS, pid
        ));
        let deadline = Instant::now() + Duration::from_secs(GRACEFUL_TIMEOUT_SECS);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => {
                    log_info(&format!(
                        "[PTY] PID {} exited gracefully in {:?}",
                        pid,
                        started_at.elapsed()
                    ));
                    return;
                }
                Ok(None) => {
                    if Instant::now() >= deadline {
                        break;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
                Err(_) => return,
            }
        }
        log_info(&format!(
            "[PTY] PID {} did not exit after {}s, force killing",
            pid, GRACEFUL_TIMEOUT_SECS
        ));
        let _ = child.kill();
        let _ = child.wait();
        log_info(&format!(
            "[PTY] PID {} force killed in {:?}",
            pid,
            started_at.elapsed()
        ));
    }
}

// ─── Logging Helpers ──────────────────────────────────────────────────────

/// Log an info message via the `log` crate.
pub fn log_info(msg: &str) {
    log::info!("{}", msg);
}

/// Log an error message via the `log` crate.
pub fn log_error(msg: &str) {
    log::error!("{}", msg);
}

#[cfg(test)]
mod run_root_tests {
    use super::{is_within_workspace_root, resolve_terminal_cwd};
    use crate::common::executor::factory::ExecTarget;

    /// 缺省（无覆盖）= 工作区根；主仓与工作树两态同构。
    #[tokio::test]
    async fn resolve_defaults_to_workspace_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let cwd = resolve_terminal_cwd(&ExecTarget::Local, &root, None)
            .await
            .unwrap();
        // 根经 CheckoutPath 归一（macOS 临时目录是符号链接根），期望值同源推导。
        let expected = dir
            .path()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert_eq!(cwd, expected);
    }

    /// 覆盖值为根之内的子目录 → 归一后返回该子目录。
    #[tokio::test]
    async fn resolve_accepts_subdirectory_override() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("module-a");
        std::fs::create_dir_all(&sub).unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let cwd = resolve_terminal_cwd(&ExecTarget::Local, &root, Some(&sub.to_string_lossy()))
            .await
            .unwrap();
        let canonical_root = dir
            .path()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string();
        assert!(
            is_within_workspace_root(&canonical_root, &cwd),
            "cwd {cwd} 必须在根 {canonical_root} 内"
        );
    }

    /// 覆盖值落在根之外 → 显式 `InvalidInput`（不静默回落主仓）。
    #[tokio::test]
    async fn resolve_rejects_override_outside_root() {
        let root_dir = tempfile::tempdir().unwrap();
        let outside_dir = tempfile::tempdir().unwrap();
        let root = root_dir.path().to_string_lossy().to_string();
        let outside = outside_dir.path().to_string_lossy().to_string();
        let err = resolve_terminal_cwd(&ExecTarget::Local, &root, Some(&outside))
            .await
            .unwrap_err();
        assert!(
            matches!(err, crate::AppError::InvalidInput(_)),
            "越界覆盖必须 InvalidInput，实为 {err:?}"
        );
    }

    /// 纯判据：相等 / 子目录 / 前缀碰撞（`/repo-other`）/ 根尾分隔符。
    #[test]
    fn within_root_boundary_cases() {
        assert!(is_within_workspace_root("/repo", "/repo"));
        assert!(is_within_workspace_root("/repo", "/repo/mod"));
        assert!(is_within_workspace_root("/repo/", "/repo/mod"));
        assert!(!is_within_workspace_root("/repo", "/repo-other"));
        assert!(!is_within_workspace_root("/repo", "/elsewhere"));
    }
}
