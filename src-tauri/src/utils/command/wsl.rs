use crate::utils::command::local;
use anyhow::Result;

pub fn safe_path(path: &str) -> String {
    path.replace('\'', "'\\''")
}

/// 通过 WSL bash 执行命令并返回 stdout
pub fn exec(distro: &str, cmd: &str) -> Result<String> {
    let mut wsl_cmd = local::exec("wsl.exe");
    let output = wsl_cmd
        .arg("-d")
        .arg(distro)
        .arg("bash")
        .arg("-c")
        .arg(cmd)
        .output()
        .map_err(|e| anyhow::anyhow!("Failed to execute wsl.exe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let msg = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("Command failed with status {}", output.status)
        };
        return Err(anyhow::anyhow!("{}", msg));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// 通过 WSL 打开 IDE（后台运行）
pub fn open_ide(distro: &str, project_path: &str, ide: &str) -> Result<()> {
    let _ = local::exec("wsl.exe")
        .arg("-d")
        .arg(distro)
        .arg("--cd")
        .arg(project_path)
        .arg("--")
        .arg(ide)
        .arg(".")
        .spawn()
        .map_err(|e| anyhow::anyhow!("Failed to launch IDE in WSL: {}", e))?;
    Ok(())
}
