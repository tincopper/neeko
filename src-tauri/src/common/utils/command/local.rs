use std::process::Command;

/// Windows process creation flag constants.
#[cfg(target_os = "windows")]
pub mod flags {
    /// Prevents the process from creating a console window.
    pub const CREATE_NO_WINDOW: u32 = 0x08000000;
    /// Creates a process that is not attached to the parent's console.
    pub const DETACHED_PROCESS: u32 = 0x00000008;
    /// Creates a new process group for the process.
    pub const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
}

/// Create a `Command` that runs without a visible console window on Windows.
#[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
pub fn exec(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(flags::CREATE_NO_WINDOW);
    }
    cmd
}

/// Create a detached process with no window (Windows only).
///
/// Suitable for launching GUI applications (e.g. IDE): no console inheritance,
/// not tied to parent process lifetime.
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

/// Check whether a command exists under the given PATH string.
pub fn command_exists_on_path(command: &str, path_env: &str) -> bool {
    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/"));
    which::which_in(command, Some(path_env), cwd.as_path()).is_ok()
}

/// Escape single quotes in a path for safe POSIX shell interpolation.
pub fn safe_path(path: &str) -> String {
    path.replace('\'', "'\\''")
}

/// Single-quote a string for POSIX shell interpolation (`'foo'\''bar'` style).
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

/// Resolve a command to its full executable path using `where.exe` (Windows) or `which` (Unix).
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

/// Get the full PATH merging current process PATH with user/system PATH.
///
/// Solves the issue of Tauri GUI processes not inheriting the user shell PATH
/// (npm global bin, nvm, cargo, homebrew, etc.).
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
