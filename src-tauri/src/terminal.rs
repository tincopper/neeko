use crate::state::{TerminalSession, TerminalStatus};
use anyhow::Result;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Emitter, EventId, Listener};
use uuid::Uuid;

struct PtyHandle {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    /// Tauri event listener ID for terminal-input-{id}，关闭时需注销
    input_listener_id: EventId,
    /// 用于跨线程 kill 子进程
    app_handle: tauri::AppHandle,
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
        working_dir: Option<String>,
        app_handle: tauri::AppHandle,
    ) -> Result<TerminalSession> {
        let id = Uuid::new_v4().to_string();
        // 实际工作目录：优先使用调用方指定的 working_dir（worktree 场景），
        // 否则回退到项目根路径
        let cwd = working_dir.as_deref().unwrap_or(project_path);
        log_info(&format!("[PTY] Session ID: {}", id));
        log_info(&format!("[PTY] Working Dir: {}", cwd));

        if !std::path::Path::new(cwd).exists() {
            return Err(anyhow::anyhow!("Working directory does not exist: {}", cwd));
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
        // Unix：设置 UTF-8 环境变量，确保中文字符正确处理
        #[cfg(unix)]
        {
            cmd.env("LANG", "en_US.UTF-8");
            cmd.env("LC_ALL", "en_US.UTF-8");
            cmd.env("LC_CTYPE", "en_US.UTF-8");
        }
        cmd.cwd(cwd);

        let child = pair.slave.spawn_command(cmd)?;
        let pid = child.process_id();
        log_info(&format!("[PTY] Shell spawned, PID: {:?}", pid));

        // spawn_command 后立即 drop slave，确保 Linux 上
        // 所有 slave fd 关闭后 master read() 能在子进程退出时返回 EOF
        drop(pair.slave);

        // Unix：禁用 PTY master 的本地回显，由前端负责显示用户输入，
        // 避免 IME 中文输入重复显示问题
        #[cfg(unix)]
        {
            if let Some(fd) = pair.master.as_raw_fd() {
                if let Err(e) = disable_echo(fd) {
                    log_error(&format!("[PTY] Failed to disable echo: {}", e));
                } else {
                    log_info("[PTY] Echo disabled for IME support");
                }
            }
        }

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

        // === 监听 Frontend 输入事件: Frontend -> PTY 写入 ===
        // 保存 listener_id，关闭 session 时注销，避免 writer Arc 泄漏
        let writer_mutex = Arc::new(Mutex::new(writer));
        let writer_clone = writer_mutex.clone();
        let input_listener_id =
            app_handle.listen(&format!("terminal-input-{}", id), move |event| {
                match serde_json::from_str::<Vec<u8>>(event.payload()) {
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
                }
            });

        // 保存 master、child、listener_id 和 app_handle
        self.pty_handles.lock().unwrap().insert(
            id.clone(),
            PtyHandle {
                master: pair.master,
                child,
                input_listener_id,
                app_handle: app_handle.clone(),
            },
        );

        // === Watcher 线程: 检测子进程退出 -> drop master 解除 reader 阻塞 ===
        //
        // Windows ConPTY：shell 退出后 master read() 永久阻塞，
        // watcher 检测到退出后主动 drop master 使 read() 返回错误。
        let watch_id = id.clone();
        let watch_pty_handles = self.pty_handles.clone();
        let watch_sessions = self.sessions.clone();
        let watch_handle = app_handle.clone();
        thread::Builder::new()
            .name(format!("pty-watcher-{}", &id[..8]))
            .spawn(move || {
                log_info(&format!(
                    "[PTY-WATCHER] Thread started for {}",
                    &watch_id[..8]
                ));

                loop {
                    let exited = {
                        let mut handles = watch_pty_handles.lock().unwrap();
                        if let Some(handle) = handles.get_mut(&watch_id) {
                            match handle.child.try_wait() {
                                Ok(Some(_)) => true,
                                Ok(None) => false,
                                Err(_) => true,
                            }
                        } else {
                            // PtyHandle 已被 close_session 移除，直接退出
                            log_info(&format!(
                                "[PTY-WATCHER] Handle gone, exiting for {}",
                                &watch_id[..8]
                            ));
                            return;
                        }
                    };

                    if exited {
                        log_info(&format!(
                            "[PTY-WATCHER] Child exited for {}, cleaning up",
                            &watch_id[..8]
                        ));
                        // 取出 PtyHandle，注销 input 监听器，drop master 和 child
                        if let Some(handle) = watch_pty_handles.lock().unwrap().remove(&watch_id) {
                            handle.app_handle.unlisten(handle.input_listener_id);
                            drop(handle.master);
                            drop(handle.child);
                        }
                        watch_sessions.lock().unwrap().remove(&watch_id);
                        // 通知前端重建终端
                        let close_event = format!("terminal-closed-{}", watch_id);
                        if let Err(e) = watch_handle.emit(&close_event, ()) {
                            log_error(&format!("[PTY-WATCHER] Failed to emit close event: {}", e));
                        }
                        return;
                    }

                    thread::sleep(Duration::from_millis(100));
                }
            })?;

        // === Reader 线程: PTY 输出 -> Frontend ===
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

        log_info(&format!("[PTY] Session {} ready", &id[..8]));
        Ok(session)
    }

    /// 创建 WSL 终端会话
    pub fn create_wsl_session(
        &self,
        distro: &str,
        project_path: &str,
        cols: u16,
        rows: u16,
        app_handle: tauri::AppHandle,
    ) -> Result<TerminalSession> {
        let id = Uuid::new_v4().to_string();
        log_info(&format!("[WSL] Session ID: {}", id));
        log_info(&format!("[WSL] Distro: {}", distro));
        log_info(&format!("[WSL] Working Dir: {}", project_path));

        // 创建 PTY
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        log_info(&format!("[WSL] PTY opened ({}x{})", cols, rows));

        // 构建 wsl.exe 命令
        let mut cmd = CommandBuilder::new("wsl.exe");
        cmd.arg("-d");
        cmd.arg(distro);
        cmd.arg("--cd");
        cmd.arg(project_path);
        cmd.env("TERM", "xterm-256color");
        cmd.env("LANG", "en_US.UTF-8");
        cmd.env("LC_ALL", "en_US.UTF-8");
        // 强制 wsl.exe 输出 UTF-8（避免 UTF-16LE 乱码）
        cmd.env("WSL_UTF8", "1");

        let child = pair.slave.spawn_command(cmd)?;
        let pid = child.process_id();
        log_info(&format!("[WSL] Shell spawned, PID: {:?}", pid));

        // spawn_command 后立即 drop slave
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

        // 监听 Frontend 输入事件
        let writer_mutex = Arc::new(Mutex::new(writer));
        let writer_clone = writer_mutex.clone();
        let input_listener_id =
            app_handle.listen(&format!("terminal-input-{}", id), move |event| {
                match serde_json::from_str::<Vec<u8>>(event.payload()) {
                    Ok(data) => {
                        if let Ok(mut w) = writer_clone.lock() {
                            if let Err(e) = w.write_all(&data) {
                                log_error(&format!("[WSL-WRITER] Write error: {}", e));
                            }
                        }
                    }
                    Err(e) => {
                        log_error(&format!(
                            "[WSL-WRITER] Parse error: {} payload={}",
                            e,
                            event.payload()
                        ));
                    }
                }
            });

        // 保存 handle
        self.pty_handles.lock().unwrap().insert(
            id.clone(),
            PtyHandle {
                master: pair.master,
                child,
                input_listener_id,
                app_handle: app_handle.clone(),
            },
        );

        // Watcher 线程
        let watch_id = id.clone();
        let watch_pty_handles = self.pty_handles.clone();
        let watch_sessions = self.sessions.clone();
        let watch_handle = app_handle.clone();
        thread::Builder::new()
            .name(format!("wsl-watcher-{}", &id[..8]))
            .spawn(move || {
                log_info(&format!(
                    "[WSL-WATCHER] Thread started for {}",
                    &watch_id[..8]
                ));

                loop {
                    let exited = {
                        let mut handles = watch_pty_handles.lock().unwrap();
                        if let Some(handle) = handles.get_mut(&watch_id) {
                            match handle.child.try_wait() {
                                Ok(Some(_)) => true,
                                Ok(None) => false,
                                Err(_) => true,
                            }
                        } else {
                            log_info(&format!(
                                "[WSL-WATCHER] Handle gone, exiting for {}",
                                &watch_id[..8]
                            ));
                            return;
                        }
                    };

                    if exited {
                        log_info(&format!(
                            "[WSL-WATCHER] Child exited for {}, cleaning up",
                            &watch_id[..8]
                        ));
                        if let Some(handle) = watch_pty_handles.lock().unwrap().remove(&watch_id) {
                            handle.app_handle.unlisten(handle.input_listener_id);
                            drop(handle.master);
                            drop(handle.child);
                        }
                        watch_sessions.lock().unwrap().remove(&watch_id);
                        let close_event = format!("terminal-closed-{}", watch_id);
                        if let Err(e) = watch_handle.emit(&close_event, ()) {
                            log_error(&format!("[WSL-WATCHER] Failed to emit close event: {}", e));
                        }
                        return;
                    }

                    thread::sleep(Duration::from_millis(100));
                }
            })?;

        // Reader 线程
        let read_id = id.clone();
        let read_handle = app_handle.clone();
        thread::Builder::new()
            .name(format!("wsl-reader-{}", &id[..8]))
            .spawn(move || {
                log_info(&format!(
                    "[WSL-READER] Thread started for {}",
                    &read_id[..8]
                ));
                let mut buf = [0u8; 4096];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => {
                            log_info("[WSL-READER] EOF");
                            break;
                        }
                        Ok(n) => {
                            let data = buf[..n].to_vec();
                            let event_name = format!("terminal-output-{}", read_id);
                            if let Err(e) = read_handle.emit(&event_name, &data) {
                                log_error(&format!("[WSL-READER] Emit error: {}", e));
                                break;
                            }
                        }
                        Err(e) => {
                            log_info(&format!("[WSL-READER] Read ended: {}", e));
                            break;
                        }
                    }
                }
                log_info(&format!(
                    "[WSL-READER] Thread exiting for {}",
                    &read_id[..8]
                ));
            })?;

        log_info(&format!("[WSL] Session {} ready", &id[..8]));
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

    /// 关闭单个 session：方案 B 优雅退出
    /// 1. 先发优雅退出信号（Linux: SIGTERM，Windows: TerminateProcess 前先等）
    /// 2. 最多等待 GRACEFUL_TIMEOUT_SECS 秒
    /// 3. 超时后强制 kill
    pub fn close_session(&self, session_id: &str) {
        log_info(&format!(
            "[PTY] Closing session {}",
            &session_id[..8.min(session_id.len())]
        ));
        self.sessions.lock().unwrap().remove(session_id);

        if let Some(mut handle) = self.pty_handles.lock().unwrap().remove(session_id) {
            // 注销 input 监听器，释放 writer Arc
            handle.app_handle.unlisten(handle.input_listener_id);
            // drop master：关闭 PTY master 端，通知子进程 HUP，同时解除 reader 阻塞
            drop(handle.master);
            // 优雅退出子进程
            graceful_kill(&mut *handle.child);
        }
    }

    /// 关闭所有存活 session，用于应用退出时统一清理
    pub fn close_all_sessions(&self) {
        log_info("[PTY] Closing all sessions...");
        let ids: Vec<String> = self.pty_handles.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.close_session(&id);
        }
        log_info("[PTY] All sessions closed");
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
            let c = CommandBuilder::new(&shell);
            c
        }
    }
}

