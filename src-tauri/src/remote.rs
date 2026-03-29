use crate::state::{AuthMethod, TerminalSession, TerminalStatus};
use anyhow::Result;
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
        let config = Arc::new(client::Config::default());
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
                &[],
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
        self.ssh_handles.lock().unwrap().insert(
            id.clone(),
            SSHHandle {
                input_tx,
                resize_tx,
                input_listener_id,
                app_handle: app_handle.clone(),
            },
        );

        // 用 make_writer() 分离读写端，避免 select! 中的可变借用冲突
        let mut writer = channel.make_writer();

        // IO 任务：在独立 tokio 线程里同时处理读写和 resize，消除锁竞争
        let io_id = id.clone();
        let read_handle = app_handle.clone();
        thread::Builder::new()
            .name(format!("ssh-io-{}", &id[..8]))
            .spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();
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
        let handles = self.ssh_handles.lock().unwrap();
        if let Some(handle) = handles.get(session_id) {
            let _ = handle.resize_tx.send((cols as u32, rows as u32));
            log_info(&format!(
                "[SSH] Resize {}x{} sent to session {}",
                cols, rows, &session_id[..8]
            ));
        }
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
            // input_tx drop 后，IO 任务的 recv() 会返回 None，任务自然退出
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
        let config = Arc::new(client::Config::default());
        let mut session = client::connect(config, (host, port), Client).await?;

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
            AuthMethod::KeyFileWithPassphrase { key_path, passphrase } => {
                let key_pair = russh::keys::load_secret_key(key_path, Some(passphrase))?;
                let key_with_hash =
                    russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
                session.authenticate_publickey(username, key_with_hash).await?
            }
        };

        if !auth_result.success() {
            return Err(anyhow::anyhow!("Authentication failed: invalid credentials"));
        }

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
        let _ = session.disconnect(russh::Disconnect::ByApplication, "", "").await;
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
        let config = Arc::new(client::Config::default());
        let mut session = client::connect(config, (host, port), Client).await?;

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
            AuthMethod::KeyFileWithPassphrase { key_path, passphrase } => {
                let key_pair = russh::keys::load_secret_key(key_path, Some(passphrase))?;
                let key_with_hash =
                    russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
                session.authenticate_publickey(username, key_with_hash).await?
            }
        };

        if !auth_result.success() {
            return Err(anyhow::anyhow!("SSH authentication failed"));
        }

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
        let _ = session.disconnect(russh::Disconnect::ByApplication, "", "").await;

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

// ─── WSL Git 命令 (Windows only) ────────────────────────────────────────────

