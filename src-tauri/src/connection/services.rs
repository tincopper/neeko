use crate::common::executor::factory::ExecTarget;
use crate::common::executor::sync::exec_on;
use crate::AppError;

/// Get list of installed WSL distributions.
pub fn get_wsl_distros() -> Result<Vec<String>, AppError> {
    let rt = tokio::runtime::Runtime::new().map_err(|e| AppError::Wsl(e.to_string()))?;
    let target = ExecTarget::Wsl {
        distro: String::new(),
    };
    rt.block_on(async move {
        let output = exec_on(&target, "wsl.exe", &["-l", "-q"])
            .await
            .map_err(|e| AppError::Wsl(format!("Failed to list WSL distros: {}", e)))?;
        let distros: Vec<String> = output
            .lines()
            .map(|line| line.trim().trim_end_matches('*').trim().to_string())
            .filter(|line| !line.is_empty())
            .collect();
        Ok(distros)
    })
}

/// List subdirectories in a WSL distribution at the given path.
pub fn get_wsl_directories(distro: &str, path: Option<&str>) -> Result<Vec<String>, AppError> {
    // These are called from sync Tauri commands, so we need block_on.
    // A future refactor could make the callers async.
    let distro = distro.to_string();
    let dir_path = path.unwrap_or("/").to_string();
    let cmd = format!(
        "ls -1p \"{}\" 2>/dev/null | grep '/$' | sed 's|/$||'",
        dir_path.replace('"', "\\\"")
    );

    let rt = tokio::runtime::Runtime::new().map_err(|e| AppError::Wsl(e.to_string()))?;
    rt.block_on(async move {
        let target = ExecTarget::Wsl {
            distro: distro.clone(),
        };
        let output = exec_on(&target, "bash", &["-c", &cmd])
            .await
            .map_err(|e| AppError::Wsl(format!("Failed to list WSL directories: {}", e)))?;
        let entries: Vec<String> = output
            .lines()
            .filter(|line| !line.is_empty())
            .map(|line| line.trim().to_string())
            .filter(|line| !line.is_empty())
            .collect();
        Ok(entries)
    })
}

/// Get the home directory path inside a WSL distribution.
pub fn get_wsl_home_dir(distro: &str) -> Result<String, AppError> {
    let distro = distro.to_string();
    let rt = tokio::runtime::Runtime::new().map_err(|e| AppError::Wsl(e.to_string()))?;
    rt.block_on(async move {
        let target = ExecTarget::Wsl {
            distro: distro.clone(),
        };
        let output = exec_on(&target, "bash", &["-c", "echo $HOME"])
            .await
            .map_err(|e| AppError::Wsl(format!("Failed to get WSL home dir: {}", e)))?;
        Ok(output.trim().to_string())
    })
}
