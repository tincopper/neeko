mod agent;
mod git;
mod logger;
mod project;
mod remote;
mod state;
mod storage;
mod terminal;
mod watcher;

use agent::AgentManager;
use git::get_file_diff;
use project::ProjectManager;
use remote::RemoteTerminalManager;
use state::*;
use std::path::PathBuf;
use std::sync::Mutex;
use storage::StorageManager;
use tauri::Manager;
use tauri::State;
use terminal::TerminalManager;
use watcher::WatcherManager;

pub struct AppStateWrapper {
    project_manager: Mutex<ProjectManager>,
    terminal_manager: TerminalManager,
    remote_terminal_manager: RemoteTerminalManager,
    agent_manager: Mutex<AgentManager>,
    storage_manager: StorageManager,
    active_project_id: Mutex<Option<String>>,
    watcher_manager: WatcherManager,
}

impl AppStateWrapper {
    pub fn new() -> Self {
        Self {
            project_manager: Mutex::new(ProjectManager::new()),
            terminal_manager: TerminalManager::new(),
            remote_terminal_manager: RemoteTerminalManager::new(),
            agent_manager: Mutex::new(AgentManager::new()),
            storage_manager: StorageManager::new().expect("Failed to create storage manager"),
            active_project_id: Mutex::new(None),
            watcher_manager: WatcherManager::new(),
        }
    }
}

