//! Tauri commands for cloning a git repository into a new local project.
//!
//! Thin command layer (Review Gate #6/#9): parameter validation dispatches to
//! [`crate::project::clone`]; no business logic here.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::app_state::AppStateWrapper;
use crate::common::error::AppError;
use crate::common::executor::factory::ExecTarget;
use crate::core::exec;
use crate::project::clone::{self, CloneHandle};
use crate::project::events::{CloneProgressEvent, CLONE_PROGRESS_EVENT};

/// Result payload of a successful clone — the path the project was cloned to.
#[derive(Debug, Serialize)]
pub struct CloneProjectResult {
    /// Absolute path of the cloned repository.
    pub path: String,
}

/// Clone a git repository (http/https/git@) into `dest_parent/name`.
/// Full clone of the default branch; streaming progress events; rejects an
/// existing destination. On success the frontend runs the normal
/// `add_project` chain with the returned path.
#[tauri::command]
pub async fn clone_git_project(
    url: String,
    dest_parent: String,
    name: String,
    state: State<'_, AppStateWrapper>,
    app_handle: AppHandle,
) -> Result<CloneProjectResult, AppError> {
    clone::validate_git_url(&url).map_err(AppError::InvalidInput)?;
    let name = clone::sanitize_project_name(&name).map_err(AppError::InvalidInput)?;
    // `ensure_target_available` touches the filesystem (`canonicalize` + `exists`);
    // off-load it from the async driver thread (Pillar 7: Tokio 阻塞隔离).
    let dest_parent_for_check = dest_parent.clone();
    let name_for_check = name.clone();
    let dest = tokio::task::spawn_blocking(move || {
        clone::ensure_target_available(&PathBuf::from(&dest_parent_for_check), &name_for_check)
    })
    .await
    .map_err(|e| AppError::Unknown(format!("clone target check panicked: {e}")))??;

    if !exec::command_exists(&ExecTarget::Local, "git").await {
        return Err(AppError::Project(
            "git command not found — please install git and restart Neeko".to_string(),
        ));
    }

    // Single-clone guard: occupy the slot, clone the handle out, drop the
    // lock before awaiting (no lock across await points).
    let handle = {
        let mut slot = state
            .project_clone
            .lock()
            .map_err(|_| AppError::Unknown("project clone slot poisoned".to_string()))?;
        if slot.is_some() {
            return Err(AppError::InvalidInput(
                "A clone is already in progress".to_string(),
            ));
        }
        let handle = CloneHandle::new();
        *slot = Some(handle.clone());
        handle
    };

    let clone_id = uuid::Uuid::new_v4().to_string();
    let emitter = app_handle.clone();
    let result = clone::run_clone(
        &clone_id,
        &url,
        dest,
        &handle,
        move |event: CloneProgressEvent| {
            if let Err(e) = emitter.emit(CLONE_PROGRESS_EVENT, event) {
                log::warn!("Failed to emit {CLONE_PROGRESS_EVENT}: {e}");
            }
        },
    )
    .await;

    // Release the slot regardless of outcome.
    if let Ok(mut slot) = state.project_clone.lock() {
        *slot = None;
    }

    result.map(|path| CloneProjectResult {
        path: path.to_string_lossy().into_owned(),
    })
}

/// Request cancellation of the running clone (idempotent when idle).
#[tauri::command]
pub fn cancel_project_clone(state: State<'_, AppStateWrapper>) -> Result<(), AppError> {
    let handle = state
        .project_clone
        .lock()
        .map_err(|_| AppError::Unknown("project clone slot poisoned".to_string()))?
        .clone();
    if let Some(handle) = handle {
        if let Err(e) = handle.cancel() {
            log::warn!("Failed to signal clone cancellation: {e}");
        }
    }
    Ok(())
}
