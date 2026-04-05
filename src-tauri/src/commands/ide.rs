use crate::AppStateWrapper;
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
pub fn open_ide(ide_command: String, project_path: String) -> Result<(), String> {
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

#[tauri::command]
pub fn open_remote_ide(
    host: String,
    port: u16,
    username: String,
    project_path: String,
    ide: String,
) -> Result<(), String> {
    crate::remote::open_remote_ide(&host, port, &username, &project_path, &ide)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_wsl_ide(distro: String, project_path: String, ide: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        crate::remote::open_wsl_ide(&distro, &project_path, &ide).map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (distro, project_path, ide);
        Err("WSL is only supported on Windows".to_string())
    }
}
