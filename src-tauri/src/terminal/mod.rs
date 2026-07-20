//! Terminal session and PTY management.

pub mod commands;
/// PTY creation, pipeline spawning, and terminal utilities.
pub mod services;

pub use crate::common::terminal::types::*;

use crate::common::terminal::types::TerminalSession;
use anyhow::Result;
use portable_pty::{Child, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::EventId;
use uuid::Uuid;

#[derive(Clone, serde::Serialize)]
pub(super) struct TerminalClosedPayload {
    exit_code: i32,
}

pub(super) struct PtyHandle {
    pub(super) master: Box<dyn portable_pty::MasterPty + Send>,
    pub(super) child: Box<dyn Child + Send + Sync>,
    #[cfg(windows)]
    pub(super) job_handle: Option<crate::common::utils::job_object::JobHandle>,
    pub(super) input_listener_id: EventId,
    pub(super) app_handle: tauri::AppHandle,
}

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

/// Manages terminal sessions and PTY handles.
#[derive(Clone)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    pty_handles: Arc<Mutex<HashMap<String, PtyHandle>>>,
}

impl TerminalManager {
    /// Creates a new TerminalManager with empty session and PTY maps.
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            pty_handles: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Creates a new PTY terminal session for a local project.
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
        crate::terminal::services::log_info(&format!("[PTY] Session ID: {}", id));
        crate::terminal::services::log_info(&format!("[PTY] Working Dir: {}", cwd));

        if !std::path::Path::new(cwd).exists() {
            return Err(anyhow::anyhow!("Working directory does not exist: {}", cwd));
        }

        let pair = crate::terminal::services::create_pty(cols, rows)?;
        crate::terminal::services::log_info(&format!("[PTY] PTY opened ({}x{})", cols, rows));

        let mut cmd = if let Some(ref task_command) = command {
            crate::terminal::services::log_info(&format!(
                "[PTY] Task command mode: {}",
                task_command
            ));
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
            crate::terminal::services::build_local_shell_cmd(&shell_override)
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

        crate::terminal::services::spawn_pty_pipeline(
            &id,
            pair,
            child,
            &PTY_CONFIG,
            &self.sessions,
            &self.pty_handles,
            &app_handle,
        )
    }

    /// Creates a new WSL terminal session for a project.
    pub fn create_wsl_session(
        &self,
        distro: &str,
        project_path: &str,
        cols: u16,
        rows: u16,
        app_handle: tauri::AppHandle,
    ) -> Result<TerminalSession> {
        let id = Uuid::new_v4().to_string();
        crate::terminal::services::log_info(&format!("[WSL] Session ID: {}", id));
        crate::terminal::services::log_info(&format!("[WSL] Distro: {}", distro));
        crate::terminal::services::log_info(&format!("[WSL] Working Dir: {}", project_path));

        let pair = crate::terminal::services::create_pty(cols, rows)?;
        crate::terminal::services::log_info(&format!("[WSL] PTY opened ({}x{})", cols, rows));

        let mut cmd = CommandBuilder::new("wsl.exe");
        cmd.arg("-d");
        cmd.arg(distro);
        cmd.arg("--cd");
        cmd.arg(project_path);
        cmd.arg("--");
        cmd.arg("bash");
        cmd.arg("-c");
        cmd.arg("export COLORTERM=truecolor; exec \"${SHELL:-bash}\" -l");
        cmd.env("TERM", "xterm-256color");
        cmd.env("WSL_UTF8", "1");

        let child = pair.slave.spawn_command(cmd)?;

        crate::terminal::services::spawn_pty_pipeline(
            &id,
            pair,
            child,
            &WSL_CONFIG,
            &self.sessions,
            &self.pty_handles,
            &app_handle,
        )
    }

    /// Resizes a terminal session to the given column/row dimensions.
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
            crate::terminal::services::log_info(&format!(
                "[PTY] Resized {} to {}x{}",
                &session_id[..8.min(session_id.len())],
                cols,
                rows
            ));
        }
        Ok(())
    }

    /// Closes a terminal session and releases its PTY handle.
    pub fn close_session(&self, session_id: &str) {
        crate::terminal::services::log_info(&format!(
            "[PTY] Closing session {}",
            &session_id[..8.min(session_id.len())]
        ));
        if let Some(handle) = self.take_session_handle(session_id) {
            crate::terminal::services::close_pty_handle(session_id, handle);
        }
    }

    /// Closes a terminal session asynchronously in a background thread.
    pub fn close_session_in_background(&self, session_id: &str) {
        crate::terminal::services::log_info(&format!(
            "[PTY] Closing session {} in background",
            &session_id[..8.min(session_id.len())]
        ));
        if let Some(handle) = self.take_session_handle(session_id) {
            let close_id = session_id.to_string();
            let thread_name = format!("pty-close-{}", &close_id[..8.min(close_id.len())]);
            if let Err(e) = thread::Builder::new().name(thread_name).spawn(move || {
                crate::terminal::services::close_pty_handle(&close_id, handle);
            }) {
                crate::terminal::services::log_error(&format!(
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

    /// Closes all terminal sessions and releases all PTY handles.
    pub fn close_all_sessions(&self) {
        crate::terminal::services::log_info("[PTY] Closing all sessions...");
        let ids: Vec<String> = self
            .pty_handles
            .lock()
            .map(|h| h.keys().cloned().collect())
            .unwrap_or_default();
        for id in ids {
            self.close_session(&id);
        }
        crate::terminal::services::log_info("[PTY] All sessions closed");
    }
}
