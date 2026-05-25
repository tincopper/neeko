use crate::models::{TerminalSession, TerminalStatus};
use crate::theme::opencode::{
    install_wsl_theme_files, read_enable_opencode_theme_sync, read_enable_pi_theme_sync,
    write_wsl_tui_config,
};
use anyhow::Result;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtyPair, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Emitter, EventId, Listener};
use uuid::Uuid;

// ─── 数据结构 ───────────────────────────────────────────────────────

/// Payload emitted with the `terminal-closed-{id}` event.
/// `exit_code` is the raw process exit code (0 = success).
#[derive(Clone, serde::Serialize)]
struct TerminalClosedPayload {
    exit_code: i32,
}

struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// Windows only: Job Object that groups the PTY child and all of its
    /// descendants.  Dropping this handle triggers
    /// `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, which terminates the entire
    /// process tree (e.g. `node` spawned by `cmd /c npm run dev`).
    #[cfg(windows)]
    job_handle: Option<crate::utils::job_object::JobHandle>,
    input_listener_id: EventId,
    app_handle: tauri::AppHandle,
}

#[derive(Clone)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    pty_handles: Arc<Mutex<HashMap<String, PtyHandle>>>,
}

/// Pipeline 配置（区分 PTY 和 WSL）
struct PipelineConfig {
    prefix: &'static str,
    thread_prefix: &'static str,
}

const PTY_CONFIG: PipelineConfig = PipelineConfig {
    prefix: "[PTY]",
    thread_prefix: "pty",
};

const WSL_CONFIG: PipelineConfig = PipelineConfig {
    prefix: "[WSL]",
    thread_prefix: "wsl",
};

// ─── TerminalManager 实现 ────────────────────────────────────────────

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            pty_handles: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create_session(
        &self,
        project_path: &str,
        cols: u16,
        rows: u16,
        shell_override: Option<String>,
        working_dir: Option<String>,
        command: Option<String>,
        app_handle: tauri::AppHandle,
    ) -> Result<TerminalSession> {
        let id = Uuid::new_v4().to_string();
        let cwd = working_dir.as_deref().unwrap_or(project_path);
        log_info(&format!("[PTY] Session ID: {}", id));
        log_info(&format!("[PTY] Working Dir: {}", cwd));

        if !std::path::Path::new(cwd).exists() {
            return Err(anyhow::anyhow!("Working directory does not exist: {}", cwd));
        }

        // 写入 OpenCode 项目级 TUI 配置（主题同步）
        write_opencode_tui_config(cwd);

        let pair = create_pty(cols, rows)?;
        log_info(&format!("[PTY] PTY opened ({}x{})", cols, rows));

        let mut cmd = if let Some(ref task_command) = command {
            // Task mode: spawn the command directly so process exit == PTY close
            log_info(&format!("[PTY] Task command mode: {}", task_command));
            #[cfg(target_os = "windows")]
            {
                let mut c = CommandBuilder::new("cmd");
                c.args(["/c", task_command]);
                c
            }
            #[cfg(not(target_os = "windows"))]
            {
                let mut c = CommandBuilder::new("sh");
                c.args(["-c", task_command]);
                c
            }
        } else {
            // Normal shell mode (existing behaviour)
            build_local_shell_cmd(&shell_override)
        };

        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        #[cfg(unix)]
        {
            cmd.env("LANG", "en_US.UTF-8");
            cmd.env("LC_ALL", "en_US.UTF-8");
            cmd.env("LC_CTYPE", "en_US.UTF-8");
        }
        cmd.cwd(cwd);

        let child = pair.slave.spawn_command(cmd)?;

        // Note: Do NOT disable echo here - shell handles line editing
        // PTY native echo will display user input
        // This preserves Tab completion, arrow keys, and backspace on Linux

        spawn_pty_pipeline(
            &id,
            pair,
            child,
            &PTY_CONFIG,
            &self.sessions,
            &self.pty_handles,
            &app_handle,
        )
    }

    pub fn create_wsl_session(
        &self,
        distro: &str,
        project_path: &str,
        cols: u16,
        rows: u16,
        app_handle: tauri::AppHandle,
    ) -> Result<TerminalSession> {
        let id = Uuid::new_v4().to_string();
        log_info(&format!("[WSL] Session ID: {}", id));
        log_info(&format!("[WSL] Distro: {}", distro));
        log_info(&format!("[WSL] Working Dir: {}", project_path));

        // 安装 WSL 主题文件并写入项目级配置（OpenCode + Pi 主题同步）
        if let Err(e) = install_wsl_theme_files(distro) {
            log::warn!("[WSL] Failed to install OpenCode theme files: {}", e);
        }
        if let Err(e) = crate::theme::pi::install_wsl_pi_theme_files(distro) {
            log::warn!("[WSL] Failed to install Pi theme files: {}", e);
        }
        let current_theme = read_neeko_theme().unwrap_or_else(|| "dark".to_string());
        if read_enable_opencode_theme_sync() {
            if let Err(e) = write_wsl_tui_config(distro, project_path, &current_theme) {
                log::warn!("[WSL] Failed to write OpenCode tui.json: {}", e);
            }
        }
        if read_enable_pi_theme_sync() {
            if let Err(e) =
                crate::theme::pi::write_wsl_pi_settings(distro, project_path, &current_theme)
            {
                log::warn!("[WSL] Failed to write Pi settings.json: {}", e);
            }
        }

        let pair = create_pty(cols, rows)?;
        log_info(&format!("[WSL] PTY opened ({}x{})", cols, rows));

        let mut cmd = CommandBuilder::new("wsl.exe");
        cmd.arg("-d");
        cmd.arg(distro);
        cmd.arg("--cd");
        cmd.arg(project_path);
        // 通过 bash -c + exec 注入 COLORTERM=truecolor，确保变量在 WSL 内部生效。
        // wsl.exe 的 cmd.env() 不会将 Windows 侧变量传递到 Linux shell，
        // WSLENV 方式会覆盖用户已有配置，所以改用包装 bash 启动。
        // exec "$SHELL" -l 替换为用户默认 login shell，行为与直接启动一致。
        cmd.arg("--");
        cmd.arg("bash");
        cmd.arg("-c");
        cmd.arg("export COLORTERM=truecolor; exec \"${SHELL:-bash}\" -l");
        cmd.env("TERM", "xterm-256color");
        cmd.env("WSL_UTF8", "1");

        let child = pair.slave.spawn_command(cmd)?;

        spawn_pty_pipeline(
            &id,
            pair,
            child,
            &WSL_CONFIG,
            &self.sessions,
            &self.pty_handles,
            &app_handle,
        )
    }

    pub fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> Result<()> {
        let mut handles = self
            .pty_handles
            .lock()
            .map_err(|e| anyhow::anyhow!("Lock poisoned: {}", e))?;
        if let Some(handle) = handles.get_mut(session_id) {
            handle.master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })?;
            log_info(&format!(
                "[PTY] Resized {} to {}x{}",
                &session_id[..8.min(session_id.len())],
                cols,
                rows
            ));
        }
        Ok(())
    }

    pub fn close_session(&self, session_id: &str) {
        log_info(&format!(
            "[PTY] Closing session {}",
            &session_id[..8.min(session_id.len())]
        ));

        if let Some(handle) = self.take_session_handle(session_id) {
            close_pty_handle(session_id, handle);
        }
    }

    pub fn close_session_in_background(&self, session_id: &str) {
        log_info(&format!(
            "[PTY] Closing session {} in background",
            &session_id[..8.min(session_id.len())]
        ));

        if let Some(handle) = self.take_session_handle(session_id) {
            let close_id = session_id.to_string();
            let thread_name = format!("pty-close-{}", &close_id[..8.min(close_id.len())]);
            if let Err(e) = thread::Builder::new().name(thread_name).spawn(move || {
                close_pty_handle(&close_id, handle);
            }) {
                log_error(&format!(
                    "[PTY] Failed to spawn close worker for {}: {}",
                    &session_id[..8.min(session_id.len())],
                    e
                ));
            }
        }
    }

    fn take_session_handle(&self, session_id: &str) -> Option<PtyHandle> {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(session_id);
        }

        self.pty_handles
            .lock()
            .ok()
            .and_then(|mut handles| handles.remove(session_id))
    }

    pub fn close_all_sessions(&self) {
        log_info("[PTY] Closing all sessions...");
        let ids: Vec<String> = self
            .pty_handles
            .lock()
            .map(|h| h.keys().cloned().collect())
            .unwrap_or_default();
        for id in ids {
            self.close_session(&id);
        }
        log_info("[PTY] All sessions closed");
    }
}

