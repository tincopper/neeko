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
