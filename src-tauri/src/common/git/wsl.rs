use anyhow::Result;

use crate::common::utils::command::wsl::open_ide;

/// 通过 WSL 打开 IDE
pub fn open_wsl_ide(distro: &str, project_path: &str, ide: &str) -> Result<()> {
    open_ide(distro, project_path, ide)
}
