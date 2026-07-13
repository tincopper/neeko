use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use anyhow::{Context, Result};
use serde::de::DeserializeOwned;

pub struct GhCli {
    repo_path: PathBuf,
    owner: Mutex<Option<(String, String)>>,
}

impl GhCli {
    pub fn new(repo_path: &Path) -> Self {
        Self {
            repo_path: repo_path.to_path_buf(),
            owner: Mutex::new(None),
        }
    }

    fn cmd(&self) -> Command {
        let mut cmd = Command::new("gh");
        cmd.current_dir(&self.repo_path);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        cmd
    }

    pub fn run(&self, build: impl FnOnce(&mut Command)) -> Result<String> {
        let mut cmd = self.cmd();
        build(&mut cmd);
        let output = cmd.output().context("Failed to execute gh command")?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("gh command failed: {}", stderr.trim());
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    pub fn run_json<T: DeserializeOwned>(&self, build: impl FnOnce(&mut Command)) -> Result<T> {
        let stdout = self.run(build)?;
        serde_json::from_str(&stdout).with_context(|| {
            format!(
                "Failed to parse gh output as JSON: {}",
                &stdout[..stdout.len().min(200)]
            )
        })
    }

    pub fn api_run(&self, path: &str, build: impl FnOnce(&mut Command)) -> Result<String> {
        let (owner, repo) = self.repo_owner_name()?;
        let api_path = format!("repos/{}/{}/{}", owner, repo, path);
        self.run(|cmd| {
            cmd.args(["api", &api_path]);
            build(cmd);
        })
    }

    pub fn api_json<T: DeserializeOwned>(
        &self,
        path: &str,
        build: impl FnOnce(&mut Command),
    ) -> Result<T> {
        let stdout = self.api_run(path, build)?;
        serde_json::from_str(&stdout).with_context(|| "Failed to parse gh api output as JSON")
    }

    pub fn repo_owner_name(&self) -> Result<(String, String)> {
        let mut guard = self.owner.lock().unwrap();
        if let Some(ref pair) = *guard {
            return Ok(pair.clone());
        }
        let stdout = self.run(|cmd| {
            cmd.args(["repo", "view", "--json", "owner", "name"]);
        })?;
        let v: serde_json::Value =
            serde_json::from_str(&stdout).context("Failed to parse gh repo view output")?;
        let owner = v["owner"]["login"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let repo = v["name"].as_str().unwrap_or("").to_string();
        if owner.is_empty() || repo.is_empty() {
            anyhow::bail!(
                "Failed to determine repo owner/name; is `gh repo view` working?"
            );
        }
        let pair = (owner, repo);
        *guard = Some(pair.clone());
        Ok(pair)
    }

    pub fn invalidate_owner(&self) {
        if let Ok(mut guard) = self.owner.lock() {
            *guard = None;
        }
    }

    pub fn is_installed() -> bool {
        Command::new("gh")
            .args(["--version"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    pub fn is_authenticated() -> bool {
        let mut cmd = Command::new("gh");
        cmd.args(["auth", "status"]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        cmd.output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}
