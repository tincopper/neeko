pub mod gh;
pub mod local;
pub mod ssh;
pub mod ssh_auth;

#[cfg(target_os = "windows")]
pub mod wsl;

#[cfg(not(target_os = "windows"))]
pub(crate) mod wsl {
    use anyhow::{bail, Result};
    pub fn exec(_distro: &str, _cmd: &str) -> Result<String> {
        bail!("WSL is only supported on Windows")
    }
    pub fn open_ide(_distro: &str, _project_path: &str, _ide: &str) -> Result<()> {
        bail!("WSL is only supported on Windows")
    }
}
