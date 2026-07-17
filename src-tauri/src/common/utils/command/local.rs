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

/// Create a Command with full PATH resolution and PATH injected into the child.
///
/// Prefer [`crate::common::executor`] / `core::exec` for new business code.
/// This helper remains for sync local spawns (e.g. long-lived LSP stdio) that
/// share the same PATH rules as [`crate::common::executor::local::LocalExecutor`].
pub fn cmd_from_path(program: &str) -> Command {
    let path = resolve_full_path();
    let resolved = resolve_command_path(program, &path);
    let mut cmd = exec(&resolved);
    cmd.env("PATH", path);
    cmd
}

/// Check if a command exists on the (process + extras) PATH.
///
/// Uses the same PATH source as [`cmd_from_path`] / LocalExecutor — not a
/// separate interactive shell probe — so detection and spawn stay consistent.
pub fn check_command_exists(command: &str) -> bool {
    command_exists_on_path(command, &resolve_full_path())
}

/// Whether `command` is found under the given PATH string.
pub fn command_exists_on_path(command: &str, path_env: &str) -> bool {
    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/"));
    which::which_in(command, Some(path_env), cwd.as_path()).is_ok()
}

/// Escape single quotes in a path for safe shell interpolation.
pub fn safe_path(path: &str) -> String {
    path.replace('\'', "'\\''")
}

/// Single-quote a string for POSIX shells (`'foo'\''bar'` style via embedding).
pub fn quote_shell_arg(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Build a POSIX argv string with each argument shell-quoted.
pub fn join_quoted_command(cmd: &str, args: &[&str]) -> String {
    std::iter::once(cmd)
        .chain(args.iter().copied())
        .map(quote_shell_arg)
        .collect::<Vec<_>>()
        .join(" ")
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
            format!("{}/.cargo/bin", home),
            format!("{}/.nvm/versions/node/current/bin", home),
            // fnm default aliases (best-effort fallback when shell init missed)
            format!("{}/.local/share/fnm/aliases/default/bin", home),
            "/usr/local/bin".to_string(),
            "/opt/homebrew/bin".to_string(),
        ];
        let mut parts: Vec<String> = current
            .split(':')
            .filter(|p| !p.is_empty())
            .map(|s| s.to_string())
            .collect();
        for e in &extra {
            if !parts.iter().any(|p| p == e) {
                parts.push(e.clone());
            }
        }
        // Append latest fnm node-versions/*/installation/bin if present
        let fnm_versions = std::path::PathBuf::from(&home)
            .join(".local/share/fnm/node-versions");
        if let Ok(entries) = std::fs::read_dir(&fnm_versions) {
            let mut version_bins: Vec<String> = entries
                .flatten()
                .filter_map(|e| {
                    let bin = e.path().join("installation/bin");
                    if bin.is_dir() {
                        Some(bin.to_string_lossy().to_string())
                    } else {
                        None
                    }
                })
                .collect();
            version_bins.sort();
            // Prefer newer versions last so earlier PATH entries win if already present;
            // we only add missing ones — put highest sort last so they don't override
            // an already-selected node from process PATH.
            for b in version_bins {
                if !parts.iter().any(|p| p == &b) {
                    parts.push(b);
                }
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

    #[test]
    fn should_quote_shell_args() {
        assert_eq!(quote_shell_arg("foo"), "'foo'");
        assert_eq!(quote_shell_arg("a'b"), "'a'\\''b'");
    }

    #[test]
    fn should_join_quoted_command() {
        assert_eq!(
            join_quoted_command("echo", &["hello world"]),
            "'echo' 'hello world'"
        );
    }
}
