mod agent;
mod git;
mod project;
mod state;
mod storage;
mod terminal;

use agent::AgentManager;
use git::get_file_diff;
use project::ProjectManager;
use state::*;
use std::path::PathBuf;
use std::sync::Mutex;
use storage::StorageManager;
use tauri::Manager;
use tauri::State;
use terminal::TerminalManager;

pub struct AppStateWrapper {
    project_manager: Mutex<ProjectManager>,
    terminal_manager: TerminalManager,
    agent_manager: Mutex<AgentManager>,
    storage_manager: StorageManager,
    active_project_id: Mutex<Option<String>>,
}

impl AppStateWrapper {
    pub fn new() -> Self {
        Self {
            project_manager: Mutex::new(ProjectManager::new()),
            terminal_manager: TerminalManager::new(),
            agent_manager: Mutex::new(AgentManager::new()),
            storage_manager: StorageManager::new().expect("Failed to create storage manager"),
            active_project_id: Mutex::new(None),
        }
    }
}

// 目录选择对话框 —— 使用 tauri-plugin-dialog，跨平台支持 Windows/macOS/Linux
#[tauri::command]
async fn open_directory_dialog(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app_handle
        .dialog()
        .file()
        .set_title("Select Project Directory")
        .blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

// 项目管理命令
#[tauri::command]
fn add_project(
    path: String,
    agent_id: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<Project, String> {
    state
        .project_manager
        .lock()
        .unwrap()
        .add_project(PathBuf::from(path), agent_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_project(project_id: String, state: State<AppStateWrapper>) {
    state
        .project_manager
        .lock()
        .unwrap()
        .remove_project(&project_id);
    state.terminal_manager.close_session(&project_id);
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
    state: State<AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<TerminalSession, String> {
    let manager = state.project_manager.lock().unwrap();
    if let Some(project) = manager.get_project(&project_id) {
        let path = project.path.to_string_lossy().to_string();
        state
            .terminal_manager
            .create_session(&path, cols, rows, shell, app_handle)
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

#[tauri::command]
fn list_terminal_sessions(state: State<AppStateWrapper>) -> Vec<TerminalSession> {
    state.terminal_manager.list_sessions()
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
    let output = Command::new("system_profiler")
        .args(["SPFontsDataType", "-json"])
        .output();
    match output {
        Ok(o) => {
            let text = String::from_utf8_lossy(&o.stdout);
            // 简单提取 full_name 字段
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
                .map(|f| {
                    f.split(',').next().unwrap_or(&f).trim().to_string()
                })
                .filter(|f| !f.is_empty())
                .collect();
            fonts
        }
        Err(_) => vec![],
    }
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
fn save_session(state: State<AppStateWrapper>) -> Result<(), String> {
    let projects = state.project_manager.lock().unwrap().list_projects();
    let session = state
        .storage_manager
        .create_session_from_projects(&projects);
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
                    );
                }
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
            // 对话框
            open_directory_dialog,
            // Git 操作
            checkout_branch,
            create_branch,
            get_file_diff_command,
            create_worktree,
            remove_worktree,
            // 终端管理
            create_terminal_session,
            close_terminal_session,
            list_terminal_sessions,
            resize_terminal,
            // Agent 管理
            list_agents,
            get_agent,
            add_agent,
            remove_agent,
            set_project_agent,
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
