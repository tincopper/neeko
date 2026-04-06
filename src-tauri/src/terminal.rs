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
    input_listener_id: EventId,
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
        let cwd = working_dir.as_deref().unwrap_or(project_path);
        log_info(&format!("[PTY] Session ID: {}", id));
        log_info(&format!("[PTY] Working Dir: {}", cwd));

        if !std::path::Path::new(cwd).exists() {
            return Err(anyhow::anyhow!("Working directory does not exist: {}", cwd));
        }

        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        log_info(&format!("[PTY] PTY opened ({}x{})", cols, rows));

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

        drop(pair.slave);

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

        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        let session = TerminalSession {
            id: id.clone(),
            pid,
            status: TerminalStatus::Idle,
            history: Vec::new(),
            agent: None,
        };

        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.insert(id.clone(), session.clone());
        }

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

        if let Ok(mut handles) = self.pty_handles.lock() {
            handles.insert(
                id.clone(),
                PtyHandle {
                    master: pair.master,
                    child,
                    input_listener_id,
                    app_handle: app_handle.clone(),
                },
            );
        }

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
                        match watch_pty_handles.lock() {
                            Ok(mut handles) => {
                                if let Some(handle) = handles.get_mut(&watch_id) {
                                    match handle.child.try_wait() {
                                        Ok(Some(_)) => true,
                                        Ok(None) => false,
                                        Err(_) => true,
                                    }
                                } else {
                                    log_info(&format!(
                                        "[PTY-WATCHER] Handle gone, exiting for {}",
                                        &watch_id[..8]
                                    ));
                                    return;
                                }
                            }
                            Err(_) => return,
                        }
                    };

                    if exited {
                        log_info(&format!(
                            "[PTY-WATCHER] Child exited for {}, cleaning up",
                            &watch_id[..8]
                        ));
                        if let Ok(mut handles) = watch_pty_handles.lock() {
                            if let Some(handle) = handles.remove(&watch_id) {
                                handle.app_handle.unlisten(handle.input_listener_id);
                                drop(handle.master);
                                drop(handle.child);
                            }
                        }
                        if let Ok(mut sessions) = watch_sessions.lock() {
                            sessions.remove(&watch_id);
                        }
                        let close_event = format!("terminal-closed-{}", watch_id);
                        if let Err(e) = watch_handle.emit(&close_event, ()) {
                            log_error(&format!("[PTY-WATCHER] Failed to emit close event: {}", e));
                        }
                        return;
                    }

                    thread::sleep(Duration::from_millis(100));
                }
            })?;

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

        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        log_info(&format!("[WSL] PTY opened ({}x{})", cols, rows));

        let mut cmd = CommandBuilder::new("wsl.exe");
        cmd.arg("-d");
        cmd.arg(distro);
        cmd.arg("--cd");
        cmd.arg(project_path);
        cmd.env("TERM", "xterm-256color");
        cmd.env("LANG", "en_US.UTF-8");
        cmd.env("LC_ALL", "en_US.UTF-8");
        cmd.env("WSL_UTF8", "1");

        let child = pair.slave.spawn_command(cmd)?;
        let pid = child.process_id();
        log_info(&format!("[WSL] Shell spawned, PID: {:?}", pid));

        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        let session = TerminalSession {
            id: id.clone(),
            pid,
            status: TerminalStatus::Idle,
            history: Vec::new(),
            agent: None,
        };

        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.insert(id.clone(), session.clone());
        }

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

        if let Ok(mut handles) = self.pty_handles.lock() {
            handles.insert(
                id.clone(),
                PtyHandle {
                    master: pair.master,
                    child,
                    input_listener_id,
                    app_handle: app_handle.clone(),
                },
            );
        }

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
                        match watch_pty_handles.lock() {
                            Ok(mut handles) => {
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
                            }
                            Err(_) => return,
                        }
                    };

                    if exited {
                        log_info(&format!(
                            "[WSL-WATCHER] Child exited for {}, cleaning up",
                            &watch_id[..8]
                        ));
                        if let Ok(mut handles) = watch_pty_handles.lock() {
                            if let Some(handle) = handles.remove(&watch_id) {
                                handle.app_handle.unlisten(handle.input_listener_id);
                                drop(handle.master);
                                drop(handle.child);
                            }
                        }
                        if let Ok(mut sessions) = watch_sessions.lock() {
                            sessions.remove(&watch_id);
                        }
                        let close_event = format!("terminal-closed-{}", watch_id);
                        if let Err(e) = watch_handle.emit(&close_event, ()) {
                            log_error(&format!("[WSL-WATCHER] Failed to emit close event: {}", e));
                        }
                        return;
                    }

                    thread::sleep(Duration::from_millis(100));
                }
            })?;

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
        if let Ok(handles) = self.pty_handles.lock() {
            if let Some(handle) = handles.get(session_id) {
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
        }
        Ok(())
    }

    pub fn close_session(&self, session_id: &str) {
        log_info(&format!(
            "[PTY] Closing session {}",
            &session_id[..8.min(session_id.len())]
        ));
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(session_id);
        }

        if let Ok(mut handles) = self.pty_handles.lock() {
            if let Some(mut handle) = handles.remove(session_id) {
                handle.app_handle.unlisten(handle.input_listener_id);
                drop(handle.master);
                graceful_kill(&mut *handle.child);
            }
        }
    }

    pub fn close_all_sessions(&self) {
        log_info("[PTY] Closing all sessions...");
        let ids: Vec<String> = self
            .pty_handles
            .lock()
            .map(|h| h.keys().cloned().collect())
            .unwrap_or_default();
        for id in ids {
            self.close_session(&id);
        }
        log_info("[PTY] All sessions closed");
    }

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

#[cfg(unix)]
fn disable_echo(fd: std::os::unix::io::RawFd) -> anyhow::Result<()> {
    use std::mem::MaybeUninit;
    unsafe {
        let mut termios = MaybeUninit::<libc::termios>::uninit();
        if libc::tcgetattr(fd, termios.as_mut_ptr()) != 0 {
            return Err(anyhow::anyhow!("tcgetattr failed"));
        }
        let mut termios = termios.assume_init();
        termios.c_lflag &= !(libc::ECHO | libc::ECHOE | libc::ECHOK | libc::ECHONL);
        if libc::tcsetattr(fd, libc::TCSANOW, &termios) != 0 {
            return Err(anyhow::anyhow!("tcsetattr failed"));
        }
    }
    Ok(())
}

const GRACEFUL_TIMEOUT_SECS: u64 = 3;

fn graceful_kill(child: &mut dyn Child) {
    let pid = match child.process_id() {
        Some(p) => p,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return;
        }
    };

    #[cfg(unix)]
    {
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
