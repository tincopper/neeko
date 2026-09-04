//! SSH remote terminal session management.

use crate::common::connection::types::AuthMethod;
use crate::common::executor::ssh_auth;
use crate::common::terminal::events::terminal_input_event;
use crate::common::terminal::types::{TerminalSession, TerminalStatus};
use crate::theme::common;
use anyhow::Result;
#[allow(clippy::wildcard_imports)]
use russh::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{EventId, Listener};
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use uuid::Uuid;

/// Internal handle for an active SSH terminal session.
struct SSHHandle {
    /// Sender for forwarding user input to the IO task (dropped to signal exit).
    #[allow(dead_code)]
    input_tx: mpsc::UnboundedSender<Vec<u8>>,
    /// Sender for PTY resize requests (cols, rows).
    resize_tx: mpsc::UnboundedSender<(u32, u32)>,
    /// Event listener ID for terminal input events.
    input_listener_id: EventId,
    /// Tauri app handle used for event emission.
    app_handle: tauri::AppHandle,
}

/// Manages SSH terminal sessions, including creation, I/O, and lifecycle.
#[derive(Clone)]
pub struct RemoteTerminalManager {
    /// All active terminal sessions indexed by session ID.
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    /// Internal SSH handles indexed by session ID.
    ssh_handles: Arc<Mutex<HashMap<String, SSHHandle>>>,
    /// Bounded output queues (credit-pull protocol), keyed by session ID.
    drains: crate::common::terminal::drain::SessionDrainMap,
}

impl Default for RemoteTerminalManager {
    fn default() -> Self {
        Self::new()
    }
}

