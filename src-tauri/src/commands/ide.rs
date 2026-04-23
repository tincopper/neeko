use crate::AppError;
use crate::AppStateWrapper;
use anyhow::Result;
use tauri::State;

#[tauri::command]
pub fn set_project_ide(project_id: String, ide: Option<String>, state: State<AppStateWrapper>) {
    state
        .project_manager
        .lock()
        .unwrap()
        .set_selected_ide(&project_id, ide);
}

#[tauri::command]
pub fn open_ide(ide_command: String, project_path: String) -> Result<(), AppError> {
    use std::process::Command;

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
            let exe = it.next().unwrap();
            (exe, it.collect())
        }
    };

    let mut cmd = Command::new(&exe);
    cmd.args(&extra_args);
    cmd.arg(&project_path);

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
    use std::process::Command;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x00000008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;

        let full_command = std::iter::once(exe.to_string())
            .chain(args.iter().cloned())
            .collect::<Vec<_>>()
            .join(" ");

        Command::new("cmd.exe")
            .args(["/C", &full_command])
            .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
            .spawn()
            .map_err(|e| {
                anyhow::anyhow!(
                    "Failed to launch '{}': {}. Make sure it's installed and in PATH.",
                    exe,
                    e
                )
            })?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;

        Command::new(exe)
            .args(args)
            .process_group(0)
            .spawn()
            .map_err(|e| {
                anyhow::anyhow!(
                    "Failed to launch '{}': {}. Make sure it's installed and in PATH.",
                    exe,
                    e
                )
            })?;
    }

    Ok(())
}

#[tauri::command]
pub fn open_wsl_ide(distro: String, project_path: String, ide: String) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    {
        crate::git::open_wsl_ide(&distro, &project_path, &ide).map_err(AppError::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, ide);
        Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ))
    }
}
