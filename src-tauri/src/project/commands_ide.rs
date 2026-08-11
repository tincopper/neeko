//! Tauri commands for opening IDEs (local, remote SSH, and WSL).

use crate::AppError;
use crate::AppStateWrapper;
use anyhow::Result;
use tauri::State;

/// Sets the IDE selection for a project.
#[tauri::command]
pub fn set_project_ide(
    project_id: String,
    ide: Option<String>,
    state: State<AppStateWrapper>,
) -> Result<(), AppError> {
    state
        .project_manager
        .lock()
        .map_err(AppError::from)?
        .set_selected_ide(&project_id, ide);
    Ok(())
}

/// Opens a local IDE for the given project path.
#[tauri::command]
pub fn open_ide(
    ide_command: String,
    project_path: String,
    mac_app_name: Option<String>,
) -> Result<(), AppError> {
    let trimmed = ide_command.trim();
    if trimmed.is_empty() {
        return Err("No IDE configured for this project".into());
    }

    let (exe, extra_args): (String, Vec<String>) = {
        let unquoted = trimmed.trim_matches('"').trim_matches('\'');
        if std::path::Path::new(unquoted).exists() {
            (unquoted.to_string(), vec![])
        } else if std::path::Path::new(trimmed).exists() {
            (trimmed.to_string(), vec![])
        } else {
            let parts = split_command(trimmed);
            if parts.is_empty() {
                return Err("Empty IDE command".into());
            }
            let mut it = parts.into_iter();
            let exe = it.next().ok_or_else(|| {
                AppError::InvalidInput("IDE command is empty after parsing".to_string())
            })?;
            (exe, it.collect())
        }
    };

    // 平台差异(macOS LaunchServices 降级 / Windows cmd /C)集中化于 crate::platform::ide_launch。
    crate::platform::ide_launch::launch_ide_with_fallback(
        &exe,
        &extra_args,
        &project_path,
        mac_app_name.as_deref(),
    )
}

fn split_command(s: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut chars = s.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '"' => {
                for inner in chars.by_ref() {
                    if inner == '"' {
                        break;
                    }
                    current.push(inner);
                }
            }
            '\'' => {
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

/// 通过本地命令打开 SSH IDE（VSCode Remote、Cursor、Zed 等）
#[tauri::command]
pub fn open_remote_ide(
    host: String,
    port: u16,
    username: String,
    project_path: String,
    ide: String,
) -> Result<(), AppError> {
    open_remote_ide_impl(&host, port, &username, &project_path, &ide).map_err(AppError::from)
}

fn open_remote_ide_impl(
    host: &str,
    port: u16,
    username: &str,
    project_path: &str,
    ide: &str,
) -> Result<()> {
    let ide_lower = ide.to_lowercase();

    // 根据 IDE 类型决定参数格式
    let args: Vec<String> = if ide_lower.contains("code") || ide_lower.contains("cursor") {
        let ssh_connection = format!("ssh-remote+{}@{}:{}", username, host, port);
        vec![
            "--remote".to_string(),
            ssh_connection,
            project_path.to_string(),
        ]
    } else if ide_lower.contains("zed") {
        let ssh_url = format!("ssh://{}@{}:{}{}", username, host, port, project_path);
        vec![ssh_url]
    } else {
        return Err(anyhow::anyhow!(
            "IDE '{}' does not support SSH remote opening. Supported: VSCode (code), Cursor (cursor), Zed (zed)",
            ide
        ));
    };

    spawn_ide_process(ide, &args)
}

fn spawn_ide_process(exe: &str, args: &[String]) -> Result<()> {
    // 平台差异(Windows cmd /C vs Unix 直接 spawn)集中化于 crate::platform::ide_launch。
    crate::platform::ide_launch::spawn_ide_process(exe, args)
}

/// Opens an IDE inside a WSL distribution.
#[tauri::command]
pub fn open_wsl_ide(distro: String, project_path: String, ide: String) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::open_wsl_ide(&distro, &project_path, &ide).map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, ide);
        Err(AppError::Unsupported(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}
