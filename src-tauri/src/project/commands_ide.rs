//! Tauri commands for opening IDEs (local, remote SSH, and WSL).

use crate::common::executor::factory::ExecTarget;
#[cfg(target_os = "macos")]
use crate::core::exec::collect_blocking;
use crate::core::exec::spawn_detached;
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

    let mut launch_args = extra_args.clone();
    launch_args.push(project_path.clone());
    let arg_refs: Vec<&str> = launch_args.iter().map(String::as_str).collect();

    match spawn_detached(&ExecTarget::Local, &exe, &arg_refs) {
        Ok(()) => Ok(()),
        Err(err) => {
            // macOS fallback：用户从 .dmg 装的 GUI 应用（GoLand/IntelliJ 等）
            // 没生成 Toolbox shell shim 时，裸命令不在 PATH。
            // 走 LaunchServices `open -a <app>` 按 app name 查找 /Applications/*.app。
            // 优先用前端传过来的 macAppName（CFBundleName），命中不到再 fallback 到裸命令名——
            // 后者只对 bundle name == command 的产品（GoLand/PyCharm/Zed 等）有效，
            // IntelliJ IDEA 这类 bundle name "IntelliJ IDEA" ≠ command "idea" 的产品必须走 macAppName。
            #[cfg(target_os = "macos")]
            if matches!(&err, crate::common::executor::ExecError::Io(io) if io.kind() == std::io::ErrorKind::NotFound)
                && !exe.contains('/')
            {
                let target = mac_app_name.as_deref().unwrap_or(&exe);
                return open_via_launch_services(target, &extra_args, &project_path);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = mac_app_name;
            Err(format!("Failed to launch '{}': {}", exe, err).into())
        }
    }
}

#[cfg(target_os = "macos")]
fn open_via_launch_services(
    app_name: &str,
    extra_args: &[String],
    project_path: &str,
) -> Result<(), AppError> {
    let mut args: Vec<&str> = vec!["-a", app_name, project_path];
    if !extra_args.is_empty() {
        args.push("--args");
        for a in extra_args {
            args.push(a);
        }
    }
    let output = collect_blocking(&ExecTarget::Local, "open", &args).map_err(|e| {
        format!(
            "Failed to launch '{}' via LaunchServices: {}. Install the app under /Applications or set the IDE command to the full executable path in Settings.",
            app_name, e
        )
    })?;
    if output.exit_code != 0 {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "LaunchServices could not find '{}': {}. Install the app under /Applications or set the IDE command to the full executable path in Settings.",
            app_name,
            if stderr.is_empty() { "no such application".to_string() } else { stderr }
        )
        .into());
    }
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
    #[cfg(windows)]
    {
        let full_command = std::iter::once(exe.to_string())
            .chain(args.iter().cloned())
            .collect::<Vec<_>>()
            .join(" ");

        spawn_detached(&ExecTarget::Local, "cmd", &["/C", &full_command]).map_err(|e| {
            anyhow::anyhow!(
                "Failed to launch '{}': {}. Make sure it's installed and in PATH.",
                exe,
                e
            )
        })?;
    }

    #[cfg(unix)]
    {
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        spawn_detached(&ExecTarget::Local, exe, &arg_refs).map_err(|e| {
            anyhow::anyhow!(
                "Failed to launch '{}': {}. Make sure it's installed and in PATH.",
                exe,
                e
            )
        })?;
    }

    Ok(())
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