// ─── 共享 Pipeline 函数 ─────────────────────────────────────────────

fn spawn_pty_pipeline(
    id: &str,
    pair: PtyPair,
    child: Box<dyn Child + Send + Sync>,
    config: &PipelineConfig,
    sessions: &Arc<Mutex<HashMap<String, TerminalSession>>>,
    pty_handles: &Arc<Mutex<HashMap<String, PtyHandle>>>,
    app_handle: &tauri::AppHandle,
) -> Result<TerminalSession> {
    let pid = child.process_id();
    log_info(&format!("{} Shell spawned, PID: {:?}", config.prefix, pid));

    // Windows: create a Job Object and assign the child process to it so that
    // the entire process tree is killed when we close the job handle.
    // Assignment must happen immediately after spawn — before the child has a
    // chance to fork grandchildren — to guarantee full tree coverage.
    #[cfg(windows)]
    let job_handle = {
        match child.as_raw_handle() {
            Some(raw) => match crate::utils::job_object::create_job_for_process(raw) {
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

    let session = TerminalSession {
        id: id.to_string(),
        pid,
        status: TerminalStatus::Idle,
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

fn spawn_watcher_thread(
    id: &str,
    config: &PipelineConfig,
    pty_handles: &Arc<Mutex<HashMap<String, PtyHandle>>>,
    sessions: &Arc<Mutex<HashMap<String, TerminalSession>>>,
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
                    if let Err(e) =
                        watch_handle.emit(&close_event, TerminalClosedPayload { exit_code: code })
                    {
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

fn close_pty_handle(session_id: &str, mut handle: PtyHandle) {
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

// ─── 工具函数 ───────────────────────────────────────────────────────

fn create_pty(cols: u16, rows: u16) -> Result<PtyPair> {
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

fn build_local_shell_cmd(shell_override: &Option<String>) -> CommandBuilder {
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

// ─── 进程管理 ───────────────────────────────────────────────────────

const GRACEFUL_TIMEOUT_SECS: u64 = 2;

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

fn log_info(msg: &str) {
    log::info!("{}", msg);
}

fn log_error(msg: &str) {
    log::error!("{}", msg);
}

/// 读取 Neeko 配置并写入 OpenCode + Pi 项目级配置
/// 静默执行，失败不影响终端创建
fn write_opencode_tui_config(project_path: &str) {
    if let Err(e) =
        crate::theme::service::write_project_theme_config(
            &crate::theme::service::ThemeContext::Local,
            project_path,
        )
    {
        log::warn!("[PTY] Failed to write theme config: {}", e);
    }
}

fn read_neeko_theme() -> Option<String> {
    crate::theme::common::read_neeko_theme()
}
