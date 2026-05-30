use crate::connection::types::AuthMethod;
use crate::terminal::types::{TerminalSession, TerminalStatus};
use crate::theme::common;
use crate::utils::command::ssh_auth;
use anyhow::{Context, Result};
#[allow(clippy::wildcard_imports)]
use russh::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{Emitter, EventId, Listener};
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use uuid::Uuid;

struct SSHHandle {
    /// 用于向 IO 任务发送输入数据的 sender（通过 Drop 关闭 channel 通知 IO 任务退出）
    #[allow(dead_code)]
    input_tx: mpsc::UnboundedSender<Vec<u8>>,
    /// 用于向 IO 任务发送 PTY resize 请求 (cols, rows)
    resize_tx: mpsc::UnboundedSender<(u32, u32)>,
    input_listener_id: EventId,
    app_handle: tauri::AppHandle,
}

#[derive(Clone)]
pub struct RemoteTerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    ssh_handles: Arc<Mutex<HashMap<String, SSHHandle>>>,
}

impl RemoteTerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            ssh_handles: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 创建 SSH 终端会话
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
            .request_pty(false, "xterm-256color", cols as u32, rows as u32, 0, 0, &[])
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

        // mpsc channel：input listener → IO 任务
        let (input_tx, mut input_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        // mpsc channel：resize 请求 (cols, rows) → IO 任务
        let (resize_tx, mut resize_rx) = mpsc::unbounded_channel::<(u32, u32)>();

        // 监听前端输入事件，把数据放入 mpsc
        let tx_clone = input_tx.clone();
        let input_listener_id =
            app_handle.listen(&format!("terminal-input-{}", id), move |event| {
                match serde_json::from_str::<Vec<u8>>(event.payload()) {
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
                }
            });

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

        // 用 make_writer() 分离读写端，避免 select! 中的可变借用冲突
        let mut writer = channel.make_writer();

        // IO 任务：在独立 tokio 线程里同时处理读写和 resize，消除锁竞争
        let io_id = id.clone();
        let read_handle = app_handle.clone();
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
                                        let event_name = format!("terminal-output-{}", io_id);
                                        let data_vec = data.to_vec();
                                        if let Err(e) = read_handle.emit(&event_name, &data_vec) {
                                            log_error(&format!("[SSH-IO] Emit error: {}", e));
                                            break;
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

    pub fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> Result<()> {
        if let Ok(handles) = self.ssh_handles.lock() {
            if let Some(handle) = handles.get(session_id) {
                let _ = handle.resize_tx.send((cols as u32, rows as u32));
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
    }

    /// 测试 SSH 连接是否可用（验证 host/port/username/auth）
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

    /// 列出远程服务器上指定路径下的子目录（用于路径自动补全）
    /// 建立一次性 SSH 连接，执行 ls 并返回目录名列表
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
