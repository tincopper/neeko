use crate::project::types::{GitInfo, Project};
use crate::AppError;
use crate::AppStateWrapper;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub fn add_project(
    path: String,
    agent_id: Option<String>,
    ide: Option<String>,
    avatar_color: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<Project, AppError> {
    let project = state
        .project_manager
        .lock()
        .map_err(AppError::from)?
        .add_project(PathBuf::from(path), agent_id, ide, avatar_color)
        .map_err(AppError::from)?;

    // 不自动挂 watcher —— 由 set_active_project 显式激活时挂载
    Ok(project)
}

#[tauri::command]
pub fn remove_project(project_id: String, state: State<AppStateWrapper>) -> Result<(), AppError> {
    state
        .project_manager
        .lock()
        .map_err(AppError::from)?
        .remove_project(&project_id);

    state.terminal_manager.close_session(&project_id);
    state.watcher_manager.unwatch(&project_id);

    // 若被删的是激活项目，清空 active_project_id（前端 useLocalProjects 会选出下一个并触发 set_active_project）
    if let Ok(mut active) = state.active_project_id.lock() {
        if active.as_deref() == Some(project_id.as_str()) {
            *active = None;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn list_projects(state: State<AppStateWrapper>) -> Result<Vec<Project>, AppError> {
    state
        .project_manager
        .lock()
        .map_err(AppError::from)
        .map(|pm| pm.list_projects())
}

#[tauri::command]
pub fn get_project(project_id: String, state: State<AppStateWrapper>) -> Result<Project, AppError> {
    state
        .project_manager
        .lock()
        .map_err(AppError::from)?
        .get_project(&project_id)
        .cloned()
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))
}

#[tauri::command]
pub fn refresh_git_info(
    project_id: String,
    state: State<AppStateWrapper>,
) -> Result<GitInfo, AppError> {
    let mut manager = state.project_manager.lock().map_err(AppError::from)?;
    manager
        .refresh_git_info(&project_id)
        .map_err(AppError::from)?;
    manager
        .get_project(&project_id)
        .and_then(|p| p.git_info.clone())
        .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))
}

#[tauri::command]
pub fn set_active_project(
    project_id: String,
    state: State<AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<(), AppError> {
    // 与当前 active 比对，相同则 no-op（避免重复 unwatch/watch 抖动）
    let current = state
        .active_project_id
        .lock()
        .map_err(AppError::from)?
        .clone();
    if current.as_deref() == Some(project_id.as_str()) {
        return Ok(());
    }

    // 校验新 id 存在于 project_manager
    let new_path = {
        let pm = state.project_manager.lock().map_err(AppError::from)?;
        pm.get_project(&project_id)
            .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?
            .path
            .clone()
    };

    // unwatch 旧激活项目
    if let Some(old_id) = current.as_deref() {
        state.watcher_manager.unwatch(old_id);
    }

    // watch 新激活项目（watch 内部会立即 worker.check() 一次获取初始状态）
    state
        .watcher_manager
        .watch(project_id.clone(), new_path, app_handle);

    // 更新 active_project_id
    *state.active_project_id.lock().map_err(AppError::from)? = Some(project_id);

    Ok(())
}

#[tauri::command]
pub fn get_active_project(state: State<AppStateWrapper>) -> Option<String> {
    state.active_project_id.lock().ok().and_then(|g| g.clone())
}

#[tauri::command]
pub fn set_view_terminal(
    project_id: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .project_manager
        .lock()
        .map_err(AppError::from)?
        .set_view_terminal(&project_id);
    Ok(())
}

#[tauri::command]
pub fn set_view_diff(
    project_id: String,
    file_path: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .project_manager
        .lock()
        .map_err(AppError::from)?
        .set_view_diff(&project_id, PathBuf::from(file_path));
    Ok(())
}

#[tauri::command]
pub fn set_project_collapsed(
    project_id: String,
    collapsed: bool,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .project_manager
        .lock()
        .map_err(AppError::from)?
        .set_collapsed(&project_id, collapsed);
    Ok(())
}

#[tauri::command]
pub fn set_project_color(
    project_id: String,
    color: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .project_manager
        .lock()
        .map_err(AppError::from)?
        .set_avatar_color(&project_id, color);
    Ok(())
}

#[tauri::command]
pub fn rename_project(
    project_id: String,
    new_name: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .project_manager
        .lock()
        .map_err(AppError::from)?
        .rename_project(&project_id, &new_name);
    Ok(())
}

#[tauri::command]
pub fn change_project_path(
    project_id: String,
    new_path: String,
    state: State<AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<(), AppError> {
    {
        let mut pm = state.project_manager.lock().map_err(AppError::from)?;
        pm.change_path(&project_id, &new_path);
        pm.refresh_git_info(&project_id).map_err(AppError::from)?;
    }

    // 只有激活项目才需要迁移 watcher；非激活项目的路径变更延后到下次 set_active_project
    let is_active = state
        .active_project_id
        .lock()
        .map_err(AppError::from)?
        .as_deref()
        == Some(project_id.as_str());
    if is_active {
        state.watcher_manager.unwatch(&project_id);
        state
            .watcher_manager
            .watch(project_id, PathBuf::from(new_path), app_handle);
    }

    Ok(())
}

#[tauri::command]
pub fn reorder_projects(
    ordered_ids: Vec<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .project_manager
        .lock()
        .map_err(AppError::from)?
        .reorder_projects(&ordered_ids);
    Ok(())
}
