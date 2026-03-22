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

        // spawn_command 后立即 drop slave，确保 Linux 上
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

        // 保存 master 和 child 供 resize / close / watcher 使用
        self.pty_handles.lock().unwrap().insert(
            id.clone(),
            PtyHandle {
                master: pair.master,
                child,
            },
        );

        // === Watcher 线程: wait() 子进程退出 -> 主动 drop master 解除 reader 阻塞 ===
        //
        // Windows ConPTY 问题：shell 退出后 master read() 不会自动返回 EOF，
        // 会永久阻塞。通过独立 watcher 线程 wait() 子进程，退出后从 pty_handles
        // 移除 PtyHandle（drop master），使 reader 线程的 read() 收到错误并退出。
        let watch_id = id.clone();
        let watch_pty_handles = self.pty_handles.clone();
        let watch_sessions = self.sessions.clone();
        let watch_handle = app_handle.clone();
        thread::Builder::new()
            .name(format!("pty-watcher-{}", &id[..8]))
            .spawn(move || {
                // 从 pty_handles 取出 child 来 wait（不取 master，resize 还可能在用）
                // 用一个单独的 Mutex 包裹 child，watcher 和 close_session 竞争取走它
                log_info(&format!(
                    "[PTY-WATCHER] Thread started for {}",
                    &watch_id[..8]
                ));

                // 轮询子进程是否退出（portable_pty 的 try_wait 在 Windows 可用）
                loop {
                    let exited = {
                        let mut handles = watch_pty_handles.lock().unwrap();
                        if let Some(handle) = handles.get_mut(&watch_id) {
                            match handle.child.try_wait() {
                                Ok(Some(_)) => true, // 已退出
                                Ok(None) => false,   // 还在运行
                                Err(_) => true,      // 出错，视为已退出
                            }
                        } else {
                            // PtyHandle 已被 close_session 移除，直接退出 watcher
                            return;
                        }
                    };

                    if exited {
                        log_info(&format!(
                            "[PTY-WATCHER] Child exited for {}, dropping master to unblock reader",
                            &watch_id[..8]
                        ));
                        // 移除 PtyHandle：drop master 使 reader read() 返回错误
                        // drop child 完成进程资源回收
                        if let Some(handle) = watch_pty_handles.lock().unwrap().remove(&watch_id) {
                            drop(handle.master);
                            drop(handle.child);
                        }
                        // 清理 session
                        watch_sessions.lock().unwrap().remove(&watch_id);
                        // 通知前端
                        let close_event = format!("terminal-closed-{}", watch_id);
                        if let Err(e) = watch_handle.emit(&close_event, ()) {
                            log_error(&format!("[PTY-WATCHER] Failed to emit close event: {}", e));
                        }
                        return;
                    }

                    // 子进程还在运行，100ms 后再检查
                    thread::sleep(std::time::Duration::from_millis(100));
                }
            })?;

        // === Reader 线程: PTY 读取 -> 发送到 Frontend ===
        //
        // Reader 只负责转发输出，不再负责清理（watcher 负责）。
        // 当 watcher drop master 后，read() 会返回错误，reader 静默退出。
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
                            // watcher drop master 后 read() 返回错误，属正常退出流程
                            log_info(&format!("[PTY-READER] Read ended: {}", e));
                            break;
                        }
                    }
                }
                log_info(&format!(
                    "[PTY-READER] Thread exiting for {}",
                    &read_id[..8]
                ));
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
        // 移除 PtyHandle：drop master 使 reader read() 返回错误；
        // watcher 线程会检测到 PtyHandle 已不存在而自行退出
        if let Some(mut handle) = self.pty_handles.lock().unwrap().remove(session_id) {
            drop(handle.master);
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
}

fn log_info(msg: &str) {
    println!("{}", msg);
}

fn log_error(msg: &str) {
    eprintln!("{}", msg);
}
