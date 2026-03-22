use crate::state::{AgentConfig, TerminalSession, TerminalStatus};
use anyhow::Result;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{Emitter, Listener};
use uuid::Uuid;

struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    // 保存子进程句柄，用于 close 时 wait() 回收，避免僵尸进程
    child: Box<dyn Child + Send + Sync>,
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
        cols: u16,
        rows: u16,
        shell_override: Option<String>,
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
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        log_info(&format!("[PTY] PTY opened ({}x{})", cols, rows));

        // Shell 优先级：前端传入 > $SHELL 环境变量 > 平台默认
        // Windows 默认 powershell.exe -ExecutionPolicy Bypass -NoLogo
        // Linux/macOS fallback 链：$SHELL -> /bin/bash -> /bin/sh
        let mut cmd = if let Some(ref s) = shell_override {
            if !s.is_empty() {
                log_info(&format!("[PTY] Using configured shell: {}", s));
                Self::build_shell_cmd(s)
            } else {
                Self::default_shell_cmd()
            }
        } else {
            Self::default_shell_cmd()
        };
        cmd.env("TERM", "xterm-256color");
        cmd.cwd(project_path);

        let child = pair.slave.spawn_command(cmd)?;
        let pid = child.process_id();
        log_info(&format!("[PTY] Shell spawned, PID: {:?}", pid));

        // 问题三：spawn_command 后立即 drop slave，确保 Linux 上
        // 所有 slave fd 关闭后 master read() 能在子进程退出时返回 EOF
        drop(pair.slave);

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

        // 保存 master 和 child 供 resize / close 使用
        self.pty_handles.lock().unwrap().insert(
            id.clone(),
            PtyHandle {
                master: pair.master,
                child,
            },
        );

        // === Reader 线程: PTY 读取 -> 发送到 Frontend ===
        let read_id = id.clone();
        let read_handle = app_handle.clone();
        let read_sessions = self.sessions.clone();
        let read_pty_handles = self.pty_handles.clone();
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
                // 管道关闭/EOF：
                // 1. 从 pty_handles 取出 PtyHandle，drop master + wait child 回收进程
                // 2. 清理 session
                // 3. 通知前端重建终端
                log_info(&format!(
                    "[PTY-READER] Session {} closed, cleaning up",
                    &read_id[..8]
                ));
                if let Some(mut handle) = read_pty_handles.lock().unwrap().remove(&read_id) {
                    // 先 drop master（关闭 PTY master 端）
                    drop(handle.master);
                    // 再 wait child 回收僵尸进程
                    if let Err(e) = handle.child.wait() {
                        log_error(&format!("[PTY-READER] wait() error: {}", e));
                    }
                }
                read_sessions.lock().unwrap().remove(&read_id);
                let close_event = format!("terminal-closed-{}", read_id);
                if let Err(e) = read_handle.emit(&close_event, ()) {
                    log_error(&format!("[PTY-READER] Failed to emit close event: {}", e));
                }
            })?;

        // === 监听 Frontend 输入事件: Frontend -> PTY 写入 ===
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

    /// 根据 shell 路径构建 CommandBuilder，PowerShell 系列自动追加必要参数
    fn build_shell_cmd(shell: &str) -> CommandBuilder {
        let name = std::path::Path::new(shell)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(shell)
            .to_lowercase();

        if name == "powershell.exe" || name == "powershell" || name == "pwsh.exe" || name == "pwsh"
        {
            let mut c = CommandBuilder::new(shell);
            c.arg("-ExecutionPolicy");
            c.arg("Bypass");
            c.arg("-NoLogo");
            c
        } else {
            CommandBuilder::new(shell)
        }
    }

    /// 根据平台返回默认 shell CommandBuilder
    fn default_shell_cmd() -> CommandBuilder {
        if cfg!(target_os = "windows") {
            let mut c = CommandBuilder::new("powershell.exe");
            c.arg("-ExecutionPolicy");
            c.arg("Bypass");
            c.arg("-NoLogo");
            log_info("[PTY] Using default shell: powershell.exe");
            c
        } else {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| {
                if std::path::Path::new("/bin/bash").exists() {
                    "/bin/bash".to_string()
                } else {
                    "/bin/sh".to_string()
                }
            });
            log_info(&format!("[PTY] Using default shell: {}", shell));
            CommandBuilder::new(shell)
        }
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
        // 从 pty_handles 移除时，PtyHandle drop 会关闭 master；
        // child 的 drop 在 reader 线程中已通过 wait() 处理，
        // 若 close_session 先于 reader 线程退出被调用，这里的 drop
        // 会关闭 master，促使 reader 的 read() 返回 EOF 并完成 wait()
        if let Some(mut handle) = self.pty_handles.lock().unwrap().remove(session_id) {
            drop(handle.master);
            // 非阻塞尝试 wait，若子进程尚未退出则忽略错误
            let _ = handle.child.wait();
        }
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
