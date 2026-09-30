//! Tauri commands for project lifecycle management.

use crate::common::runtime::run_blocking;
use crate::project::types::{GitInfo, Project};
use crate::AppError;
use crate::AppStateWrapper;
use std::path::PathBuf;
use tauri::State;

/// Adds a new local project to the project list.
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

/// Removes a project and its associated terminal/watcher resources.
#[tauri::command]
pub fn remove_project(project_id: String, state: State<AppStateWrapper>) -> Result<(), AppError> {
    state
        .project_manager
        .lock()
        .map_err(AppError::from)?
        .remove_project(&project_id);

    state.terminal_router.local().close_session(&project_id);
    state.watcher_manager.unwatch_project(&project_id);

    // 若被删的是激活项目，清空 active_project_id（前端 useLocalProjects 会选出下一个并触发 set_active_project）
    if let Ok(mut active) = state.active_project_id.lock() {
        if active.as_deref() == Some(project_id.as_str()) {
            *active = None;
        }
    }

    Ok(())
}

/// Returns all managed projects.
#[tauri::command]
pub fn list_projects(state: State<AppStateWrapper>) -> Result<Vec<Project>, AppError> {
    state
        .project_manager
        .lock()
        .map_err(AppError::from)
        .map(|pm| pm.list_projects())
}

/// Returns a single project by ID.
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

/// Refreshes Git info for a project and returns the updated data.
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

/// Sets the active project, managing watchers and LSP profiles.
#[tauri::command]
pub async fn set_active_project(
    project_id: String,
    state: State<'_, AppStateWrapper>,
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

    // 校验新 id 存在于 project_manager；同时取出旧项目 path（LSP 回收用）
    let (new_path, old_path) = {
        let pm = state.project_manager.lock().map_err(AppError::from)?;
        let new_path = pm
            .get_project(&project_id)
            .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?
            .path
            .clone();
        let old_path = current
            .as_ref()
            .and_then(|id| pm.get_project(id).map(|p| p.path.clone()));
        (new_path, old_path)
    };

    // 释放旧激活项目的挂载：drop notify watcher（递归反注册）可能短暂阻塞 → run_blocking
    // 隔离（红线 3），与挂载侧 mount_only 对称。（remove_project / change_project_path 是
    // 同步命令，不跑在 Tokio worker 上，其直调是合法的。）
    if let Some(old_id) = current.as_deref() {
        let manager = state.watcher_manager.clone();
        let old_id = old_id.to_string();
        let _ = run_blocking(move || manager.unwatch_project(&old_id)).await;
    }

    // 这里**不**挂新项目的 watcher：挂载的唯一发起点是前端 `useActiveRepoUnitSync`
    // （反应 `(activeProjectId, 激活 worktree)` → `set_active_repo_unit`），旧项目已在上一步
    // `unwatch_project` 释放。以前在命令层按项目预挂主仓单元，等于给「谁在看」加了第二个
    // 发起点：切到带激活 worktree 的项目时，先挂主仓再被前端改挂 worktree，中间那份主仓
    // 快照既没人看也白跑一次 git status（2026-09-28 隔离实例日志实测到 already watched 告警）。

    // 更新 active_project_id
    *state.active_project_id.lock().map_err(AppError::from)? = Some(project_id.clone());

    // LSP: schedule 30min stop for previous project; detect + soft-warm profile for new
    let new_path_str = new_path.to_string_lossy().to_string();
    if let Some(old) = old_path {
        let old_str = old.to_string_lossy().to_string();
        if old_str != new_path_str {
            state.lsp_manager.schedule_deactivate(old_str);
        }
    }
    let (primary_override, exec_target) = {
        let pm = state.project_manager.lock().map_err(AppError::from)?;
        let project = pm
            .get_project(&project_id)
            .ok_or_else(|| AppError::NotFound(format!("Project not found: {}", project_id)))?;
        (
            project.primary_language.clone(),
            project.environment.to_exec_target(),
        )
    };
    state
        .lsp_manager
        .set_project_exec_target(&new_path_str, exec_target);
    let _profile = state
        .lsp_manager
        .activate_project(&new_path_str, primary_override.as_deref());

    Ok(())
}

/// Sets project-level primary LSP language override (None = auto from root markers).
#[tauri::command]
pub fn set_project_primary_language(
    project_id: String,
    language: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    let path = {
        let mut pm = state.project_manager.lock().map_err(AppError::from)?;
        pm.set_primary_language(&project_id, language);
        pm.get_project(&project_id)
            .map(|p| p.path.to_string_lossy().to_string())
    };
    // Re-detect profile so soft-warm / StatusBar pick up the new primary immediately
    // when this is the active project.
    if let Some(path) = path {
        let active = state.active_project_id.lock().ok().and_then(|g| g.clone());
        if active.as_deref() == Some(project_id.as_str()) {
            let override_lang = state.project_manager.lock().ok().and_then(|pm| {
                pm.get_project(&project_id)
                    .and_then(|p| p.primary_language.clone())
            });
            let _ = state
                .lsp_manager
                .activate_project(&path, override_lang.as_deref());
        }
    }
    Ok(())
}

/// Returns the currently active project ID, if any.
#[tauri::command]
#[must_use]
pub fn get_active_project(state: State<AppStateWrapper>) -> Option<String> {
    state.active_project_id.lock().ok().and_then(|g| g.clone())
}

/// Switches the project view to terminal mode.
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

/// Switches the project view to diff mode for a specific file.
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

/// Sets the collapsed state of a project in the sidebar.
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

/// Sets the avatar color for a project.
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

/// Renames a project.
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

/// Changes the filesystem path of a project and releases its mounted units.
#[tauri::command]
pub fn change_project_path(
    project_id: String,
    new_path: String,
    state: State<AppStateWrapper>,
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
        // 根路径变了 ⇒ 旧 root 下所有单元的身份都失效（包括激活的那个 worktree）。
        // 只释放，不预挂：前端在成功后清掉激活态，挂载由唯一发起点重新驱动。
        state.watcher_manager.unwatch_project(&project_id);
    }

    Ok(())
}

/// Reorders projects in the sidebar to match the given ID sequence.
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
