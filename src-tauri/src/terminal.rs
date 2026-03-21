use crate::state::{AgentConfig, TerminalSession, TerminalStatus};
use anyhow::Result;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{Emitter, Listener};
use uuid::Uuid;

pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 创建 PTY 会话
    ///
    /// 通信机制:
    /// - Rust -> Frontend: emit("terminal-output-{id}", Vec<u8>)
    /// - Frontend -> Rust: emit("terminal-input-{id}", Vec<u8>), 被 listen 捕获
    pub fn create_session(
        &self,
        project_path: &str,
        app_handle: tauri::AppHandle,
    ) -> Result<TerminalSession> {
        let id = Uuid::new_v4().to_string();
        log_info(&format!("[PTY] ====== Creating Session ======"));
        log_info(&format!("[PTY] Session ID: {}", id));
        log_info(&format!("[PTY] Project Path: {}", project_path));

        // 检查路径是否存在
        if !std::path::Path::new(project_path).exists() {
            log_error(&format!("[PTY] Path does not exist: {}", project_path));
            return Err(anyhow::anyhow!(
                "Project path does not exist: {}",
                project_path
            ));
        }

        // 创建 PTY
        log_info("[PTY] Opening PTY...");
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        log_info("[PTY] PTY opened successfully");

        // 启动 bash
        log_info("[PTY] Spawning bash process...");
        let mut cmd = CommandBuilder::new("bash");
        cmd.env("TERM", "xterm-256color");
        cmd.cwd(project_path);

        let child = pair.slave.spawn_command(cmd)?;
        let pid = child.process_id();
        log_info(&format!("[PTY] Bash spawned, PID: {:?}", pid));

        // 获取 reader 和 writer
        log_info("[PTY] Getting reader/writer...");
        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        log_info("[PTY] Reader/writer obtained");

        // 创建 session 对象
        let session = TerminalSession {
            id: id.clone(),
            pid,
            status: TerminalStatus::Idle,
            history: Vec::new(),
            agent: None,
        };

        self.sessions
            .lock()
            .unwrap()
            .insert(id.clone(), session.clone());

        // === Reader 线程: PTY 读取 -> 发送到 Frontend ===
        let read_id = id.clone();
        let read_handle = app_handle.clone();
        thread::Builder::new()
            .name(format!("pty-reader-{}", &id[..8]))
            .spawn(move || {
                log_info(&format!("[PTY-READER] Thread started for {}", read_id));
                let mut buf = [0u8; 8192];
                let mut total_bytes = 0;

                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => {
                            log_info(&format!("[PTY-READER] EOF reached for {}", read_id));
                            break;
                        }
                        Ok(n) => {
                            total_bytes += n;
                            let data = buf[..n].to_vec();
                            let event_name = format!("terminal-output-{}", read_id);

                            // 打印部分输出用于调试
                            let preview = String::from_utf8_lossy(&data);
                            let preview_str: String = preview.chars().take(50).collect();
                            log_info(&format!(
                                "[PTY-READER] Read {} bytes (total: {}), preview: {:?}",
                                n, total_bytes, preview_str
                            ));

                            if let Err(e) = read_handle.emit(&event_name, &data) {
                                log_error(&format!("[PTY-READER] Emit error: {}", e));
                                break;
                            }
                        }
                        Err(e) => {
                            log_error(&format!("[PTY-READER] Read error for {}: {}", read_id, e));
                            break;
                        }
                    }
                }
                log_info(&format!(
                    "[PTY-READER] Thread ended for {} (total bytes: {})",
                    read_id, total_bytes
                ));
            })?;

        // === 监听 Frontend 输入事件: Frontend -> PTY 写入 ===
        let write_id = id.clone();
        let writer_mutex = Arc::new(Mutex::new(writer));
        let writer_clone = writer_mutex.clone();

        log_info(&format!(
            "[PTY] Registering input listener: terminal-input-{}",
            id
        ));
        app_handle.listen(&format!("terminal-input-{}", id), move |event| {
            log_info(&format!(
                "[PTY-WRITER] Received input event for {}",
                write_id
            ));
            // 解析前端发送的字节数据
            match serde_json::from_str::<Vec<u8>>(event.payload()) {
                Ok(data) => {
                    log_info(&format!("[PTY-WRITER] Writing {} bytes to PTY", data.len()));
                    if let Ok(mut w) = writer_clone.lock() {
                        if let Err(e) = w.write_all(&data) {
                            log_error(&format!("[PTY-WRITER] Write error for {}: {}", write_id, e));
                        } else {
                            log_info("[PTY-WRITER] Write successful");
                        }
                    } else {
                        log_error("[PTY-WRITER] Failed to lock writer");
                    }
                }
                Err(e) => {
                    log_error(&format!("[PTY-WRITER] Failed to parse input data: {}", e));
                }
            }
        });

        log_info(&format!("[PTY] Session {} fully initialized", &id[..8]));
        log_info(&format!(
            "[PTY] Events: terminal-input-{} (listen), terminal-output-{} (emit)",
            &id[..8],
            &id[..8]
        ));
        Ok(session)
    }

    pub fn close_session(&self, session_id: &str) {
        log_info(&format!("[PTY] Closing session {}", session_id));
        self.sessions.lock().unwrap().remove(session_id);
    }

    pub fn get_session(&self, session_id: &str) -> Option<TerminalSession> {
        self.sessions.lock().unwrap().get(session_id).cloned()
    }

    pub fn list_sessions(&self) -> Vec<TerminalSession> {
        self.sessions.lock().unwrap().values().cloned().collect()
    }

    pub fn set_session_agent(&self, session_id: &str, agent: AgentConfig) {
        if let Some(session) = self.sessions.lock().unwrap().get_mut(session_id) {
            session.agent = Some(agent);
        }
    }

    pub fn update_session_status(&self, session_id: &str, status: TerminalStatus) {
        if let Some(session) = self.sessions.lock().unwrap().get_mut(session_id) {
            session.status = status;
        }
    }
}

fn log_info(msg: &str) {
    println!("{}", msg);
}

fn log_error(msg: &str) {
    eprintln!("{}", msg);
}
