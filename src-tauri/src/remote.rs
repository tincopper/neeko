use crate::state::{AuthMethod, TerminalSession, TerminalStatus};
use anyhow::Result;
use russh::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{Emitter, EventId, Listener};
use uuid::Uuid;

struct SSHHandle {
    session: Arc<Mutex<Option<client::Handle<Client>>>>,
    channel: Arc<Mutex<Option<Channel<russh::client::Msg>>>>,
    input_listener_id: EventId,
    app_handle: tauri::AppHandle,
}

pub struct RemoteTerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    ssh_handles: Arc<Mutex<HashMap<String, SSHHandle>>>,
}

struct Client;

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
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

        // 建立 SSH 连接
        let config = client::Config::default();
        let config = Arc::new(config);
        let mut session = client::connect(config, (host, port), Client).await?;

        // 认证
        let auth_result = match auth {
            AuthMethod::Password(password) => {
                session.authenticate_password(username, password).await?
            }
            AuthMethod::KeyFile(key_path) => {
                let key_pair = russh::keys::load_secret_key(key_path, None)?;
                let key_with_hash =
                    russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
                session.authenticate_publickey(username, key_with_hash).await?
            }
            AuthMethod::KeyFileWithPassphrase {
                key_path,
                passphrase,
            } => {
                let key_pair = russh::keys::load_secret_key(key_path, Some(passphrase))?;
                let key_with_hash =
                    russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
                session.authenticate_publickey(username, key_with_hash).await?
            }
        };

        if !auth_result.success() {
            return Err(anyhow::anyhow!("SSH authentication failed"));
        }

        log_info(&format!("[SSH] Authentication successful for {}", username));

        // 打开 channel
        let mut channel = session.channel_open_session().await?;

        // 请求 PTY
        channel
            .request_pty(
                false,
                "xterm-256color",
                cols as u32,
                rows as u32,
                0,
                0,
                &[], // terminal modes
            )
            .await?;

        // 请求 shell
        channel.request_shell(true).await?;

        // 切换到项目目录
        let cd_cmd = format!("cd {}\n", project_path);
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
            .unwrap()
            .insert(id.clone(), terminal_session.clone());

        // 保存 session 和 channel 用于后续操作
        let session_arc = Arc::new(Mutex::new(Some(session)));
        let channel_arc = Arc::new(Mutex::new(Some(channel)));

        // 监听输入事件
        let input_session = session_arc.clone();
        let input_channel = channel_arc.clone();
        let input_listener_id =
            app_handle.listen(&format!("terminal-input-{}", id), move |event| {
                match serde_json::from_str::<Vec<u8>>(event.payload()) {
                    Ok(data) => {
                        if let Ok(mut channel_guard) = input_channel.lock() {
                            if let Some(ref mut ch) = *channel_guard {
                                let _ = futures::executor::block_on(
                                    ch.data(&data[..]),
                                );
                            }
                        }
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

        // 保存 handle
        self.ssh_handles.lock().unwrap().insert(
            id.clone(),
            SSHHandle {
                session: session_arc,
                channel: channel_arc.clone(),
                input_listener_id,
                app_handle: app_handle.clone(),
            },
        );

        // Reader 线程 - 创建新的 channel 用于读取
        let read_session = self.ssh_handles.lock().unwrap().get(&id).unwrap().session.clone();
        let read_id = id.clone();
        let read_handle = app_handle.clone();
        thread::Builder::new()
            .name(format!("ssh-reader-{}", &id[..8]))
            .spawn(move || {
                log_info(&format!(
                    "[SSH-READER] Thread started for {}",
                    &read_id[..8]
                ));

                // 使用 tokio 运行时来处理异步读取
                let rt = tokio::runtime::Runtime::new().unwrap();
                rt.block_on(async {
                    loop {
                        // 检查 channel 是否有消息
                        if let Ok(mut channel_guard) = channel_arc.lock() {
                            if let Some(ref mut ch) = *channel_guard {
                                match ch.wait().await {
                                    Some(ChannelMsg::Data { data }) => {
                                        let event_name = format!("terminal-output-{}", read_id);
                                        let data_vec = data.to_vec();
                                        if let Err(e) = read_handle.emit(&event_name, &data_vec) {
                                            log_error(&format!("[SSH-READER] Emit error: {}", e));
                                            break;
                                        }
                                    }
                                    Some(ChannelMsg::Eof) => {
                                        log_info("[SSH-READER] EOF");
                                        break;
                                    }
                                    Some(ChannelMsg::Close) => {
                                        log_info("[SSH-READER] Channel closed");
                                        break;
                                    }
                                    None => {
                                        log_info("[SSH-READER] Channel disconnected");
                                        break;
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                });

                log_info(&format!(
                    "[SSH-READER] Thread exiting for {}",
                    &read_id[..8]
                ));
            })?;

        log_info(&format!("[SSH] Session {} ready", &id[..8]));
        Ok(terminal_session)
    }

    pub fn resize_session(&self, session_id: &str, _cols: u16, _rows: u16) -> Result<()> {
        // SSH resize 需要异步操作，暂时跳过
        log_info(&format!(
            "[SSH] Resize requested for {} (not implemented yet)",
            &session_id[..8]
        ));
        Ok(())
    }

    pub fn close_session(&self, session_id: &str) {
        log_info(&format!(
            "[SSH] Closing session {}",
            &session_id[..8.min(session_id.len())]
        ));
        self.sessions.lock().unwrap().remove(session_id);

        if let Some(handle) = self.ssh_handles.lock().unwrap().remove(session_id) {
            // 注销 input 监听器
            handle.app_handle.unlisten(handle.input_listener_id);

            // 关闭 channel
            if let Some(channel) = handle.channel.lock().unwrap().take() {
                let _ = futures::executor::block_on(channel.close());
            }

            // 关闭 SSH 会话
            if let Some(session) = handle.session.lock().unwrap().take() {
                let _ = futures::executor::block_on(session.disconnect(
                    russh::Disconnect::ByApplication,
                    "Closing session",
                    "",
                ));
            }
        }
    }

    pub fn close_all_sessions(&self) {
        log_info("[SSH] Closing all sessions...");
        let ids: Vec<String> = self.ssh_handles.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.close_session(&id);
        }
        log_info("[SSH] All sessions closed");
    }
}

fn log_info(msg: &str) {
    log::info!("{}", msg);
}

fn log_error(msg: &str) {
    log::error!("{}", msg);
}
