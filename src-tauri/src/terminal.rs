use crate::state::{AgentConfig, TerminalSession, TerminalStatus};
use anyhow::Result;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{Emitter, Listener};
use uuid::Uuid;

struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
}

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

    /// 创建 PTY 会话
    pub fn create_session(
        &self,
        project_path: &str,
        app_handle: tauri::AppHandle,
    ) -> Result<TerminalSession> {
        let id = Uuid::new_v4().to_string();
        log_info(&format!("[PTY] Session ID: {}", id));
        log_info(&format!("[PTY] Project Path: {}", project_path));

        if !std::path::Path::new(project_path).exists() {
            return Err(anyhow::anyhow!(
                "Project path does not exist: {}",
                project_path
            ));
        }

        // 创建 PTY
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        log_info("[PTY] PTY opened");

        // 启动 shell
        let shell = if cfg!(target_os = "windows") {
            "cmd.exe"
        } else {
            "bash"
        };
        let mut cmd = CommandBuilder::new(shell);
        cmd.env("TERM", "xterm-256color");
        cmd.cwd(project_path);

        let child = pair.slave.spawn_command(cmd)?;
        let pid = child.process_id();
        log_info(&format!("[PTY] Shell spawned, PID: {:?}", pid));

        // 获取 reader 和 writer
        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

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

        // 保存 master 供 resize 使用
        self.pty_handles.lock().unwrap().insert(
            id.clone(),
            PtyHandle {
                master: pair.master,
            },
        );

        // === Reader 线程: PTY 读取 -> 发送到 Frontend ===
        let read_id = id.clone();
        let read_handle = app_handle.clone();
        thread::Builder::new()
            .name(format!("pty-reader-{}", &id[..8]))
            .spawn(move || {
                log_info(&format!(
                    "[PTY-READER] Thread started for {}",
                    &read_id[..8]
                ));
                let mut buf = [0u8; 4096];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => {
                            log_info("[PTY-READER] EOF");
                            break;
                        }
                        Ok(n) => {
                            let data = buf[..n].to_vec();
                            let event_name = format!("terminal-output-{}", read_id);
                            if let Err(e) = read_handle.emit(&event_name, &data) {
                                log_error(&format!("[PTY-READER] Emit error: {}", e));
                                break;
                            }
                        }
                        Err(e) => {
                            log_error(&format!("[PTY-READER] Read error: {}", e));
                            break;
                        }
                    }
                }
            })?;

        // === 监听 Frontend 输入事件: Frontend -> PTY 写入 ===
        let write_id = id.clone();
        let writer_mutex = Arc::new(Mutex::new(writer));
        let writer_clone = writer_mutex.clone();

        app_handle.listen(
            &format!("terminal-input-{}", id),
            move |event| match serde_json::from_str::<Vec<u8>>(event.payload()) {
                Ok(data) => {
                    if let Ok(mut w) = writer_clone.lock() {
                        if let Err(e) = w.write_all(&data) {
                            log_error(&format!("[PTY-WRITER] Write error: {}", e));
                        }
                    }
                }
                Err(e) => {
                    log_error(&format!(
                        "[PTY-WRITER] Parse error: {} payload={}",
                        e,
                        event.payload()
                    ));
                }
            },
        );

        log_info(&format!("[PTY] Session {} ready", &id[..8]));
        Ok(session)
    }

    pub fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> Result<()> {
        if let Some(handle) = self.pty_handles.lock().unwrap().get(session_id) {
            handle.master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })?;
            log_info(&format!(
                "[PTY] Resized {} to {}x{}",
                &session_id[..8],
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
        self.sessions.lock().unwrap().remove(session_id);
        self.pty_handles.lock().unwrap().remove(session_id);
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
