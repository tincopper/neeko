//! Terminal session and PTY management — session manager.

use crate::common::terminal::events::terminal_closed_event;
use anyhow::Result;
use portable_pty::{Child, PtySize};
// WSL 会话只在 Windows 宿主创建（`create_wsl_session`），导入随该 item 门控 ——
// 未门控会在非目标平台触发 unused_imports（红线 10）。
#[cfg(target_os = "windows")]
use portable_pty::CommandBuilder;
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

/// WSL 会话的 pipeline 配置（仅 Windows 宿主产生 WSL 会话；与 router 的
/// `#[cfg(target_os = "windows")]` Wsl 分支同域）。
#[cfg(target_os = "windows")]
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
        crate::common::terminal::drain::take_drain(&self.drains, session_id)
    }

    /// 切换该会话的分离态（后台运行 / 接回界面）。
    pub(crate) fn set_drain_detached(&self, session_id: &str, detached: bool) -> bool {
        crate::common::terminal::drain::set_drain_detached(&self.drains, session_id, detached)
    }

    /// Long-poll drain: 有积压立即返回；空则挂起至 push/close/超时。
    /// closed/missing 返回 `None`（调用方转 `NotFound`，前端停止续挂）。
    pub(crate) async fn wait_drain(
        &self,
        session_id: &str,
        timeout: std::time::Duration,
    ) -> Option<Vec<u8>> {
        crate::common::terminal::drain::wait_drain(&self.drains, session_id, timeout).await
    }

    /// Creates a new PTY terminal session at the resolved run root `cwd`.
    ///
    /// 运行根由调用方（router，再上溯终端命令层）从 Workspace 身份派生；本层不再有
    /// 「可选 working_dir + 项目路径缺省」的 fail-open 形态（缺省静默回落主仓已退役）。
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn create_session(
        &self,
        cwd: &str,
        cols: u16,
        rows: u16,
        shell_override: Option<String>,
        command: Option<String>,
        registration: Option<crate::live_sessions::wiring::pty::LiveTerminal<'_>>,
        app_handle: tauri::AppHandle,
    ) -> Result<TerminalSession> {
        let id = Uuid::new_v4().to_string();
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
        // 会话身份下发给子进程：`CommandBuilder::env` 只作用于**这个**子进程，多会话互不影响。
        // hook shim 读它做精确归因（见 `live_sessions::SESSION_ID_ENV`）。
        cmd.env(crate::live_sessions::SESSION_ID_ENV, &id);
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
            registration,
            &app_handle,
        )
    }

    /// Creates a new WSL terminal session at the resolved run root `cwd`.
    #[cfg(target_os = "windows")]
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn create_wsl_session(
        &self,
        distro: &str,
        cwd: &str,
        cols: u16,
        rows: u16,
        registration: Option<crate::live_sessions::wiring::pty::LiveTerminal<'_>>,
        app_handle: tauri::AppHandle,
    ) -> Result<TerminalSession> {
        let id = Uuid::new_v4().to_string();
        crate::terminal::services::log_info(&format!("[WSL] Session ID: {}", id));
        crate::terminal::services::log_info(&format!("[WSL] Distro: {}", distro));
        crate::terminal::services::log_info(&format!("[WSL] Working Dir: {}", cwd));

        let pair = crate::terminal::services::create_pty(cols, rows)?;
        crate::terminal::services::log_info(&format!("[WSL] PTY opened ({}x{})", cols, rows));

        let mut cmd = CommandBuilder::new("wsl.exe");
        cmd.arg("-d");
        cmd.arg(distro);
        cmd.arg("--cd");
        cmd.arg(cwd);
        cmd.arg("--");
        cmd.arg("bash");
        cmd.arg("-c");
        // WSL 不会把宿主 env 透进 Linux 侧（除非 WSLENV），所以会话身份必须在 shell 里
        // export —— 与 COLORTERM 同一行，一条命令一次到位。值走统一 POSIX 转义，不依赖
        // 「id 恰好是 uuid」这个当前事实。
        cmd.arg(format!(
            "export {}={}; export COLORTERM=truecolor; exec \"${{SHELL:-bash}}\" -l",
            crate::live_sessions::SESSION_ID_ENV,
            crate::common::utils::command::local::quote_shell_arg(&id)
        ));
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
            registration,
            &app_handle,
        )
    }

    /// Resizes a terminal session to the given column/row dimensions.
    pub fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> Result<()> {
        // resize 在临界区内执行并带出结果，守卫在此作用域末释放，log 在锁外。
        let resize_result = {
            let mut handles =
                crate::common::terminal::locks::lock_warn(&self.pty_handles, "pty_handles");
            match handles.get_mut(session_id) {
                Some(handle) => Some(handle.master.resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })),
                None => None,
            }
        };
        if let Some(result) = resize_result {
            result?;
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
        crate::common::terminal::locks::lock_warn(&self.sessions, "sessions").remove(session_id);
        // remove-then-close（见 drain::close_and_remove_drain）：先摘表项，
        // 孤儿 reader 泵手持同一 Arc，后续 push 被黑洞吸收，读到 EOF
        // 自然退出线程（否则永久停泊背压循环，任务 design.md §8.2）。
        crate::common::terminal::drain::close_and_remove_drain(&self.drains, session_id);
        crate::common::terminal::locks::lock_warn(&self.pty_handles, "pty_handles")
            .remove(session_id)
    }

    /// Closes all terminal sessions and releases all PTY handles.
    pub fn close_all_sessions(&self) {
        crate::terminal::services::log_info("[PTY] Closing all sessions...");
        let ids = crate::common::terminal::drain::session_ids(&self.drains);
        for id in ids {
            self.close_session(&id);
        }
        crate::terminal::services::log_info("[PTY] All sessions closed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::terminal::drain;
    use std::sync::Arc;
    use std::time::Duration;

    fn poison<T: Send + 'static>(m: &Arc<Mutex<T>>) {
        let clone = Arc::clone(m);
        let _ = std::thread::spawn(move || {
            let _guard = clone.lock().unwrap();
            panic!("poison-inject");
        })
        .join();
    }

    /// `wait_drain` 经 manager 查表分发：有积压立即返回字节，不落空。
    #[tokio::test]
    async fn wait_drain_returns_buffered_bytes() {
        let manager = TerminalManager::new();
        drain::insert_drain(&manager.drains, "s1");
        let drain = drain::get_drain(&manager.drains, "s1").expect("registered drain");
        drain.push(b"hello", || drain.notify_one());
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
        drain::insert_drain(&manager.drains, "gone");
        drain::get_drain(&manager.drains, "gone")
            .expect("registered drain")
            .close();
        assert_eq!(
            manager.wait_drain("gone", Duration::from_millis(10)).await,
            None
        );
    }

    /// 空队列挂起至 push：waiter 先注册，push 后经 notify 唤醒返回字节。
    #[tokio::test]
    async fn wait_drain_parks_then_push_wakes() {
        let manager = TerminalManager::new();
        drain::insert_drain(&manager.drains, "s2");
        let drain = drain::get_drain(&manager.drains, "s2").expect("registered drain");
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

    #[test]
    fn poisoned_sessions_close_does_not_panic() {
        use crate::common::terminal::types::{TerminalSession, TerminalStatus};
        let manager = TerminalManager::new();
        manager.sessions.lock().unwrap().insert(
            "s-poison".into(),
            TerminalSession {
                id: "s-poison".into(),
                pid: None,
                status: TerminalStatus::Idle,
                history: Vec::new(),
                agent: None,
            },
        );
        drain::insert_drain(&manager.drains, "s-poison");
        poison(&manager.sessions);
        manager.close_session("s-poison");
        // 容忍继续：poison 后 sessions 条目仍被移除（中毒前数据不丢、不泄漏）。
        let sessions = manager
            .sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        assert!(!sessions.contains_key("s-poison"));
        assert_eq!(drain::session_ids(&manager.drains), Vec::<String>::new());
    }

    /// 中毒容忍：`pty_handles` poison 后 `resize_session` 不报错（内部容忍，签名不变）。
    #[test]
    fn poisoned_pty_handles_resize_tolerated() {
        let manager = TerminalManager::new();
        poison(&manager.pty_handles);
        manager
            .resize_session("missing", 80, 24)
            .expect("poisoned resize must be tolerated");
        manager.close_session("missing");
    }

    /// D4：`close_all_sessions` 枚举源为 drains——仅 drain 注册（handles 失配）也要被关闭。
    #[test]
    fn close_all_enumerates_drains_on_mismatch() {
        let manager = TerminalManager::new();
        drain::insert_drain(&manager.drains, "orphan");
        manager.close_all_sessions();
        assert_eq!(drain::session_ids(&manager.drains), Vec::<String>::new());
    }
}