impl RemoteTerminalManager {
    /// Create a new empty `RemoteTerminalManager`.
    #[must_use]
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            ssh_handles: Arc::new(Mutex::new(HashMap::new())),
            drains: crate::common::terminal::drain::new_drain_map(),
        }
    }

    /// Create a new SSH terminal session connected to the given host.
    #[allow(clippy::too_many_arguments)]
    pub async fn create_session(
        &self,
        host: &str,
        port: u16,
        username: &str,
        auth: &AuthMethod,
        project_path: &str,
        cols: u16,
        rows: u16,
        app_handle: tauri::AppHandle,
    ) -> Result<TerminalSession> {
        let id = Uuid::new_v4().to_string();
        log_info(&format!("[SSH] Session ID: {}", id));
        log_info(&format!("[SSH] Host: {}:{}", host, port));
        log_info(&format!("[SSH] Username: {}", username));
        log_info(&format!("[SSH] Working Dir: {}", project_path));

        // 建立 SSH 连接并认证
        let session = ssh_auth::connect_and_authenticate(host, port, username, auth).await?;

        log_info(&format!("[SSH] Authentication successful for {}", username));

        // 安装远程 OpenCode 主题文件和项目 TUI 配置
        // 使用单独的 channel 执行，失败不影响终端创建
        setup_remote_opencode_theme(&session, project_path).await;

        // 打开 channel
        let mut channel = session.channel_open_session().await?;

        // 请求 PTY
        channel
            .request_pty(
                false,
                "xterm-256color",
                u32::from(cols),
                u32::from(rows),
                0,
                0,
                &[],
            )
            .await?;

        // 请求 shell
        channel.request_shell(true).await?;

        // 切换到项目目录并设置 COLORTERM 以启用 truecolor
        let cd_cmd = format!("export COLORTERM=truecolor; cd {}\n", project_path);
        channel.data(cd_cmd.as_bytes()).await?;

        // 创建 session 对象
        let terminal_session = TerminalSession {
            id: id.clone(),
            pid: None,
            status: TerminalStatus::Idle,
            history: Vec::new(),
            agent: None,
        };

        crate::common::terminal::locks::lock_warn(&self.sessions, "sessions")
            .insert(id.clone(), terminal_session.clone());

        crate::common::terminal::drain::insert_drain(&self.drains, &id);

        // mpsc channel：input listener → IO 任务
        let (input_tx, mut input_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        // mpsc channel：resize 请求 (cols, rows) → IO 任务
        let (resize_tx, mut resize_rx) = mpsc::unbounded_channel::<(u32, u32)>();

        // 监听前端输入事件，把数据放入 mpsc
        let tx_clone = input_tx.clone();
        let input_listener_id =
            app_handle.listen(
                terminal_input_event(&id),
                move |event| match serde_json::from_str::<Vec<u8>>(event.payload()) {
                    Ok(data) => {
                        let _ = tx_clone.send(data);
                    }
                    Err(e) => {
                        log_error(&format!(
                            "[SSH-WRITER] Parse error: {} payload={}",
                            e,
                            event.payload()
                        ));
                    }
                },
            );

        // 保存 handle（包含 resize_tx，供 resize_session 调用）
        crate::common::terminal::locks::lock_warn(&self.ssh_handles, "ssh_handles").insert(
            id.clone(),
            SSHHandle {
                input_tx,
                resize_tx,
                input_listener_id,
                app_handle: app_handle.clone(),
            },
        );

        let session_drain = crate::common::terminal::drain::get_drain(&self.drains, &id)
            .ok_or_else(|| anyhow::anyhow!("Drain queue missing for session {id}"))?;

        // 用 make_writer() 分离读写端，避免 select! 中的可变借用冲突
        let mut writer = channel.make_writer();

        // IO 任务：在独立 tokio 线程里同时处理读写和 resize，消除锁竞争
        let io_id = id.clone();
        if let Err(e) = thread::Builder::new()
            .name(format!("ssh-io-{}", &id[..8]))
            .spawn(move || {
                let rt = match tokio::runtime::Runtime::new() {
                    Ok(rt) => rt,
                    Err(e) => {
                        log_error(&format!("[SSH-IO] Failed to create tokio runtime: {}", e));
                        return;
                    }
                };
                let io_drain = session_drain.clone();
                rt.block_on(async move {
                    log_info(&format!("[SSH-IO] Thread started for {}", &io_id[..8]));
                    loop {
                        tokio::select! {
                            // 从前端收到输入 → 写入 SSH channel（写端独立，无借用冲突）
                            maybe_data = input_rx.recv() => {
                                match maybe_data {
                                    Some(data) => {
                                        if let Err(e) = writer.write_all(&data).await {
                                            log_error(&format!("[SSH-IO] Write error: {}", e));
                                            break;
                                        }
                                    }
                                    None => break, // sender 全部 drop，退出
                                }
                            }
                            // 收到 resize 请求 → 发送 window_change 给远端 PTY
                            maybe_resize = resize_rx.recv() => {
                                match maybe_resize {
                                    Some((cols, rows)) => {
                                        if let Err(e) = channel.window_change(cols, rows, 0, 0).await {
                                            log_error(&format!("[SSH-IO] window_change error: {}", e));
                                        }
                                    }
                                    None => break,
                                }
                            }
                            // 从 SSH channel 收到输出 → 发给前端（读端独立）
                            msg = channel.wait() => {
                                match msg {
                                    Some(ChannelMsg::Data { data }) => {
                                        // 内存治理：写入有界 drain 队列，前端经
                                        // terminal_drain(_wait) 拉二进制块（默认
                                        // long-poll 挂起式 drain，VITE_TERMINAL_DRAIN_POLL=1
                                        // 回退轮询；wake hint 事件已退役）。
                                        // Mutex 临界区极短，不违反阻塞红线。
                                        //
                                        // 背压契约对齐本地泵（design.md §8.2）：
                                        // 满载停泊重试，绝不丢字节。期间
                                        // input/resize 消息暂存于 unbounded
                                        // channel 不丢失；会话已关闭（closed）
                                        // 时 push 黑洞吸收，循环自然结束。
                                        let session_drain = io_drain.clone();
                                        // long-poll 路径经 Notify 唤醒挂起的 terminal_drain_wait；
                                        // 轮询降级路径 tick 即唤醒。
                                        while !session_drain.push(&data, || session_drain.notify_one()) {
                                            tokio::time::sleep(std::time::Duration::from_millis(2)).await;
                                        }
                                    }
                                    Some(ChannelMsg::Eof) => {
                                        log_info("[SSH-IO] EOF");
                                        break;
                                    }
                                    Some(ChannelMsg::Close) => {
                                        log_info("[SSH-IO] Channel closed");
                                        break;
                                    }
                                    None => {
                                        log_info("[SSH-IO] Channel disconnected");
                                        break;
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                    log_info(&format!("[SSH-IO] Thread exiting for {}", &io_id[..8]));
                });
            })
        {
            // IO 线程起不来：回滚刚插入的三处表项（`close_session`
            // 顺带注销 input 监听器并摘掉 drain），不留孤儿会话。
            self.close_session(&id);
            return Err(anyhow::anyhow!("[SSH] Failed to spawn IO thread for {id}: {e}"));
        }

        log_info(&format!("[SSH] Session {} ready", &id[..8]));
        Ok(terminal_session)
    }

    /// Resize the PTY of an active SSH terminal session.
    pub fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> Result<()> {
        // 只在临界区内克隆 sender，守卫在此作用域末释放，send 与 log 在锁外。
        let resize_tx = {
            let handles =
                crate::common::terminal::locks::lock_warn(&self.ssh_handles, "ssh_handles");
            handles
                .get(session_id)
                .map(|handle| handle.resize_tx.clone())
        };
        if let Some(resize_tx) = resize_tx {
            let _ = resize_tx.send((u32::from(cols), u32::from(rows)));
            log_info(&format!(
                "[SSH] Resize {}x{} sent to session {}",
                cols,
                rows,
                &session_id[..8]
            ));
        }
        Ok(())
    }

    /// Close all active SSH terminal sessions.
    pub fn close_all_sessions(&self) {
        log_info("[SSH] Closing all sessions...");
        let ids = crate::common::terminal::drain::session_ids(&self.drains);
        for id in ids {
            self.close_session(&id);
        }
        log_info("[SSH] All sessions closed");
    }

    /// Close a single SSH terminal session by ID.
    pub fn close_session(&self, session_id: &str) {
        log_info(&format!(
            "[SSH] Closing session {}",
            &session_id[..8.min(session_id.len())]
        ));
        crate::common::terminal::locks::lock_warn(&self.sessions, "sessions").remove(session_id);

        if let Some(handle) =
            crate::common::terminal::locks::lock_warn(&self.ssh_handles, "ssh_handles")
                .remove(session_id)
        {
            // 注销 input 监听器
            handle.app_handle.unlisten(handle.input_listener_id);
            // input_tx drop 后，IO 任务的 recv() 会返回 None，任务自然退出
        }

        // remove-then-close（见 drain::close_and_remove_drain）：先摘表项，
        // 孤儿 IO 任务手持同一 Arc，后续 push 被黑洞吸收，读到 EOF/Close
        // 自然退出（对齐本地 TerminalManager::take_session_handle 语义）。
        crate::common::terminal::drain::close_and_remove_drain(&self.drains, session_id);
    }

    /// Takes all buffered output bytes for a session (credit-pull protocol).
    /// 轮询降级路径专用：tick 即唤醒，竞态补发闭包保持为空；
    /// long-poll 路径经 `SessionDrain::notify_one` 唤醒，不走此处。
    #[must_use]
    pub fn take_drain(&self, session_id: &str) -> Option<Vec<u8>> {
        crate::common::terminal::drain::take_drain(&self.drains, session_id)
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

    /// Test whether an SSH connection can be established with the given parameters.
    pub async fn test_connection(
        &self,
        host: &str,
        port: u16,
        username: &str,
        auth: &AuthMethod,
    ) -> Result<()> {
        let session = ssh_auth::connect_and_authenticate(host, port, username, auth).await?;

        let mut channel = session.channel_open_session().await?;
        channel.exec(true, b"echo ok").await?;
        loop {
            match channel.wait().await {
                Some(russh::ChannelMsg::ExitStatus { .. }) | None => break,
                Some(russh::ChannelMsg::Eof) => break,
                _ => {}
            }
        }
        let _ = channel.close().await;
        let _ = session
            .disconnect(russh::Disconnect::ByApplication, "", "")
            .await;
        Ok(())
    }

    /// List subdirectories at the given path on the remote server (for path auto-completion).
    /// Establishes a one-shot SSH connection, runs `ls`, and returns directory names.
    pub async fn list_directories(
        &self,
        host: &str,
        port: u16,
        username: &str,
        auth: &AuthMethod,
        path: &str,
    ) -> Result<Vec<String>> {
        let session = ssh_auth::connect_and_authenticate(host, port, username, auth).await?;

        let mut channel = session.channel_open_session().await?;
        let safe_path = path.replace('\'', "'\\''");
        let cmd = format!(
            "ls -1p '{}' 2>/dev/null | grep '/$' | sed 's|/$||'",
            safe_path
        );
        channel.exec(true, cmd.as_bytes()).await?;

        let mut output = Vec::new();
        loop {
            match channel.wait().await {
                Some(russh::ChannelMsg::Data { data }) => {
                    output.extend_from_slice(&data);
                }
                Some(russh::ChannelMsg::Eof) | None => break,
                Some(russh::ChannelMsg::ExitStatus { .. }) => break,
                _ => {}
            }
        }

        let _ = channel.close().await;
        let _ = session
            .disconnect(russh::Disconnect::ByApplication, "", "")
            .await;

        let dirs = String::from_utf8_lossy(&output)
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.trim().to_string())
            .collect();

        Ok(dirs)
    }
}

fn log_info(msg: &str) {
    log::info!("{}", msg);
}

fn log_error(msg: &str) {
    log::error!("{}", msg);
}

/// 安装远程主题文件和项目配置
/// 每个操作使用独立的 channel（SSH channel 只能 exec 一次）
async fn setup_remote_opencode_theme(
    session: &russh::client::Handle<ssh_auth::Client>,
    project_path: &str,
) {
    let theme = match common::read_neeko_theme() {
        Some(t) => t,
        None => return,
    };

    for s in crate::theme::service::ThemeStrategy::all() {
        // channel: 安装主题文件到远程 ~/.config/{opencode,pi}/
        match session.channel_open_session().await {
            Ok(mut ch) => {
                if let Err(e) = s.install_remote_files(&mut ch).await {
                    log_warn(&format!(
                        "[SSH] Failed to install remote {} theme files: {}",
                        s.name(),
                        e
                    ));
                }
                let _ = ch.close().await;
            }
            Err(e) => {
                log_warn(&format!(
                    "[SSH] Failed to open channel for {} theme install: {}",
                    s.name(),
                    e
                ));
            }
        }

        if !s.is_enabled() {
            continue;
        }

        // channel: 写入项目级配置到远程 .opencode/tui.json 或 .pi/settings.json
        match session.channel_open_session().await {
            Ok(mut ch) => {
                if let Err(e) = s.write_remote_config(&mut ch, project_path, &theme).await {
                    log_warn(&format!(
                        "[SSH] Failed to write remote {} config: {}",
                        s.name(),
                        e
                    ));
                }
                let _ = ch.close().await;
            }
            Err(e) => {
                log_warn(&format!(
                    "[SSH] Failed to open channel for {} config: {}",
                    s.name(),
                    e
                ));
            }
        }
    }
}

fn log_warn(msg: &str) {
    log::warn!("{}", msg);
}

// IDE 相关函数已移至 commands/ide.rs

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

    /// `wait_drain` 经 RemoteTerminalManager 查表分发：有积压立即返回字节。
    #[tokio::test]
    async fn wait_drain_returns_buffered_bytes() {
        let manager = RemoteTerminalManager::new();
        drain::insert_drain(&manager.drains, "r1");
        let drain = drain::get_drain(&manager.drains, "r1").expect("registered drain");
        drain.push(b"remote", || drain.notify_one());
        let got = manager
            .wait_drain("r1", Duration::from_millis(50))
            .await
            .expect("registered drain must return Some");
        assert_eq!(got, b"remote");
    }

    /// 会话不存在：查表落空返回 `None`（调用方转 NotFound，前端停止续挂）。
    #[tokio::test]
    async fn wait_drain_missing_session_returns_none() {
        let manager = RemoteTerminalManager::new();
        assert_eq!(
            manager.wait_drain("nope", Duration::from_millis(10)).await,
            None
        );
    }

    /// 会话已关闭：返回 `None`（与 terminal_drain_wait 的 NotFound 语义一致）。
    #[tokio::test]
    async fn wait_drain_closed_session_returns_none() {
        let manager = RemoteTerminalManager::new();
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
        let manager = RemoteTerminalManager::new();
        drain::insert_drain(&manager.drains, "r2");
        let drain = drain::get_drain(&manager.drains, "r2").expect("registered drain");
        let waiter = {
            let manager = manager.clone();
            tokio::spawn(async move { manager.wait_drain("r2", Duration::from_secs(5)).await })
        };
        tokio::time::sleep(Duration::from_millis(50)).await;
        drain.push(b"wake-me", || drain.notify_one());
        let got = waiter
            .await
            .expect("waiter task panicked")
            .expect("open drain must return Some");
        assert_eq!(got, b"wake-me");
    }

    /// 中毒容忍：`sessions` poison 后 `close_session` 不 panic（tolerate-and-continue）。
    #[test]
    fn poisoned_sessions_close_does_not_panic() {
        use crate::common::terminal::types::{TerminalSession, TerminalStatus};
        let manager = RemoteTerminalManager::new();
        manager.sessions.lock().unwrap().insert(
            "r-poison".into(),
            TerminalSession {
                id: "r-poison".into(),
                pid: None,
                status: TerminalStatus::Idle,
                history: Vec::new(),
                agent: None,
            },
        );
        drain::insert_drain(&manager.drains, "r-poison");
        poison(&manager.sessions);
        manager.close_session("r-poison");
        let sessions = manager
            .sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        assert!(!sessions.contains_key("r-poison"));
        assert_eq!(drain::session_ids(&manager.drains), Vec::<String>::new());
    }

    /// 中毒容忍：`ssh_handles` poison 后 `resize_session` 不报错（内部容忍，签名不变）。
    #[test]
    fn poisoned_ssh_handles_resize_tolerated() {
        let manager = RemoteTerminalManager::new();
        poison(&manager.ssh_handles);
        manager
            .resize_session("missing", 80, 24)
            .expect("poisoned resize must be tolerated");
        manager.close_session("missing");
    }

    /// 中毒容忍：`ssh_handles` poison 后 `close_session` 不 panic。
    #[test]
    fn poisoned_ssh_handles_close_does_not_panic() {
        let manager = RemoteTerminalManager::new();
        drain::insert_drain(&manager.drains, "r-poison-2");
        poison(&manager.ssh_handles);
        manager.close_session("r-poison-2");
        assert_eq!(drain::session_ids(&manager.drains), Vec::<String>::new());
    }

    /// D4：`close_all_sessions` 枚举源为 drains——仅 drain 注册（handles 失配）也要被关闭。
    #[test]
    fn close_all_enumerates_drains_on_mismatch() {
        let manager = RemoteTerminalManager::new();
        drain::insert_drain(&manager.drains, "orphan");
        manager.close_all_sessions();
        assert_eq!(drain::session_ids(&manager.drains), Vec::<String>::new());
    }
}