use crate::state::{DiffResult, FileChange, FileStatus, GitInfo, Worktree};
use crate::git::parse_unified_diff;
use std::path::PathBuf;
use std::process::Command;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn no_window_cmd(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn safe_path(path: &str) -> String {
    path.replace('\'', "'\\''")
}

/// 执行 wsl.exe -d distro bash -c "<cmd>" 并返回 stdout
#[cfg(target_os = "windows")]
fn run_wsl_bash(distro: &str, cmd: &str) -> Result<String> {
    let output = no_window_cmd("wsl.exe")
        .arg("-d")
        .arg(distro)
        .arg("bash")
        .arg("-c")
        .arg(cmd)
        .output()
        .map_err(|e| anyhow::anyhow!("Failed to execute wsl.exe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("Command failed with status {}", output.status)
        };
        return Err(anyhow::anyhow!("{}", msg));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// 通过 WSL 获取完整 GitInfo（1 次 wsl.exe 调用）
#[cfg(target_os = "windows")]
pub fn get_wsl_git_info(distro: &str, project_path: &str) -> Result<GitInfo> {
    let sp = safe_path(project_path);
    let output = run_wsl_bash(distro, &format!(
        "cd '{sp}' \
          && printf '__BRANCH__\\n' \
          && git branch --show-current 2>/dev/null \
          && printf '\\n__BRANCHES__\\n' \
          && git branch 2>/dev/null \
          && printf '\\n__WORKTREES__\\n' \
          && git worktree list --porcelain 2>/dev/null \
          && printf '\\n__STATUS__\\n' \
          && git status --porcelain 2>/dev/null"
    ))?;

    Ok(parse_git_info_output(&output))
}

/// 通过 WSL 获取文件 diff
#[cfg(target_os = "windows")]
pub fn get_wsl_file_diff(distro: &str, project_path: &str, file_path: &str) -> Result<DiffResult> {
    let sp = safe_path(project_path);
    let fp = safe_path(file_path);
    let output = run_wsl_bash(distro, &format!(
        "cd '{sp}' && git diff --unified=3 -- '{fp}' 2>/dev/null"
    ))?;
    Ok(parse_unified_diff(&output))
}

/// 通过 WSL 执行通用 git 写操作（checkout/create_branch/rename 等）
#[cfg(target_os = "windows")]
pub fn run_wsl_git(distro: &str, project_path: &str, git_args: &[&str]) -> Result<String> {
    let sp = safe_path(project_path);
    // 每个参数单独用单引号包裹，防止包含空格的分支名被 shell 拆分
    let quoted_args: Vec<String> = git_args.iter()
        .map(|a| format!("'{}'", safe_path(a)))
        .collect();
    let git_cmd = format!("cd '{}' && git {}", sp, quoted_args.join(" "));
    run_wsl_bash(distro, &git_cmd)
}

/// 通过 WSL 打开 IDE
#[cfg(target_os = "windows")]
pub fn open_wsl_ide(distro: &str, project_path: &str, ide: &str) -> Result<()> {
    // 在 WSL 中以后台模式运行 code 或 zed
    let _ = no_window_cmd("wsl.exe")
        .arg("-d")
        .arg(distro)
        .arg("--cd")
        .arg(project_path)
        .arg("--")
        .arg(ide)
        .arg(".")
        .spawn()
        .map_err(|e| anyhow::anyhow!("Failed to launch IDE in WSL: {}", e))?;
    Ok(())
}

// ─── SSH Git 命令 ────────────────────────────────────────────────────────────

/// SSH 一次性认证连接 + 执行命令 + 返回 stdout
async fn ssh_exec_command(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    cmd: &str,
) -> Result<String> {
    let config = Arc::new(client::Config::default());
    let mut session = client::connect(config, (host, port), Client).await?;

    let auth_result = match auth {
        AuthMethod::Password(password) => {
            session.authenticate_password(username, password).await?
        }
        AuthMethod::KeyFile(key_path) => {
            let key_pair = russh::keys::load_secret_key(key_path, None)?;
            let key_with_hash = russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
            session.authenticate_publickey(username, key_with_hash).await?
        }
        AuthMethod::KeyFileWithPassphrase { key_path, passphrase } => {
            let key_pair = russh::keys::load_secret_key(key_path, Some(passphrase))?;
            let key_with_hash = russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
            session.authenticate_publickey(username, key_with_hash).await?
        }
    };

    if !auth_result.success() {
        return Err(anyhow::anyhow!("SSH authentication failed"));
    }

    let mut channel = session.channel_open_session().await?;
    channel.exec(true, cmd.as_bytes()).await?;

    let mut stdout_buf = Vec::new();
    let mut stderr_buf = Vec::new();
    let mut exit_code: Option<u32> = None;
    loop {
        match channel.wait().await {
            Some(russh::ChannelMsg::Data { data }) => {
                stdout_buf.extend_from_slice(&data);
            }
            Some(russh::ChannelMsg::ExtendedData { data, .. }) => {
                // channel 1 = stderr
                stderr_buf.extend_from_slice(&data);
            }
            Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                exit_code = Some(exit_status);
                // continue draining in case Data arrives after ExitStatus
            }
            Some(russh::ChannelMsg::Eof) | None => break,
            _ => {}
        }
    }

    let _ = channel.close().await;
    let _ = session.disconnect(russh::Disconnect::ByApplication, "", "").await;

    let stdout = String::from_utf8_lossy(&stdout_buf).to_string();

    // 退出码非零视为失败
    if let Some(code) = exit_code {
        if code != 0 {
            let stderr = String::from_utf8_lossy(&stderr_buf).trim().to_string();
            let msg = if !stderr.is_empty() {
                stderr
            } else {
                format!("SSH command failed with exit code {}", code)
            };
            return Err(anyhow::anyhow!("{}", msg));
        }
    }

    Ok(stdout)
}

/// 通过 SSH 获取完整 GitInfo（1 次 SSH 连接）
pub async fn get_remote_git_info(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    project_path: &str,
) -> Result<GitInfo> {
    let sp = safe_path(project_path);
    let cmd = format!(
        "cd '{sp}' \
          && printf '__BRANCH__\\n' \
          && git branch --show-current 2>/dev/null \
          && printf '\\n__BRANCHES__\\n' \
          && git branch 2>/dev/null \
          && printf '\\n__WORKTREES__\\n' \
          && git worktree list --porcelain 2>/dev/null \
          && printf '\\n__STATUS__\\n' \
          && git status --porcelain 2>/dev/null"
    );
    let output = ssh_exec_command(host, port, username, auth, &cmd).await?;
    Ok(parse_git_info_output(&output))
}

/// 通过 SSH 获取文件 diff
pub async fn get_remote_file_diff(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    project_path: &str,
    file_path: &str,
) -> Result<DiffResult> {
    let sp = safe_path(project_path);
    let fp = safe_path(file_path);
    let cmd = format!(
        "cd '{sp}' && git diff --unified=3 -- '{fp}' 2>/dev/null"
    );
    let output = ssh_exec_command(host, port, username, auth, &cmd).await?;
    Ok(parse_unified_diff(&output))
}

/// 通过 SSH 执行通用 git 写操作
pub async fn run_remote_git(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    project_path: &str,
    git_cmd: &str,
) -> Result<String> {
    let sp = safe_path(project_path);
    let cmd = format!("cd '{sp}' && {git_cmd}");
    ssh_exec_command(host, port, username, auth, &cmd).await
}

/// 通过本地命令打开 SSH IDE（VSCode Remote 或 Zed）
#[cfg(target_os = "windows")]
pub fn open_remote_ide(
    host: &str,
    port: u16,
    username: &str,
    project_path: &str,
    ide: &str,
) -> Result<()> {
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x00000008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;

    match ide {
        "vscode" => {
            let folder_uri = format!(
                "vscode-remote://ssh-remote+{}@{}:{}{}",
                username, host, port, project_path
            );
            Command::new("code")
                .arg("--folder-uri")
                .arg(&folder_uri)
                .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
                .spawn()
                .map_err(|e| anyhow::anyhow!("Failed to launch VSCode: {}", e))?;
        }
        "zed" => {
            let ssh_url = format!("ssh://{}@{}:{}{}", username, host, port, project_path);
            Command::new("zed")
                .arg(&ssh_url)
                .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
                .spawn()
                .map_err(|e| anyhow::anyhow!("Failed to launch Zed: {}", e))?;
        }
        _ => return Err(anyhow::anyhow!("Unsupported IDE: {}", ide)),
    }
    Ok(())
}

// ─── 解析合并 git 命令输出为 GitInfo ────────────────────────────────────────

fn parse_git_info_output(output: &str) -> GitInfo {
    let mut current_branch = String::new();
    let mut branches = Vec::new();
    let mut worktrees = Vec::new();
    let mut changed_files = Vec::new();

    let mut section = "";
    let mut wt_path: Option<PathBuf> = None;
    let mut wt_head = String::new();
    let mut wt_branch = String::new();

    for line in output.lines() {
        match line.trim() {
            "__BRANCH__" => { section = "branch"; continue; }
            "__BRANCHES__" => { section = "branches"; continue; }
            "__WORKTREES__" => { section = "worktrees"; continue; }
            "__STATUS__" => { section = "status"; continue; }
            _ => {}
        }

        match section {
            "branch" => {
                if !line.trim().is_empty() {
                    current_branch = line.trim().to_string();
                }
            }
            "branches" => {
                let trimmed = line.trim();
                if trimmed.starts_with('*') {
                    let name = trimmed.trim_start_matches('*').trim();
                    branches.push(name.to_string());
                } else if !trimmed.is_empty() {
                    branches.push(trimmed.to_string());
                }
            }
            "worktrees" => {
                let trimmed = line.trim();
                if trimmed.starts_with("worktree ") {
                    // 如果之前有未完成的 worktree 条目，push
                    if let Some(path) = wt_path.take() {
                        worktrees.push(Worktree {
                            path,
                            branch: wt_branch.clone(),
                            head: wt_head.clone(),
                        });
                    }
                    wt_path = Some(PathBuf::from(&trimmed[9..]));
                    wt_head.clear();
                    wt_branch.clear();
                } else if trimmed.starts_with("HEAD ") {
                    wt_head = trimmed[5..].to_string();
                } else if trimmed.starts_with("branch refs/heads/") {
                    wt_branch = trimmed[18..].to_string();
                } else if trimmed == "detached" {
                    wt_branch = "(detached HEAD)".to_string();
                } else if trimmed == "bare" {
                    wt_branch = "(bare)".to_string();
                } else if trimmed.is_empty() {
                    if let Some(path) = wt_path.take() {
                        worktrees.push(Worktree {
                            path,
                            branch: wt_branch.clone(),
                            head: wt_head.clone(),
                        });
                    }
                    wt_head.clear();
                    wt_branch.clear();
                }
            }
            "status" => {
                if let Some(fc) = parse_status_line(line) {
                    changed_files.push(fc);
                }
            }
            _ => {}
        }
    }

    // 处理最后一个 worktree 条目（可能没有尾部空行）
    if let Some(path) = wt_path.take() {
        worktrees.push(Worktree {
            path,
            branch: wt_branch,
            head: wt_head,
        });
    }

    let is_clean = changed_files.is_empty();

    GitInfo {
        current_branch,
        branches,
        worktrees,
        changed_files,
        is_clean,
    }
}

fn parse_status_line(line: &str) -> Option<FileChange> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    // git status --porcelain 格式: XY path
    let status_chars = &trimmed[..2.min(trimmed.len())];
    let file_path = trimmed[2.min(trimmed.len())..].trim();

    if file_path.is_empty() {
        return None;
    }

    let file_status = if status_chars.contains('?') {
        FileStatus::Untracked
    } else if status_chars.contains('A') {
        FileStatus::Added
    } else if status_chars.contains('D') {
        FileStatus::Deleted
    } else if status_chars.contains('R') {
        FileStatus::Renamed
    } else {
        FileStatus::Modified
    };

    Some(FileChange {
        path: PathBuf::from(file_path),
        status: file_status,
        additions: 0,
        deletions: 0,
    })
}
