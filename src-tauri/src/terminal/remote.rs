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

        self.sessions
            .lock()
            .map_err(|e| anyhow::anyhow!("Sessions lock poisoned: {}", e))?
            .insert(id.clone(), terminal_session.clone());

        self.drains
            .lock()
            .map_err(|e| anyhow::anyhow!("Drains lock poisoned: {}", e))?
            .insert(
                id.clone(),
                Arc::new(crate::common::terminal::drain::SessionDrain::default()),
            );

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
        if let Ok(mut handles) = self.ssh_handles.lock() {
            handles.insert(
                id.clone(),
                SSHHandle {
                    input_tx,
                    resize_tx,
                    input_listener_id,
                    app_handle: app_handle.clone(),
                },
            );
        }

        let session_drain = self
            .drains
            .lock()
            .map_err(|e| anyhow::anyhow!("Drains lock poisoned: {}", e))?
            .get(&id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Drain queue missing for session {id}"))?;

        // 用 make_writer() 分离读写端，避免 select! 中的可变借用冲突
        let mut writer = channel.make_writer();

        // IO 任务：在独立 tokio 线程里同时处理读写和 resize，消除锁竞争
        let io_id = id.clone();
        thread::Builder::new()
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
                                        // terminal_drain 拉二进制块（全局共享轮询器
                                        // 100ms tick 驱动，wake hint 事件已退役）。
                                        // Mutex 临界区极短，不违反阻塞红线。
                                        //
                                        // 背压契约对齐本地泵（design.md §8.2）：
                                        // 满载停泊重试，绝不丢字节。期间
                                        // input/resize 消息暂存于 unbounded
                                        // channel 不丢失；会话已关闭（closed）
                                        // 时 push 黑洞吸收，循环自然结束。
                                        let session_drain = io_drain.clone();
                                        // Wake hint 退役（方案 B 去 eval 化）：
                                        // 前端改为全局轮询器驱动 credit-pull，
                                        // `terminal-drain-{id}` 不再被监听；即使
                                        // 无 listener 也应避免无意义 IPC 往返。
                                        while !session_drain.push(&data, || {}) {
                                            std::thread::sleep(std::time::Duration::from_millis(2));
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
            })?;

        log_info(&format!("[SSH] Session {} ready", &id[..8]));
        Ok(terminal_session)
    }

    /// Resize the PTY of an active SSH terminal session.
    pub fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> Result<()> {
        if let Ok(handles) = self.ssh_handles.lock() {
            if let Some(handle) = handles.get(session_id) {
                let _ = handle.resize_tx.send((u32::from(cols), u32::from(rows)));
                log_info(&format!(
                    "[SSH] Resize {}x{} sent to session {}",
                    cols,
                    rows,
                    &session_id[..8]
                ));
            }
        }
        Ok(())
    }

    /// Close all active SSH terminal sessions.
    pub fn close_all_sessions(&self) {
        log_info("[SSH] Closing all sessions...");
        let ids: Vec<String> = self
            .ssh_handles
            .lock()
            .map(|h| h.keys().cloned().collect())
            .unwrap_or_default();
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
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(session_id);
        }

        if let Ok(mut handles) = self.ssh_handles.lock() {
            if let Some(handle) = handles.remove(session_id) {
                // 注销 input 监听器
                handle.app_handle.unlisten(handle.input_listener_id);
                // input_tx drop 后，IO 任务的 recv() 会返回 None，任务自然退出
            }
        }

        // 先 close 再移除：孤儿 IO 任务的后续 push 被黑洞吸收，读到 EOF/Close
        // 自然退出（对齐本地 TerminalManager::take_session_handle 语义）。
        if let Ok(mut drains) = self.drains.lock() {
            if let Some(d) = drains.remove(session_id) {
                d.close();
            }
        }
    }

    /// Takes all buffered output bytes for a session (credit-pull protocol).
    #[must_use]
    pub fn take_drain(&self, session_id: &str) -> Option<Vec<u8>> {
        let drain = self
            .drains
            .lock()
            .ok()
            .and_then(|m| m.get(session_id).cloned())?;
        Some(drain.take_and_rearm(|| {
            // Wake hint 退役（方案 B 去 eval 化）：前端全局轮询器拉空为止，
            // 竞态补发闭包为空，语义保留（参见 TerminalManager::take_drain）。
        }))
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
