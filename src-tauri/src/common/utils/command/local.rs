use std::process::Command;

/// Windows 进程创建标志常量
#[cfg(target_os = "windows")]
pub mod flags {
    pub const CREATE_NO_WINDOW: u32 = 0x08000000;
    pub const DETACHED_PROCESS: u32 = 0x00000008;
    pub const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
}

/// 创建无窗口进程命令（Windows 下隐藏控制台窗口）
pub fn exec(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(flags::CREATE_NO_WINDOW);
    }
    cmd
}

/// 创建无窗口且与当前进程完全分离的进程命令
/// 适用于启动 GUI 应用（如 IDE）：不继承控制台、不随父进程退出
#[cfg(target_os = "windows")]
pub fn exec_detached(program: &str) -> Command {
    let mut cmd = Command::new(program);
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(
            flags::CREATE_NO_WINDOW | flags::DETACHED_PROCESS | flags::CREATE_NEW_PROCESS_GROUP,
        );
    }
    cmd
}

/// Check if a command exists on the system PATH.
pub fn check_command_exists(command: &str) -> bool {
    if cfg!(target_os = "windows") {
        which::which(command).is_ok()
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string());
        let interactive_path = Command::new(&shell)
            .args(["-i", "-c", "echo $PATH"])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|p| !p.is_empty());

        let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/"));
        match interactive_path {
            Some(path) => which::which_in(command, Some(path), cwd.as_path()).is_ok(),
            None => which::which(command).is_ok(),
        }
    }
}

/// Escape single quotes in a path for safe shell interpolation.
pub fn safe_path(path: &str) -> String {
    path.replace('\'', "'\\''")
}

/// Resolve a command to its full executable path using where.exe (Windows) or which (Unix).
/// Falls back to the original command name if not found.
pub fn resolve_command_path(command: &str, path_env: &str) -> String {
    if std::path::Path::new(command).is_absolute() {
        return command.to_string();
    }

    #[cfg(target_os = "windows")]
    {
        let output = exec("where.exe")
            .arg(command)
            .env("PATH", path_env)
            .output();

        if let Ok(o) = output {
            if o.status.success() {
                let text = String::from_utf8_lossy(&o.stdout);
                if let Some(first) = text.lines().next() {
                    let p = first.trim().to_string();
                    if !p.is_empty() {
                        log::info!("[Command] resolved '{}' -> '{}'", command, p);
                        return p;
                    }
                }
            }
        }
        command.to_string()
    }

    #[cfg(not(target_os = "windows"))]
    {
        use which::which_in;
        match which_in(
            command,
            Some(path_env),
            std::env::current_dir().unwrap_or_default(),
        ) {
            Ok(p) => {
                let s = p.to_string_lossy().to_string();
                log::info!("[Command] resolved '{}' -> '{}'", command, s);
                s
            }
            Err(_) => command.to_string(),
        }
    }
}

/// Get the full PATH: merges current process PATH + user/system PATH.
/// Solves Tauri GUI process not inheriting user shell PATH (npm global bin, nvm, etc.).
pub fn resolve_full_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();

    #[cfg(target_os = "windows")]
    {
        let user_path = std::env::var("USERPROFILE")
            .map(|home| {
                let appdata = std::env::var("APPDATA").unwrap_or_default();
                vec![
                    format!("{}\\AppData\\Local\\Microsoft\\WindowsApps", home),
                    format!("{}\\npm", appdata),
                    format!("{}\\npm", home),
                ]
            })
            .unwrap_or_default();

        let reg_user_path = read_registry_path_windows();

        let mut parts: Vec<String> = vec![current.clone()];
        if !reg_user_path.is_empty() {
            parts.push(reg_user_path);
        }
        parts.extend(user_path);

        let mut seen = std::collections::HashSet::new();
        parts
            .join(";")
            .split(';')
            .filter(|p| !p.is_empty() && seen.insert(p.to_string()))
            .collect::<Vec<_>>()
            .join(";")
    }

    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let extra = [
            format!("{}/.local/bin", home),
            format!("{}/.nvm/versions/node/current/bin", home),
            "/usr/local/bin".to_string(),
            "/opt/homebrew/bin".to_string(),
        ];
        let mut parts: Vec<&str> = current.split(':').collect();
        for e in &extra {
            if !parts.contains(&e.as_str()) {
                parts.push(e);
            }
        }
        parts.join(":")
    }
}

/// Read user-level PATH from Windows registry (HKCU\Environment).
#[cfg(target_os = "windows")]
fn read_registry_path_windows() -> String {
    let output = exec("reg")
        .args(["query", "HKCU\\Environment", "/v", "PATH"])
        .output();

    match output {
        Ok(o) if o.status.success() => {
            let text = String::from_utf8_lossy(&o.stdout).to_string();
            for line in text.lines() {
                let line = line.trim();
                if line.to_uppercase().starts_with("PATH") {
                    if let Some(pos) = line.rfind("REG_") {
                        let after = &line[pos..];
                        if let Some(val_pos) = after.find("    ") {
                            let val = after[val_pos..].trim();
                            return expand_env_vars_windows(val);
                        }
                    }
                }
            }
            String::new()
        }
        _ => String::new(),
    }
}

/// Expand %VAR% style environment variables on Windows.
#[cfg(target_os = "windows")]
fn expand_env_vars_windows(s: &str) -> String {
    let mut result = s.to_string();
    if !result.contains('%') {
        return result;
    }
    let output = exec("cmd.exe")
        .args(["/C", &format!("echo {}", s)])
        .output();
    if let Ok(o) = output {
        let expanded = String::from_utf8_lossy(&o.stdout).trim().to_string();
        if !expanded.is_empty() && !expanded.starts_with("echo") {
            result = expanded;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_return_true_for_existing_command() {
        #[cfg(target_os = "windows")]
        let cmd = "cmd";
        #[cfg(not(target_os = "windows"))]
        let cmd = "bash";
        assert!(check_command_exists(cmd));
    }

    #[test]
    fn should_return_true_for_windows_specific_command() {
        #[cfg(target_os = "windows")]
        assert!(check_command_exists("powershell"));
        #[cfg(not(target_os = "windows"))]
        assert!(check_command_exists("sh"));
    }

    #[test]
    fn should_return_false_for_nonexistent_command() {
        assert!(!check_command_exists("nonexistent_command_xyz_12345"));
    }

    #[test]
    fn should_escape_single_quotes_in_path() {
        assert_eq!(safe_path("/path/to/file"), "/path/to/file");
        assert_eq!(safe_path("/path/it's/file"), "/path/it'\\''s/file");
    }
}