/// Unix 专用：禁用 PTY master 的本地回显（ECHO/ECHOE/ECHOK/ECHONL）
/// 前端接管用户输入显示，避免 IME 中文输入与 PTY 回显叠加导致重复字符
#[cfg(unix)]
fn disable_echo(fd: std::os::unix::io::RawFd) -> anyhow::Result<()> {
    use std::mem::MaybeUninit;
    unsafe {
        let mut termios = MaybeUninit::<libc::termios>::uninit();
        if libc::tcgetattr(fd, termios.as_mut_ptr()) != 0 {
            return Err(anyhow::anyhow!("tcgetattr failed"));
        }
        let mut termios = termios.assume_init();
        // 禁用所有回显标志（ECHO/ECHOE/ECHOK/ECHONL）
        // macOS 上 shell 启动后可能通过 stty 重新启用回显，
        // 禁用全部标志可以防止 shell 覆盖设置
        termios.c_lflag &= !(libc::ECHO | libc::ECHOE | libc::ECHOK | libc::ECHONL);
        if libc::tcsetattr(fd, libc::TCSANOW, &termios) != 0 {
            return Err(anyhow::anyhow!("tcsetattr failed"));
        }
    }
    Ok(())
}

/// 方案 B 优雅终止：
/// - Linux/macOS：先 SIGTERM，等待最多 3 秒，超时后 SIGKILL
/// - Windows：portable_pty kill() 即 TerminateProcess（无 SIGTERM 等价），
///   先等待最多 3 秒让进程自然退出（PTY master 已关闭，shell 应收到 HUP），
///   超时后强制 TerminateProcess
const GRACEFUL_TIMEOUT_SECS: u64 = 3;