// 项目管理命令
#[tauri::command]
fn add_project(
    path: String,
    agent_id: Option<String>,
    ide: Option<String>,
    state: State<AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<Project, String> {
    let project = state
        .project_manager
        .lock()
        .unwrap()
        .add_project(PathBuf::from(path), agent_id, ide)
        .map_err(|e| e.to_string())?;

    // 为新项目启动文件监听
    state
        .watcher_manager
        .watch(project.id.clone(), project.path.clone(), app_handle);

    Ok(project)
}

#[tauri::command]
fn remove_project(project_id: String, state: State<AppStateWrapper>) {
    state
        .project_manager
        .lock()
        .unwrap()
        .remove_project(&project_id);
    state.terminal_manager.close_session(&project_id);
    // 停止文件监听
    state.watcher_manager.unwatch(&project_id);
    // 持久化删除操作
    let projects = state.project_manager.lock().unwrap().list_projects();
    let session = state
        .storage_manager
        .create_session_from_projects(&projects, None, None, None, None);
    let _ = state.storage_manager.save_session(&session);
}

#[tauri::command]
fn list_projects(state: State<AppStateWrapper>) -> Vec<Project> {
    state.project_manager.lock().unwrap().list_projects()
}

#[tauri::command]
fn get_project(project_id: String, state: State<AppStateWrapper>) -> Result<Project, String> {
    state
        .project_manager
        .lock()
        .unwrap()
        .get_project(&project_id)
        .cloned()
        .ok_or_else(|| "Project not found".to_string())
}

#[tauri::command]
fn refresh_git_info(project_id: String, state: State<AppStateWrapper>) -> Result<(), String> {
    state
        .project_manager
        .lock()
        .unwrap()
        .refresh_git_info(&project_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_active_project(project_id: String, state: State<AppStateWrapper>) {
    *state.active_project_id.lock().unwrap() = Some(project_id);
}

#[tauri::command]
fn get_active_project(state: State<AppStateWrapper>) -> Option<String> {
    state.active_project_id.lock().unwrap().clone()
}

// 视图切换命令
#[tauri::command]
fn set_view_terminal(project_id: String, state: State<AppStateWrapper>) {
    state
        .project_manager
        .lock()
        .unwrap()
        .set_view_terminal(&project_id);
}

#[tauri::command]
fn set_view_diff(project_id: String, file_path: String, state: State<AppStateWrapper>) {
    state
        .project_manager
        .lock()
        .unwrap()
        .set_view_diff(&project_id, PathBuf::from(file_path));
}

#[tauri::command]
fn set_project_collapsed(project_id: String, collapsed: bool, state: State<AppStateWrapper>) {
    let mut pm = state.project_manager.lock().unwrap();
    pm.set_collapsed(&project_id, collapsed);
    // 持久化折叠状态
    let projects = pm.list_projects();
    let session = state
        .storage_manager
        .create_session_from_projects(&projects, None, None, None, None);
    let _ = state.storage_manager.save_session(&session);
}

#[tauri::command]
fn create_worktree(
    project_id: String,
    worktree_path: String,
    branch_name: String,
    new_branch: bool,
    state: State<AppStateWrapper>,
) -> Result<(), String> {
    let manager = state.project_manager.lock().unwrap();
    if let Some(project) = manager.get_project(&project_id) {
        git::create_worktree(
            &project.path,
            &PathBuf::from(&worktree_path),
            &branch_name,
            new_branch,
        )
        .map_err(|e| e.to_string())
    } else {
        Err("Project not found".into())
    }
}

#[tauri::command]
fn remove_worktree(
    project_id: String,
    worktree_path: String,
    state: State<AppStateWrapper>,
) -> Result<(), String> {
    let manager = state.project_manager.lock().unwrap();
    if let Some(project) = manager.get_project(&project_id) {
        git::remove_worktree(&project.path, &PathBuf::from(&worktree_path))
            .map_err(|e| e.to_string())
    } else {
        Err("Project not found".into())
    }
}

// Git 命令
#[tauri::command]
fn checkout_branch(
    project_id: String,
    branch_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), String> {
    let manager = state.project_manager.lock().unwrap();
    if let Some(project) = manager.get_project(&project_id) {
        git::checkout_branch(&project.path, &branch_name).map_err(|e| e.to_string())
    } else {
        Err("Project not found".into())
    }
}

#[tauri::command]
fn create_branch(
    project_id: String,
    branch_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), String> {
    let manager = state.project_manager.lock().unwrap();
    if let Some(project) = manager.get_project(&project_id) {
        git::create_branch(&project.path, &branch_name, None).map_err(|e| e.to_string())
    } else {
        Err("Project not found".into())
    }
}

#[tauri::command]
fn rename_branch(
    project_id: String,
    old_name: String,
    new_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), String> {
    let manager = state.project_manager.lock().unwrap();
    if let Some(project) = manager.get_project(&project_id) {
        git::rename_branch(&project.path, &old_name, &new_name).map_err(|e| e.to_string())
    } else {
        Err("Project not found".into())
    }
}

#[tauri::command]
fn rename_worktree(
    project_id: String,
    worktree_path: String,
    new_name: String,
    state: State<AppStateWrapper>,
) -> Result<String, String> {
    let manager = state.project_manager.lock().unwrap();
    if let Some(project) = manager.get_project(&project_id) {
        git::rename_worktree(&project.path, &PathBuf::from(&worktree_path), &new_name)
            .map_err(|e| e.to_string())
    } else {
        Err("Project not found".into())
    }
}

#[tauri::command]
fn get_file_diff_command(
    project_id: String,
    file_path: String,
    state: State<AppStateWrapper>,
) -> Result<DiffResult, String> {
    let manager = state.project_manager.lock().unwrap();
    if let Some(project) = manager.get_project(&project_id) {
        get_file_diff(&project.path, &file_path).map_err(|e| e.to_string())
    } else {
        Err("Project not found".into())
    }
}

// 终端命令 - 使用 Tauri Events 实现双向通信
#[tauri::command]
fn create_terminal_session(
    project_id: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    working_dir: Option<String>,
    state: State<AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<TerminalSession, String> {
    let manager = state.project_manager.lock().unwrap();
    if let Some(project) = manager.get_project(&project_id) {
        let path = project.path.to_string_lossy().to_string();
        state
            .terminal_manager
            .create_session(&path, cols, rows, shell, working_dir, app_handle)
            .map_err(|e| e.to_string())
    } else {
        Err("Project not found".into())
    }
}

#[tauri::command]
fn close_terminal_session(session_id: String, state: State<AppStateWrapper>) {
    state.terminal_manager.close_session(&session_id);
}

#[tauri::command]
fn resize_terminal(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<AppStateWrapper>,
) -> Result<(), String> {
    state
        .terminal_manager
        .resize_session(&session_id, cols, rows)
        .map_err(|e| e.to_string())
}

// WSL 命令
//
// wsl.exe 在无控制台（non-console）模式下默认输出 UTF-16LE。
// 设置环境变量 WSL_UTF8=1 可强制其输出 UTF-8，是微软官方推荐方案。
//
// Windows 上 std::process::Command 默认会为子进程创建控制台窗口。
// 通过 CREATE_NO_WINDOW 标志抑制，避免每次目录查询时弹出黑框。
fn wsl_command(program: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}
#[tauri::command]
fn get_wsl_distros() -> Result<Vec<String>, String> {
    if !cfg!(target_os = "windows") {
        return Err("WSL is only supported on Windows".to_string());
    }
    let output = wsl_command("wsl.exe")
        .args(["-l", "-q"])
        .env("WSL_UTF8", "1")
        .output()
        .map_err(|e| format!("Failed to execute wsl.exe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("WSL command failed: {}", stderr));
    }

    let distros: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| line.trim().trim_end_matches('*').trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();

    Ok(distros)
}

#[tauri::command]
fn get_wsl_directories(distro: String, path: Option<String>) -> Result<Vec<String>, String> {
    if !cfg!(target_os = "windows") {
        return Err("WSL is only supported on Windows".to_string());
    }
    let dir_path = path.unwrap_or_else(|| "/".to_string());

    // 用 bash -c 执行，避免 Windows 工作目录被 WSL 自动映射导致路径解析错误。
    // ls -1p 会在目录名后追加 /，通过 grep 只保留目录。
    let cmd = format!(
        "ls -1p \"{}\" 2>/dev/null | grep '/$' | sed 's|/$||'",
        dir_path.replace('"', "\\\"")
    );

    let output = wsl_command("wsl.exe")
        .args(["-d", &distro, "bash", "-c", &cmd])
        .env("WSL_UTF8", "1")
        .output()
        .map_err(|e| format!("Failed to execute wsl.exe: {}", e))?;

    let entries: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();

    Ok(entries)
}

#[tauri::command]
fn get_wsl_home_dir(distro: String) -> Result<String, String> {
    if !cfg!(target_os = "windows") {
        return Err("WSL is only supported on Windows".to_string());
    }
    let output = wsl_command("wsl.exe")
        .args(["-d", &distro, "bash", "-c", "echo $HOME"])
        .env("WSL_UTF8", "1")
        .output()
        .map_err(|e| format!("Failed to execute wsl.exe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("WSL command failed: {}", stderr));
    }

    let home_dir = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_string();

    Ok(home_dir)
}

#[tauri::command]
fn create_wsl_terminal_session(
    distro: String,
    project_path: String,
    cols: u16,
    rows: u16,
    state: State<AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<TerminalSession, String> {
    if !cfg!(target_os = "windows") {
        return Err("WSL is only supported on Windows".to_string());
    }
    state
        .terminal_manager
        .create_wsl_session(&distro, &project_path, cols, rows, app_handle)
        .map_err(|e| e.to_string())
}



// SSH 远程终端命令
#[tauri::command]
async fn create_remote_terminal_session(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    project_path: String,
    cols: u16,
    rows: u16,
    state: State<'_, AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<TerminalSession, String> {
    state
        .remote_terminal_manager
        .create_session(&host, port, &username, &auth, &project_path, cols, rows, app_handle)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn close_remote_terminal_session(session_id: String, state: State<AppStateWrapper>) {
    state.remote_terminal_manager.close_session(&session_id);
}

#[tauri::command]
fn resize_remote_terminal(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<AppStateWrapper>,
) -> Result<(), String> {
    state
        .remote_terminal_manager
        .resize_session(&session_id, cols, rows)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn test_remote_connection(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    state: State<'_, AppStateWrapper>,
) -> Result<(), String> {
    state
        .remote_terminal_manager
        .test_connection(&host, port, &username, &auth)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_remote_directories(
    host: String,
    port: u16,
    username: String,
    auth: AuthMethod,
    path: String,
    state: State<'_, AppStateWrapper>,
) -> Result<Vec<String>, String> {
    state
        .remote_terminal_manager
        .list_directories(&host, port, &username, &auth, &path)
        .await
        .map_err(|e| e.to_string())
}

// Agent 命令
#[tauri::command]
fn list_agents(state: State<AppStateWrapper>) -> Vec<AgentConfig> {
    state.agent_manager.lock().unwrap().get_agents()
}

#[tauri::command]
fn get_agent(agent_id: String, state: State<AppStateWrapper>) -> Result<AgentConfig, String> {
    state
        .agent_manager
        .lock()
        .unwrap()
        .get_agent(&agent_id)
        .cloned()
        .ok_or_else(|| "Agent not found".into())
}

#[tauri::command]
fn add_agent(agent: AgentConfig, state: State<AppStateWrapper>) {
    state.agent_manager.lock().unwrap().add_agent(agent);
}

#[tauri::command]
fn remove_agent(agent_id: String, state: State<AppStateWrapper>) {
    state.agent_manager.lock().unwrap().remove_agent(&agent_id);
}

#[tauri::command]
fn set_project_agent(project_id: String, agent_id: Option<String>, state: State<AppStateWrapper>) {
    state
        .project_manager
        .lock()
        .unwrap()
        .set_selected_agent(&project_id, agent_id);
}

// 获取系统已安装的等宽字体列表
#[tauri::command]
fn get_system_fonts() -> Vec<String> {
    let mut fonts = get_monospace_fonts();
    fonts.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    fonts.dedup();
    fonts
}

#[cfg(target_os = "windows")]
fn get_monospace_fonts() -> Vec<String> {
    use std::process::Command;
    // PowerShell 枚举等宽字体（IsSymbolFont=false，Monospace 通过 Pitch 判断）
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            r#"[System.Reflection.Assembly]::LoadWithPartialName('System.Drawing') | Out-Null;
(New-Object System.Drawing.Text.InstalledFontCollection).Families |
Where-Object { $_.IsStyleAvailable('Regular') } |
Select-Object -ExpandProperty Name"#,
        ])
        .output();
    match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout)
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect(),
        Err(_) => vec![],
    }
}

#[cfg(target_os = "macos")]
fn get_monospace_fonts() -> Vec<String> {
    use std::process::Command;
    use std::time::Duration;

    // system_profiler 可能很慢（10-20s），加超时避免阻塞
    let child = Command::new("system_profiler")
        .args(["SPFontsDataType", "-json"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn();
    match child {
        Ok(mut child) => {
            let timeout = Duration::from_secs(10);
            let start = std::time::Instant::now();
            loop {
                match child.try_wait() {
                    Ok(Some(_)) => break,
                    Ok(None) => {
                        if start.elapsed() > timeout {
                            let _ = child.kill();
                            let _ = child.wait();
                            return vec![];
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    Err(_) => return vec![],
                }
            }
            let output = child.wait_with_output();
            match output {
                Ok(o) => {
                    let text = String::from_utf8_lossy(&o.stdout);
                    let mut fonts = Vec::new();
                    for line in text.lines() {
                        let line = line.trim();
                        if line.starts_with("\"full_name\"") {
                            if let Some(v) = line.split(':').nth(1) {
                                let name = v.trim().trim_matches('"').trim_matches(',').to_string();
                                if !name.is_empty() {
                                    fonts.push(name);
                                }
                            }
                        }
                    }
                    fonts
                }
                Err(_) => vec![],
            }
        }
        Err(_) => vec![],
    }
}

#[cfg(target_os = "linux")]
fn get_monospace_fonts() -> Vec<String> {
    use std::process::Command;
    // fc-list 枚举所有字体，过滤出 Mono/Code/Console/Terminal 等关键词
    let output = Command::new("fc-list")
        .args(["--format=%{family[0]}\n"])
        .output();
    match output {
        Ok(o) => {
            let text = String::from_utf8_lossy(&o.stdout);
            let mut fonts: Vec<String> = text
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect();
            // 去除 fc-list 可能输出的 locale 变体（如 "Noto Sans,Noto Sans Regular"）
            fonts = fonts
                .into_iter()
                .map(|f| f.split(',').next().unwrap_or(&f).trim().to_string())
                .filter(|f| !f.is_empty())
                .collect();
            fonts
        }
        Err(_) => vec![],
    }
}

// IDE 命令
#[tauri::command]
fn set_project_ide(project_id: String, ide: Option<String>, state: State<AppStateWrapper>) {
    state
        .project_manager
        .lock()
        .unwrap()
        .set_selected_ide(&project_id, ide);
}

/// 用指定 IDE 打开项目目录。
#[tauri::command]
fn open_ide(ide_command: String, project_path: String) -> Result<(), String> {
    use std::process::Command;

    let trimmed = ide_command.trim();
    if trimmed.is_empty() {
        return Err("No IDE configured for this project".into());
    }

    // 解析可执行文件路径和额外参数：
    //
    // 优先级：
    // 1. 若整个字符串（去掉首尾空格）本身就是一个存在的文件路径，直接使用
    //    （处理路径含空格但用户没有加引号的情况，如 D:\app\GoLand 2023.3.2\bin\goland64.exe）
    // 2. 否则走 shell-style 分词（支持引号、带额外参数的命令）
    let (exe, extra_args): (String, Vec<String>) = {
        let unquoted = trimmed.trim_matches('"').trim_matches('\'');
        if std::path::Path::new(unquoted).exists() {
            // 整个字符串是有效路径，无额外参数
            (unquoted.to_string(), vec![])
        } else if std::path::Path::new(trimmed).exists() {
            (trimmed.to_string(), vec![])
        } else {
            // 尝试 shell-style 分词
            let parts = split_command(trimmed);
            if parts.is_empty() {
                return Err("Empty IDE command".into());
            }
            let mut it = parts.into_iter();
            let exe = it.next().unwrap();
            (exe, it.collect())
        }
    };

    let mut cmd = Command::new(&exe);
    cmd.args(&extra_args);
    // project_path 通过 arg() 传递，Rust 在系统层正确处理空格，无需手动转义
    cmd.arg(&project_path);

    // Windows：后台 detached 启动，不等待，不弹出 cmd 窗口
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x00000008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }

    cmd.spawn()
        .map_err(|e| format!("Failed to launch '{}': {}", exe, e))?;
    Ok(())
}

/// Shell-style 简单分词：支持单引号和双引号包裹含空格的路径
/// 例如：`"D:/My Apps/zed.exe" --arg` → `["D:/My Apps/zed.exe", "--arg"]`
fn split_command(s: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut chars = s.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '"' => {
                // 读取直到下一个 "
                for inner in chars.by_ref() {
                    if inner == '"' {
                        break;
                    }
                    current.push(inner);
                }
            }
            '\'' => {
                // 读取直到下一个 '
                for inner in chars.by_ref() {
                    if inner == '\'' {
                        break;
                    }
                    current.push(inner);
                }
            }
            ' ' | '\t' => {
                if !current.is_empty() {
                    parts.push(current.clone());
                    current.clear();
                }
            }
            _ => current.push(c),
        }
    }
    if !current.is_empty() {
        parts.push(current);
    }
    parts
}

// 配置命令
#[tauri::command]
fn save_config(config: serde_json::Value, state: State<AppStateWrapper>) -> Result<(), String> {
    state
        .storage_manager
        .save_config(&config)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn load_config(state: State<AppStateWrapper>) -> Result<serde_json::Value, String> {
    state
        .storage_manager
        .load_config()
        .map_err(|e| e.to_string())
}

// 持久化命令
#[tauri::command]
fn save_session(
    wsl_entries: Vec<WSLEntrySession>,
    remote_entries: Vec<RemoteEntrySession>,
    sidebar_width: Option<u32>,
    side_terminal_width: Option<u32>,
    state: State<AppStateWrapper>,
) -> Result<(), String> {
    let projects = state.project_manager.lock().unwrap().list_projects();
    let session = state.storage_manager.create_session_from_projects(
        &projects,
        Some(&wsl_entries),
        Some(&remote_entries),
        sidebar_width,
        side_terminal_width,
    );
    state
        .storage_manager
        .save_session(&session)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn load_session(state: State<AppStateWrapper>) -> Result<SessionStore, String> {
    state
        .storage_manager
        .load_session()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_config_dir(state: State<AppStateWrapper>) -> String {
    state
        .storage_manager
        .get_config_dir()
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Neeko!", name)
}

pub fn run() {
    logger::init_logger();
    log::info!("Neeko starting");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppStateWrapper::new())
        .setup(|app| {
            // 启动时恢复上次的项目列表和 agent 设置
            let state = app.handle().state::<AppStateWrapper>();
            if let Ok(session) = state.storage_manager.load_session() {
                let mut pm = state.project_manager.lock().unwrap();
                for p in &session.projects {
                    let _ = pm.add_project_from_session(
                        p.id.clone(),
                        p.path.clone(),
                        p.selected_agent.clone(),
                        p.selected_ide.clone(),
                        p.collapsed,
                    );
                }
            }
            // 为所有已恢复的项目启动文件监听
            let projects: Vec<(String, PathBuf)> = state
                .project_manager
                .lock()
                .unwrap()
                .list_projects()
                .into_iter()
                .map(|p| (p.id, p.path))
                .collect();
            for (id, path) in projects {
                state.watcher_manager.watch(id, path, app.handle().clone());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // 窗口销毁时清理所有 PTY session，确保子进程不残留
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<AppStateWrapper>();
                state.terminal_manager.close_all_sessions();
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            // 项目管理
            add_project,
            remove_project,
            list_projects,
            get_project,
            refresh_git_info,
            set_active_project,
            get_active_project,
            // 视图切换
            set_view_terminal,
            set_view_diff,
            set_project_collapsed,
            // 对话框
            // Git 操作
            checkout_branch,
            create_branch,
            rename_branch,
            rename_worktree,
            get_file_diff_command,
            create_worktree,
            remove_worktree,
            // 终端管理
            create_terminal_session,
            close_terminal_session,
            resize_terminal,
            // WSL 终端
            get_wsl_distros,
            get_wsl_directories,
            get_wsl_home_dir,
            create_wsl_terminal_session,
            // SSH 远程终端
            create_remote_terminal_session,
            close_remote_terminal_session,
            resize_remote_terminal,
            test_remote_connection,
            list_remote_directories,
            // Agent 管理
            list_agents,
            get_agent,
            add_agent,
            remove_agent,
            set_project_agent,
            // IDE
            set_project_ide,
            open_ide,
            // 持久化
            save_session,
            load_session,
            get_config_dir,
            // 配置
            save_config,
            load_config,
            get_system_fonts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
