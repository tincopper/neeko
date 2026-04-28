use crate::models::{TerminalSession, TerminalStatus};
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

struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    input_listener_id: EventId,
    app_handle: tauri::AppHandle,
}

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
        write_opencode_tui_config(project_path);

        let pair = create_pty(cols, rows)?;
        log_info(&format!("[PTY] PTY opened ({}x{})", cols, rows));

        let mut cmd = build_local_shell_cmd(&shell_override);
        cmd.env("TERM", "xterm-256color");
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

        let pair = create_pty(cols, rows)?;
        log_info(&format!("[WSL] PTY opened ({}x{})", cols, rows));

        let mut cmd = CommandBuilder::new("wsl.exe");
        cmd.arg("-d");
        cmd.arg(distro);
        cmd.arg("--cd");
        cmd.arg(project_path);
        cmd.env("TERM", "xterm-256color");
        cmd.env("LANG", "en_US.UTF-8");
        cmd.env("LC_ALL", "en_US.UTF-8");
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

        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(session_id);
        }

        if let Ok(mut handles) = self.pty_handles.lock() {
            if let Some(mut handle) = handles.remove(session_id) {
                handle.app_handle.unlisten(handle.input_listener_id);
                drop(handle.master);
                graceful_kill(&mut *handle.child);
            }
        }
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
                let exited = {
                    match watch_pty_handles.lock() {
                        Ok(mut handles) => {
                            if let Some(handle) = handles.get_mut(&watch_id) {
                                match handle.child.try_wait() {
                                    Ok(Some(_)) => true,
                                    Ok(None) => false,
                                    Err(_) => true,
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

                if exited {
                    log_info(&format!(
                        "{}-WATCHER Child exited for {}, cleaning up",
                        prefix_w,
                        &watch_id[..8]
                    ));
                    if let Ok(mut handles) = watch_pty_handles.lock() {
                        if let Some(handle) = handles.remove(&watch_id) {
                            handle.app_handle.unlisten(handle.input_listener_id);
                            drop(handle.master);
                            drop(handle.child);
                        }
                    }
                    if let Ok(mut sessions) = watch_sessions.lock() {
                        sessions.remove(&watch_id);
                    }
                    let close_event = format!("terminal-closed-{}", watch_id);
                    if let Err(e) = watch_handle.emit(&close_event, ()) {
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

const GRACEFUL_TIMEOUT_SECS: u64 = 3;

fn graceful_kill(child: &mut dyn Child) {
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
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
        log_info(&format!("[PTY] Sent SIGTERM to PID {}", pid));

        let deadline = Instant::now() + Duration::from_secs(GRACEFUL_TIMEOUT_SECS);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => {
                    log_info(&format!("[PTY] PID {} exited after SIGTERM", pid));
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
            "[PTY] PID {} did not exit after {}s, sending SIGKILL",
            pid, GRACEFUL_TIMEOUT_SECS
        ));
        unsafe {
            libc::kill(pid as i32, libc::SIGKILL);
        }
        let _ = child.wait();
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
                    log_info(&format!("[PTY] PID {} exited gracefully", pid));
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
    }
}

fn log_info(msg: &str) {
    log::info!("{}", msg);
}

fn log_error(msg: &str) {
    log::error!("{}", msg);
}

/// 读取 Neeko 配置并写入 OpenCode 项目级 TUI 配置
/// 静默执行，失败不影响终端创建
fn write_opencode_tui_config(project_path: &str) {
    let theme = match read_neeko_theme() {
        Some(t) => t,
        None => return,
    };
    if let Err(e) = crate::opencode_theme::write_project_tui_config(project_path, &theme) {
        log::warn!("[PTY] Failed to write OpenCode tui.json: {}", e);
    }
}

/// 从 ~/.neeko/config.json 读取当前主题
fn read_neeko_theme() -> Option<String> {
    let home = dirs::home_dir()?;
    let config_path = home.join(".neeko").join("config.json");
    let content = std::fs::read_to_string(&config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&content).ok()?;
    Some(crate::opencode_theme::get_current_theme(&config))
}
