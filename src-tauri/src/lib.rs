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

// 目录选择对话框
#[tauri::command]
async fn open_directory_dialog() -> Result<Option<String>, String> {
    use std::process::Command;
    let output = Command::new("zenity")
        .args(["--file-selection", "--directory", "--title=Select Project Directory"])
        .output();

    match output {
        Ok(output) if output.status.success() => {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(Some(path));
            }
            Ok(None)
        }
        Ok(_) => Ok(None),
        Err(_) => Err("Dialog not available. Please install zenity or enter path manually.".into()),
    }
}

// 项目管理命令
#[tauri::command]
fn add_project(path: String, state: State<AppStateWrapper>) -> Result<Project, String> {
    state
        .project_manager
        .lock()
        .unwrap()
        .add_project(PathBuf::from(path))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_project(project_id: String, state: State<AppStateWrapper>) {
    state.project_manager.lock().unwrap().remove_project(&project_id);
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
    state.project_manager.lock().unwrap().set_view_terminal(&project_id);
}

#[tauri::command]
fn set_view_diff(project_id: String, file_path: String, state: State<AppStateWrapper>) {
    state
        .project_manager
        .lock()
        .unwrap()
        .set_view_diff(&project_id, PathBuf::from(file_path));
}

// Git 命令
#[tauri::command]
fn checkout_branch(project_id: String, branch_name: String, state: State<AppStateWrapper>) -> Result<(), String> {
    let manager = state.project_manager.lock().unwrap();
    if let Some(project) = manager.get_project(&project_id) {
        git::checkout_branch(&project.path, &branch_name).map_err(|e| e.to_string())
    } else {
        Err("Project not found".into())
    }
}

#[tauri::command]
fn create_branch(project_id: String, branch_name: String, state: State<AppStateWrapper>) -> Result<(), String> {
    let manager = state.project_manager.lock().unwrap();
    if let Some(project) = manager.get_project(&project_id) {
        git::create_branch(&project.path, &branch_name, None).map_err(|e| e.to_string())
    } else {
        Err("Project not found".into())
    }
}

#[tauri::command]
fn get_file_diff_command(project_id: String, file_path: String, state: State<AppStateWrapper>) -> Result<DiffResult, String> {
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
    state: State<AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<TerminalSession, String> {
    let manager = state.project_manager.lock().unwrap();
    if let Some(project) = manager.get_project(&project_id) {
        let path = project.path.to_string_lossy().to_string();
        state
            .terminal_manager
            .create_session(&path, app_handle)
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

// 持久化命令
#[tauri::command]
fn save_session(state: State<AppStateWrapper>) -> Result<(), String> {
    let projects = state.project_manager.lock().unwrap().list_projects();
    let session = state.storage_manager.create_session_from_projects(&projects);
    state.storage_manager.save_session(&session).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_session(state: State<AppStateWrapper>) -> Result<SessionStore, String> {
    state.storage_manager.load_session().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_config_dir(state: State<AppStateWrapper>) -> String {
    state.storage_manager.get_config_dir().to_string_lossy().to_string()
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Neeko!", name)
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppStateWrapper::new())
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
            // 终端管理
            create_terminal_session,
            close_terminal_session,
            list_terminal_sessions,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
