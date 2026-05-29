pub mod commands;
pub mod model;
pub mod remote;
pub mod services;
pub mod types;

use crate::terminal::types::TerminalSession;
use anyhow::Result;
use portable_pty::{Child, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::EventId;
use uuid::Uuid;

// ─── 数据结构 ───────────────────────────────────────────────────────

/// Payload emitted with the `terminal-closed-{id}` event.
/// `exit_code` is the raw process exit code (0 = success).
#[derive(Clone, serde::Serialize)]
pub(super) struct TerminalClosedPayload {
    exit_code: i32,
}

pub(super) struct PtyHandle {
    pub(super) master: Box<dyn portable_pty::MasterPty + Send>,
    pub(super) child: Box<dyn Child + Send + Sync>,
    /// Windows only: Job Object that groups the PTY child and all of its
    /// descendants.  Dropping this handle triggers
    /// `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, which terminates the entire
    /// process tree (e.g. `node` spawned by `cmd /c npm run dev`).
    #[cfg(windows)]
    pub(super) job_handle: Option<crate::utils::job_object::JobHandle>,
    pub(super) input_listener_id: EventId,
    pub(super) app_handle: tauri::AppHandle,
}

/// Pipeline 配置（区分 PTY 和 WSL）
pub(super) struct PipelineConfig {
    pub(super) prefix: &'static str,
    pub(super) thread_prefix: &'static str,
}

pub(super) const PTY_CONFIG: PipelineConfig = PipelineConfig {
    prefix: "[PTY]",
    thread_prefix: "pty",
};

pub(super) const WSL_CONFIG: PipelineConfig = PipelineConfig {
    prefix: "[WSL]",
    thread_prefix: "wsl",
};

// ─── TerminalManager 实现 ────────────────────────────────────────────

#[derive(Clone)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    pty_handles: Arc<Mutex<HashMap<String, PtyHandle>>>,
}

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
        services::log_info(&format!("[PTY] Session ID: {}", id));
        services::log_info(&format!("[PTY] Working Dir: {}", cwd));

        if !std::path::Path::new(cwd).exists() {
            return Err(anyhow::anyhow!("Working directory does not exist: {}", cwd));
        }

        // Open local PTY pair
        let pair = services::create_pty(cols, rows)?;
        services::log_info(&format!("[PTY] PTY opened ({}x{})", cols, rows));

        let mut cmd = if let Some(ref task_command) = command {
            // Task mode: spawn the command directly so process exit == PTY close
            services::log_info(&format!("[PTY] Task command mode: {}", task_command));
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
            services::build_local_shell_cmd(&shell_override)
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

        services::spawn_pty_pipeline(
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
        services::log_info(&format!("[WSL] Session ID: {}", id));
        services::log_info(&format!("[WSL] Distro: {}", distro));
        services::log_info(&format!("[WSL] Working Dir: {}", project_path));

        let pair = services::create_pty(cols, rows)?;
        services::log_info(&format!("[WSL] PTY opened ({}x{})", cols, rows));

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

        services::spawn_pty_pipeline(
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
            services::log_info(&format!(
                "[PTY] Resized {} to {}x{}",
                &session_id[..8.min(session_id.len())],
                cols,
                rows
            ));
        }
        Ok(())
    }

    pub fn close_session(&self, session_id: &str) {
        services::log_info(&format!(
            "[PTY] Closing session {}",
            &session_id[..8.min(session_id.len())]
        ));

        if let Some(handle) = self.take_session_handle(session_id) {
            services::close_pty_handle(session_id, handle);
        }
    }

    pub fn close_session_in_background(&self, session_id: &str) {
        services::log_info(&format!(
            "[PTY] Closing session {} in background",
            &session_id[..8.min(session_id.len())]
        ));

        if let Some(handle) = self.take_session_handle(session_id) {
            let close_id = session_id.to_string();
            let thread_name = format!("pty-close-{}", &close_id[..8.min(close_id.len())]);
            if let Err(e) = thread::Builder::new().name(thread_name).spawn(move || {
                services::close_pty_handle(&close_id, handle);
            }) {
                services::log_error(&format!(
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
        services::log_info("[PTY] Closing all sessions...");
        let ids: Vec<String> = self
            .pty_handles
            .lock()
            .map(|h| h.keys().cloned().collect())
            .unwrap_or_default();
        for id in ids {
            self.close_session(&id);
        }
        services::log_info("[PTY] All sessions closed");
    }
}
