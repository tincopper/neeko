use serde::Deserialize;

use crate::git::operations;
use crate::git::transport::GitTransport;
use crate::models::AuthMethod;
use crate::AppError;

#[derive(Debug, Deserialize)]
pub enum GitTransportKind {
    Local { project_path: String },
    #[cfg(target_os = "windows")]
    Wsl { distro: String, project_path: String },
    Remote {
        host: String,
        port: u16,
        username: String,
        auth: AuthMethod,
        project_path: String,
    },
}

fn into_transport_and_dir(kind: &GitTransportKind) -> (GitTransport, &str) {
    match kind {
        GitTransportKind::Local { project_path } => (GitTransport::Local, project_path.as_str()),
        #[cfg(target_os = "windows")]
        GitTransportKind::Wsl {
            distro,
            project_path,
        } => (
            GitTransport::Wsl {
                distro: distro.clone(),
            },
            project_path.as_str(),
        ),
        GitTransportKind::Remote {
            host,
            port,
            username,
            auth,
            project_path,
        } => (
            GitTransport::Remote {
                host: host.clone(),
                port: *port,
                username: username.clone(),
                auth: auth.clone(),
            },
            project_path.as_str(),
        ),
    }
}

#[tauri::command]
pub async fn unified_stage_files(
    transport: GitTransportKind,
    file_paths: Vec<String>,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::stage_files(&t, wd, &file_paths)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_unstage_files(
    transport: GitTransportKind,
    file_paths: Vec<String>,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::unstage_files(&t, wd, &file_paths)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_stage_all(
    transport: GitTransportKind,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::stage_all(&t, wd)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_unstage_all(
    transport: GitTransportKind,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::unstage_all(&t, wd)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_discard_file(
    transport: GitTransportKind,
    file_path: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::discard_file(&t, wd, &file_path)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_discard_all(
    transport: GitTransportKind,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::discard_all(&t, wd)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_fetch(
    transport: GitTransportKind,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::fetch(&t, wd).await.map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_push(
    transport: GitTransportKind,
    set_upstream: Option<bool>,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::push(&t, wd, set_upstream.unwrap_or(false))
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_cherry_pick(
    transport: GitTransportKind,
    commit_hash: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::cherry_pick(&t, wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_revert(
    transport: GitTransportKind,
    commit_hash: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::revert(&t, wd, &commit_hash)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_create_tag(
    transport: GitTransportKind,
    name: String,
    message: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::create_tag(&t, wd, &name, &message)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_checkout_branch(
    transport: GitTransportKind,
    branch_name: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::checkout_branch(&t, wd, &branch_name)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_create_branch(
    transport: GitTransportKind,
    branch_name: String,
    start_point: Option<String>,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::create_branch(&t, wd, &branch_name, start_point.as_deref())
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_delete_branch(
    transport: GitTransportKind,
    branch_name: String,
    force: Option<bool>,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::delete_branch(&t, wd, &branch_name, force.unwrap_or(false))
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_rename_branch(
    transport: GitTransportKind,
    old_name: String,
    new_name: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::rename_branch(&t, wd, &old_name, &new_name)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_remove_worktree(
    transport: GitTransportKind,
    worktree_path: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::remove_worktree(&t, wd, &worktree_path)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_rename_worktree(
    transport: GitTransportKind,
    old_path: String,
    new_path: String,
) -> Result<(), AppError> {
    let (t, wd) = into_transport_and_dir(&transport);
    operations::rename_worktree(&t, wd, &old_path, &new_path)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn unified_is_worktree_dirty(
    transport: GitTransportKind,
    worktree_path: String,
) -> Result<bool, AppError> {
    let (t, _wd) = into_transport_and_dir(&transport);
    operations::is_worktree_dirty(&t, &worktree_path)
        .await
        .map_err(AppError::from)
}
