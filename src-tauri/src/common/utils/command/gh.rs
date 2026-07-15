use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use anyhow::{Context, Result};
use serde::de::DeserializeOwned;

use crate::common::executor::factory::ExecTarget;
use crate::common::executor::sync::exec_on;

pub struct GhCli {
    repo_path: PathBuf,
    target: ExecTarget,
    owner: Mutex<Option<(String, String)>>,
}

impl GhCli {
    pub fn new(repo_path: &Path, target: &ExecTarget) -> Self {
        Self {
            repo_path: repo_path.to_path_buf(),
            target: target.clone(),
            owner: Mutex::new(None),
        }
    }

    pub async fn run(&self, args: &[&str]) -> Result<String> {
        let repo_path = self.repo_path.to_string_lossy().to_string();
        let mut full_args: Vec<&str> = vec!["-C", &repo_path];
        full_args.extend_from_slice(args);
        exec_on(&self.target, "gh", &full_args)
            .await
            .map_err(|e| anyhow::anyhow!("{}", e))
    }

    pub async fn run_json<T: DeserializeOwned>(&self, args: &[&str]) -> Result<T> {
        let stdout = self.run(args).await?;
        serde_json::from_str(&stdout).with_context(|| {
            format!(
                "Failed to parse gh output as JSON: {}",
                &stdout[..stdout.len().min(200)]
            )
        })
    }

    pub async fn api_run(&self, path: &str, extra_args: &[&str]) -> Result<String> {
        let (owner, repo) = self.repo_owner_name().await?;
        let api_path = format!("repos/{}/{}/{}", owner, repo, path);
        let mut args = vec!["api", &api_path];
        args.extend_from_slice(extra_args);
        self.run(&args).await
    }

    pub async fn api_json<T: DeserializeOwned>(
        &self,
        path: &str,
        extra_args: &[&str],
    ) -> Result<T> {
        let stdout = self.api_run(path, extra_args).await?;
        serde_json::from_str(&stdout).with_context(|| "Failed to parse gh api output as JSON")
    }

    pub async fn repo_owner_name(&self) -> Result<(String, String)> {
        // Check cache without holding lock across await
        {
            let guard = self.owner.lock().unwrap();
            if let Some(ref pair) = *guard {
                return Ok(pair.clone());
            }
        }
        let stdout = self.run(&["repo", "view", "--json", "owner,name"]).await?;
        let v: serde_json::Value =
            serde_json::from_str(&stdout).context("Failed to parse gh repo view output")?;
        let owner = v["owner"]["login"].as_str().unwrap_or("").to_string();
        let repo = v["name"].as_str().unwrap_or("").to_string();
        if owner.is_empty() || repo.is_empty() {
            anyhow::bail!("Failed to determine repo owner/name; is `gh repo view` working?");
        }
        let pair = (owner, repo);
        if let Ok(mut guard) = self.owner.lock() {
            *guard = Some(pair.clone());
        }
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
        cmd.output().map(|o| o.status.success()).unwrap_or(false)
    }
}
