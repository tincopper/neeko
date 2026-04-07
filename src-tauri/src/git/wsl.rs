use anyhow::Result;
use std::process::Command;

use crate::state::{DiffResult, GitInfo};

use super::local::parse_unified_diff;
use super::remote::parse_git_info_output;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn no_window_cmd(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn safe_path(path: &str) -> String {
    path.replace('\'', "'\\''")
}

/// 执行 wsl.exe -d distro bash -c "<cmd>" 并返回 stdout
#[cfg(target_os = "windows")]
fn run_wsl_bash(distro: &str, cmd: &str) -> Result<String> {
    let output = no_window_cmd("wsl.exe")
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

/// 通过 WSL 获取完整 GitInfo（1 次 wsl.exe 调用）
#[cfg(target_os = "windows")]
pub fn get_wsl_git_info(distro: &str, project_path: &str) -> Result<GitInfo> {
    let sp = safe_path(project_path);
    let output = run_wsl_bash(
        distro,
        &format!(
            "cd '{sp}' \
          && printf '__BRANCH__\\n' \
          && git branch --show-current 2>/dev/null \
          && printf '\\n__BRANCHES__\\n' \
          && git branch 2>/dev/null \
          && printf '\\n__WORKTREES__\\n' \
          && git worktree list --porcelain 2>/dev/null \
          && printf '\\n__STATUS__\\n' \
          && git status --porcelain 2>/dev/null"
        ),
    )?;

    Ok(parse_git_info_output(&output))
}

/// 通过 WSL 获取文件 diff
#[cfg(target_os = "windows")]
pub fn get_wsl_file_diff(distro: &str, project_path: &str, file_path: &str) -> Result<DiffResult> {
    let sp = safe_path(project_path);
    let fp = safe_path(file_path);
    let output = run_wsl_bash(
        distro,
        &format!("cd '{sp}' && git diff --unified=3 -- '{fp}' 2>/dev/null"),
    )?;
    Ok(parse_unified_diff(&output))
}

/// 通过 WSL 执行通用 git 写操作（checkout/create_branch/rename 等）
#[cfg(target_os = "windows")]
pub fn run_wsl_git(distro: &str, project_path: &str, git_args: &[&str]) -> Result<String> {
    let sp = safe_path(project_path);
    // 每个参数单独用单引号包裹，防止包含空格的分支名被 shell 拆分
    let quoted_args: Vec<String> = git_args
        .iter()
        .map(|a| format!("'{}'", safe_path(a)))
        .collect();
    let git_cmd = format!("cd '{}' && git {}", sp, quoted_args.join(" "));
    run_wsl_bash(distro, &git_cmd)
}

/// 通过 WSL 打开 IDE
#[cfg(target_os = "windows")]
pub fn open_wsl_ide(distro: &str, project_path: &str, ide: &str) -> Result<()> {
    // 在 WSL 中以后台模式运行 code 或 zed
    let _ = no_window_cmd("wsl.exe")
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
