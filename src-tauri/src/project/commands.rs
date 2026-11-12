//! Tauri commands for project lifecycle management.

use crate::common::runtime::run_blocking;
use crate::lsp::LspManager;
use crate::project::types::{GitInfo, Project};
use crate::AppError;
use crate::AppStateWrapper;
use std::path::PathBuf;
use std::sync::Arc;
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

/// 删除项目时的 LSP 拆除段。
///
/// 唯一的关闭入口 `LspManager::close_sessions_for_project` 已经包含三件事
/// （逐会话 `shutdown`/`exit` 序列 + `profiles.remove` + 诊断键 `evict_project`）——
/// 此处**不得**再拼一遍，否则关闭序列会出现第二个实现（红线：单一收口点）。
///
/// 路径由调用方在删除**之前**取好：会话身份键是 `project_path:language`，
/// 项目记录一旦删除就无从还原。
fn detach_project_lsp(lsp_manager: &Arc<LspManager>, project_path: Option<&str>) {
    if let Some(path) = project_path {
        lsp_manager.close_sessions_for_project(path);
    }
}

/// Removes a project and its associated terminal/watcher resources.
#[tauri::command]
pub fn remove_project(
    project_id: String,
    state: State<AppStateWrapper>,
    app_handle: tauri::AppHandle,
) -> Result<(), AppError> {
    // 删前取项目路径：LSP 会话的身份键是 `project_path:language`（不是 project_id），
    // 删除后 manager 里已无该 id，路径就取不回来了。
    let project_path = {
        let mut pm = state.project_manager.lock().map_err(AppError::from)?;
        let path = pm
            .get_project(&project_id)
            .map(|p| p.path.to_string_lossy().to_string());
        pm.remove_project(&project_id);
        path
    };

    // 拆除单一入口：走 router 按 owner 路由（与终端 tab 关闭同一拆道）。
    state
        .terminal_router
        .close_session(&project_id, Some(&app_handle));
    state.watcher_manager.unwatch_project(&project_id);
    // LSP 与它们同段拆除：不拆的话 jdtls JVM / rust-analyzer 会活到应用退出，
    // 同路径重新添加时还会因 `is_alive` 复用旧进程（旧 exec target、旧会话根）。
    detach_project_lsp(&state.lsp_manager, project_path.as_deref());

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
    // 隔离（红线 3），与挂载侧 reconcile_mounted 对称。（remove_project / change_project_path 是
    // 同步命令，不跑在 Tokio worker 上，其直调是合法的。）
    if let Some(old_id) = current.as_deref() {
        let manager = state.watcher_manager.clone();
        let old_id = old_id.to_string();
        let _ = run_blocking(move || manager.unwatch_project(&old_id)).await;
    }

    // 这里**不**挂新项目的 watcher：挂载的唯一发起点是前端 `useVisibleWorkspaces`
    // （反应 `(activeProjectId, 激活 worktree)` → `set_visible_workspaces`），旧项目已在上一步
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    const TEST_PROJECT_PATH: &str = "/tmp/neeko-remove-project-lsp-test";
    const TEST_LANGUAGE: &str = "rust";

    /// 有界等待（不堆真实秒数）：关闭序列在阻塞池里跑，store 摘除是异步的。
    fn wait_until(mut predicate: impl FnMut() -> bool) -> bool {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if predicate() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        predicate()
    }

    /// R3/AC3：删除项目必须真的拆掉该项目的 LSP 会话。
    ///
    /// 事故形态：`remove_project` 只关终端 + 停 watcher，不动 LSP ⇒ jdtls JVM /
    /// rust-analyzer 活到应用退出；同路径重新添加时 `is_alive` 还会复用旧进程
    /// （旧 exec target、旧会话根）。
    #[test]
    fn remove_project_closes_lsp_sessions() {
        let manager = Arc::new(LspManager::new_default());
        manager.insert_stub_session_for_test(TEST_PROJECT_PATH, TEST_LANGUAGE);
        assert_eq!(
            manager.session_language_ids_for_project(TEST_PROJECT_PATH),
            vec![TEST_LANGUAGE.to_string()],
            "夹具必须先真的把会话登记进 store，否则下面断言只是空转"
        );

        detach_project_lsp(&manager, Some(TEST_PROJECT_PATH));

        assert!(
            wait_until(|| manager
                .session_language_ids_for_project(TEST_PROJECT_PATH)
                .is_empty()),
            "删除项目必须摘除该 path 的全部 LSP 会话（否则服务器活到应用退出）"
        );
    }

    /// 路径不可得（项目已不存在）时不得 panic / 不得误杀 —— 仅跳过拆除。
    #[test]
    fn missing_project_path_skips_lsp_teardown() {
        let manager = Arc::new(LspManager::new_default());
        manager.insert_stub_session_for_test(TEST_PROJECT_PATH, TEST_LANGUAGE);

        detach_project_lsp(&manager, None);

        assert_eq!(
            manager.session_language_ids_for_project(TEST_PROJECT_PATH),
            vec![TEST_LANGUAGE.to_string()],
            "没有路径就不肯猜：不得摘除任何会话"
        );
    }
}
