// ─── PTY Pipeline Services ────────────────────────────────────────────────
//
// Pure business logic extracted from mod.rs. Contains all PTY orchestration
// functions, process management, and shell resolution.
//
// Types still live in mod.rs (PtyHandle, PipelineConfig, etc.) because they
// are closely coupled to TerminalManager.

use anyhow::Result;
use portable_pty::{native_pty_system, Child, CommandBuilder, PtyPair, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Emitter, EventId, Listener};

use super::{PipelineConfig, PtyHandle};

// ─── Pipeline Orchestration ───────────────────────────────────────────────

/// Spawn the full PTY pipeline: reader, writer, watcher threads and emit
/// the initial session state.
pub(super) fn spawn_pty_pipeline(
    id: &str,
    pair: PtyPair,
    child: Box<dyn Child + Send + Sync>,
    config: &PipelineConfig,
    sessions: &Arc<Mutex<HashMap<String, crate::common::terminal::types::TerminalSession>>>,
    pty_handles: &Arc<Mutex<HashMap<String, PtyHandle>>>,
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

    let input_listener_id = spawn_writer_listener(id, writer, app_handle, config.prefix);

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

    spawn_watcher_thread(id, config, pty_handles, sessions, app_handle)?;
    spawn_reader_thread(id, reader, config, app_handle)?;

    log_info(&format!("{} Session {} ready", config.prefix, &id[..8]));
    Ok(session)
}

/// Listen for terminal-input-{id} events and write data to the PTY.
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
        &format!("terminal-input-{}", id),
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

/// Spawn a watcher thread that polls the child process exit status every 100ms.
/// When the child exits, clean up the PTY handle, remove the session, and emit
/// a `terminal-closed-{id}` event.
fn spawn_watcher_thread(
    id: &str,
    config: &PipelineConfig,
    pty_handles: &Arc<Mutex<HashMap<String, PtyHandle>>>,
    sessions: &Arc<Mutex<HashMap<String, crate::common::terminal::types::TerminalSession>>>,
    app_handle: &tauri::AppHandle,
) -> Result<()> {
    let watch_id = id.to_string();
    let watch_pty_handles = pty_handles.clone();
    let watch_sessions = sessions.clone();
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
                    let close_event = format!("terminal-closed-{}", watch_id);
                    if let Err(e) = watch_handle.emit(
                        &close_event,
                        super::TerminalClosedPayload { exit_code: code },
                    ) {
                        log_error(&format!(
                            "{}-WATCHER Failed to emit close event: {}",
                            prefix_w, e
                        ));
                    }
                    return;
                }

                thread::sleep(Duration::from_millis(100));
            }
        })?;

    Ok(())
}

/// Spawn a reader thread that reads PTY output and emits `terminal-output-{id}`
/// events for the frontend.
fn spawn_reader_thread(
    id: &str,
    reader: Box<dyn Read + Send>,
    config: &PipelineConfig,
    app_handle: &tauri::AppHandle,
) -> Result<()> {
    let read_id = id.to_string();
    let read_handle = app_handle.clone();
    let prefix = config.prefix.to_string();
    let mut reader = reader;

    thread::Builder::new()
        .name(format!("{}-reader-{}", config.thread_prefix, &id[..8]))
        .spawn(move || {
            log_info(&format!(
                "{}-READER Thread started for {}",
                prefix,
                &read_id[..8]
            ));
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        log_info(&format!("{}-READER EOF", prefix));
                        break;
                    }
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        let event_name = format!("terminal-output-{}", read_id);
                        if let Err(e) = read_handle.emit(&event_name, &data) {
                            log_error(&format!("{}-READER Emit error: {}", prefix, e));
                            break;
                        }
                    }
                    Err(e) => {
                        log_info(&format!("{}-READER Read ended: {}", prefix, e));
                        break;
                    }
                }
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
    graceful_kill(&mut *handle.child);
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