fn graceful_kill(child: &mut dyn Child) {
    let pid = match child.process_id() {
        Some(p) => p,
        None => {
            // 没有 pid，直接强杀
            let _ = child.kill();
            let _ = child.wait();
            return;
        }
    };

    #[cfg(unix)]
    {
        // Linux/macOS：发 SIGTERM，等待最多 3 秒，超时后 SIGKILL
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
        log_info(&format!("[PTY] Sent SIGTERM to PID {}", pid));

        let deadline = Instant::now() + Duration::from_secs(GRACEFUL_TIMEOUT_SECS);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => {
                    log_info(&format!("[PTY] PID {} exited after SIGTERM", pid));
                    return;
                }
                Ok(None) => {
                    if Instant::now() >= deadline {
                        break;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
                Err(_) => return,
            }
        }
        // 超时，SIGKILL
        log_info(&format!(
            "[PTY] PID {} did not exit after {}s, sending SIGKILL",
            pid, GRACEFUL_TIMEOUT_SECS
        ));
        unsafe {
            libc::kill(pid as i32, libc::SIGKILL);
        }
        let _ = child.wait();
    }

    #[cfg(windows)]
    {
        // Windows：PTY master 已 drop（发送了 HUP），等待子进程自然退出最多 3 秒
        log_info(&format!(
            "[PTY] Waiting up to {}s for PID {} to exit gracefully",
            GRACEFUL_TIMEOUT_SECS, pid
        ));
        let deadline = Instant::now() + Duration::from_secs(GRACEFUL_TIMEOUT_SECS);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => {
                    log_info(&format!("[PTY] PID {} exited gracefully", pid));
                    return;
                }
                Ok(None) => {
                    if Instant::now() >= deadline {
                        break;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
                Err(_) => return,
            }
        }
        // 超时，TerminateProcess
        log_info(&format!(
            "[PTY] PID {} did not exit after {}s, force killing",
            pid, GRACEFUL_TIMEOUT_SECS
        ));
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn log_info(msg: &str) {
    log::info!("{}", msg);
}

fn log_error(msg: &str) {
    log::error!("{}", msg);
}
