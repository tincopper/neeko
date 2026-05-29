use crate::AppError;

fn wsl_command(program: &str) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Get list of installed WSL distributions.
pub fn get_wsl_distros() -> Result<Vec<String>, AppError> {
    if !cfg!(target_os = "windows") {
        return Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ));
    }
    let output = wsl_command("wsl.exe")
        .args(["-l", "-q"])
        .env("WSL_UTF8", "1")
        .output()
        .map_err(|e| format!("Failed to execute wsl.exe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Wsl(format!("WSL command failed: {}", stderr)));
    }

    let distros: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| line.trim().trim_end_matches('*').trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();

    Ok(distros)
}

/// List subdirectories in a WSL distribution at the given path.
pub fn get_wsl_directories(distro: &str, path: Option<&str>) -> Result<Vec<String>, AppError> {
    if !cfg!(target_os = "windows") {
        return Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ));
    }
    let dir_path = path.unwrap_or("/");

    let cmd = format!(
        "ls -1p \"{}\" 2>/dev/null | grep '/$' | sed 's|/$||'",
        dir_path.replace('"', "\\\"")
    );

    let output = wsl_command("wsl.exe")
        .args(["-d", distro, "bash", "-c", &cmd])
        .env("WSL_UTF8", "1")
        .output()
        .map_err(|e| format!("Failed to execute wsl.exe: {}", e))?;

    let entries: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();

    Ok(entries)
}

/// Get the home directory path inside a WSL distribution.
pub fn get_wsl_home_dir(distro: &str) -> Result<String, AppError> {
    if !cfg!(target_os = "windows") {
        return Err(AppError::Wsl(
            "WSL is only supported on Windows".to_string(),
        ));
    }
    let output = wsl_command("wsl.exe")
        .args(["-d", distro, "bash", "-c", "echo $HOME"])
        .env("WSL_UTF8", "1")
        .output()
        .map_err(|e| format!("Failed to execute wsl.exe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Wsl(format!("WSL command failed: {}", stderr)));
    }

    let home_dir = String::from_utf8_lossy(&output.stdout).trim().to_string();

    Ok(home_dir)
}
