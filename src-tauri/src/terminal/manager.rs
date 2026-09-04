//! Terminal session and PTY management — session manager.

use crate::common::terminal::events::terminal_closed_event;
use anyhow::Result;
use portable_pty::{Child, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::Emitter;
use tauri::EventId;
use uuid::Uuid;

use crate::common::terminal::types::TerminalSession;

#[derive(Clone, serde::Serialize)]
pub(crate) struct TerminalClosedPayload {
    pub(crate) exit_code: i32,
}

pub(crate) struct PtyHandle {
    pub(crate) master: Box<dyn portable_pty::MasterPty + Send>,
    pub(crate) child: Box<dyn Child + Send + Sync>,
    #[cfg(windows)]
    pub(crate) job_handle: Option<crate::common::utils::job_object::JobHandle>,
    pub(crate) input_listener_id: EventId,
    pub(crate) app_handle: tauri::AppHandle,
}

pub(crate) struct PipelineConfig {
    pub(crate) prefix: &'static str,
    pub(crate) thread_prefix: &'static str,
}

pub(crate) const PTY_CONFIG: PipelineConfig = PipelineConfig {
    prefix: "[PTY]",
    thread_prefix: "pty",
};

pub(crate) const WSL_CONFIG: PipelineConfig = PipelineConfig {
    prefix: "[WSL]",
    thread_prefix: "wsl",
};

/// Manages terminal sessions and PTY handles.
#[derive(Clone)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    pty_handles: Arc<Mutex<HashMap<String, PtyHandle>>>,
    drains: crate::common::terminal::drain::SessionDrainMap,
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalManager {
    /// Creates a new TerminalManager with empty session and PTY maps.
    #[must_use]
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            pty_handles: Arc::new(Mutex::new(HashMap::new())),
            drains: crate::common::terminal::drain::new_drain_map(),
        }
    }

    /// Takes all buffered output bytes for a session (credit-pull protocol).
    /// 轮询降级路径专用：tick 即唤醒，竞态补发闭包保持为空；
    /// long-poll 路径经 `SessionDrain::notify_one` 唤醒，不走此处。
    pub(crate) fn take_drain(&self, session_id: &str) -> Option<Vec<u8>> {
        let drain = self
            .drains
            .lock()
            .ok()
            .and_then(|m| m.get(session_id).cloned())?;
        Some(drain.take_and_rearm(|| {
            // Wake hint 退役（方案 B 去 eval 化）：前端已改为全局轮询器驱动
            // credit-pull，`terminal-drain-{id}` 事件不再被监听。macOS 上事件
            // 送达 = 每次 evaluateJavaScript，即使无 listener 也应避免无意义
            // 的 IPC 消息往返。take_and_rearm 的竞态补发语义保留（闭包为空），
            // 字节安全由轮询「拉空为止」保证。
        }))
    }
    /// Long-poll drain: 有积压立即返回；空则挂起至 push/close/超时。
    /// closed/missing 返回 `None`（调用方转 `NotFound`，前端停止续挂）。
    pub(crate) async fn wait_drain(
        &self,
        session_id: &str,
        timeout: std::time::Duration,
    ) -> Option<Vec<u8>> {
        let drain = self
            .drains
            .lock()
            .ok()
            .and_then(|m| m.get(session_id).cloned())?;
        drain.wait_drain(timeout).await
    }

    /// Creates a new PTY terminal session for a local project.
    #[allow(clippy::too_many_arguments)]
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

        let mut cmd = if let Some(task_command) = &command {
            crate::terminal::services::log_info(&format!(
                "[PTY] Task command mode: {}",
                task_command
            ));
            // 平台差异(Windows cmd /c vs Unix sh -c)集中化于 crate::platform::shell_launch。
            crate::platform::shell_launch::build_task_command(task_command)
        } else {
            crate::terminal::services::build_local_shell_cmd(&shell_override)
        };

        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        // 平台差异(Unix locale 环境变量)集中化于 crate::platform::shell_launch。
        crate::platform::shell_launch::apply_locale_env(&mut cmd);
        cmd.cwd(cwd);

        let child = pair.slave.spawn_command(cmd)?;

        crate::terminal::services::spawn_pty_pipeline(
            &id,
            pair,
            child,
            &PTY_CONFIG,
            &self.sessions,
            &self.pty_handles,
            &self.drains,
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
            &self.drains,
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
    /// Emits `terminal-closed-{id}` after the PTY is closed so the frontend
    /// can finalize the run state (stopping → idle).
    pub fn close_session_in_background(&self, session_id: &str) {
        crate::terminal::services::log_info(&format!(
            "[PTY] Closing session {} in background",
            &session_id[..8.min(session_id.len())]
        ));
        if let Some(handle) = self.take_session_handle(session_id) {
            let close_id = session_id.to_string();
            let app_handle = handle.app_handle.clone();
            let thread_name = format!("pty-close-{}", &close_id[..8.min(close_id.len())]);
            if let Err(e) = thread::Builder::new().name(thread_name).spawn(move || {
                crate::terminal::services::close_pty_handle(&close_id, handle);
                // Emit close event after cleanup so the frontend listener fires.
                let close_event = terminal_closed_event(&close_id);
                let _ = app_handle.emit(&close_event, TerminalClosedPayload { exit_code: -1 });
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
        // 先 close 再移除：孤儿 reader 泵的后续 push 被黑洞吸收，读到 EOF
        // 自然退出线程（否则永久停泊背压循环，任务 design.md §8.2）。
        if let Ok(mut drains) = self.drains.lock() {
            if let Some(d) = drains.remove(session_id) {
                d.close();
            }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::terminal::drain::SessionDrain;
    use std::sync::Arc;
    use std::time::Duration;

    /// `wait_drain` 经 manager 查表分发：有积压立即返回字节，不落空。
    #[tokio::test]
    async fn wait_drain_returns_buffered_bytes() {
        let manager = TerminalManager::new();
        let drain = Arc::new(SessionDrain::default());
        drain.push(b"hello", || drain.notify_one());
        manager
            .drains
            .lock()
            .expect("infallible: drains lock")
            .insert("s1".into(), drain);
        let got = manager
            .wait_drain("s1", Duration::from_millis(50))
            .await
            .expect("registered drain must return Some");
        assert_eq!(got, b"hello");
    }

    /// 会话不存在：查表落空返回 `None`（调用方转 NotFound，前端停止续挂）。
    #[tokio::test]
    async fn wait_drain_missing_session_returns_none() {
        let manager = TerminalManager::new();
        assert_eq!(
            manager.wait_drain("nope", Duration::from_millis(10)).await,
            None
        );
    }

    /// 会话已关闭：`SessionDrain::close` 后返回 `None`（同一 NotFound 语义）。
    #[tokio::test]
    async fn wait_drain_closed_session_returns_none() {
        let manager = TerminalManager::new();
        let drain = Arc::new(SessionDrain::default());
        drain.close();
        manager
            .drains
            .lock()
            .expect("infallible: drains lock")
            .insert("gone".into(), drain);
        assert_eq!(
            manager.wait_drain("gone", Duration::from_millis(10)).await,
            None
        );
    }

    /// 空队列挂起至 push：waiter 先注册，push 后经 notify 唤醒返回字节。
    #[tokio::test]
    async fn wait_drain_parks_then_push_wakes() {
        let manager = TerminalManager::new();
        let drain = Arc::new(SessionDrain::default());
        manager
            .drains
            .lock()
            .expect("infallible: drains lock")
            .insert("s2".into(), drain.clone());
        let waiter = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.wait_drain("s2", Duration::from_secs(5)).await })
        };
        tokio::time::sleep(Duration::from_millis(50)).await;
        drain.push(b"wake-me", || drain.notify_one());
        let got = waiter
            .await
            .expect("waiter task panicked")
            .expect("open drain must return Some");
        assert_eq!(got, b"wake-me");
    }
}
