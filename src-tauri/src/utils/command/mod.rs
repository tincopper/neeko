pub mod local;
pub mod ssh;
pub mod ssh_auth;
pub mod wsl;

use std::env;
use std::process::Command;
use which::{which, which_in};

/// Check if a command exists on the system PATH.
pub fn check_command_exists(command: &str) -> bool {
    if cfg!(target_os = "windows") {
        which(command).is_ok()
    } else {
        let shell = env::var("SHELL").unwrap_or_else(|_| "bash".to_string());
        let interactive_path = Command::new(&shell)
            .args(["-i", "-c", "echo $PATH"])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|p| !p.is_empty());

        let cwd = env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/"));
        match interactive_path {
            Some(path) => which_in(command, Some(path), cwd.as_path()).is_ok(),
            None => which(command).is_ok(),
        }
    }
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
}
