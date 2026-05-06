use crate::models::{PRInfo, PRListItem, PRMergeResult};
use anyhow::{Context, Result};
use std::path::Path;
use std::process::Command;

use super::cache;
use super::invalidate_repo_caches;

fn no_window_cmd(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

/// 检测 gh CLI 是否安装
pub fn is_gh_installed() -> bool {
    cache::get_cached_gh_installed(|| {
        no_window_cmd("gh")
            .args(["--version"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    })
}

/// 获取 PR 列表（参考 Muxy gh pr list）
pub fn list_prs(repo_path: &Path, state: &str, limit: usize) -> Result<Vec<PRListItem>> {
    let s = state.to_string();
    cache::get_cached_pr_list(repo_path, &s, limit, || {
        let json_fields = "number,title,state,author,headRefName,baseRefName,createdAt,isCrossRepository,headRepositoryOwner";
        let output = no_window_cmd("gh")
            .args([
                "pr",
                "list",
                "--json",
                json_fields,
                "--state",
                &s,
                "--limit",
                &limit.to_string(),
            ])
            .current_dir(repo_path)
            .output()
            .context("Failed to run gh pr list")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("gh pr list failed: {}", stderr.trim());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str(&stdout).context("Failed to parse gh pr list output")
    })
}

/// 获取单个 PR 详情
pub fn view_pr(repo_path: &Path, pr_number: u64) -> Result<PRInfo> {
    cache::get_cached_pr_info(repo_path, pr_number, || {
        let json_fields = "number,title,state,body,author,headRefName,baseRefName,url,createdAt,mergeable,mergeStateStatus,isDraft,isCrossRepository,statusCheckRollup";
        let output = no_window_cmd("gh")
            .args(["pr", "view", &pr_number.to_string(), "--json", json_fields])
            .current_dir(repo_path)
            .output()
            .context("Failed to run gh pr view")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("gh pr view failed: {}", stderr.trim());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str(&stdout).context("Failed to parse gh pr view output")
    })
}

/// 创建 PR
pub fn create_pr(
    repo_path: &Path,
    title: &str,
    body: &str,
    base: Option<&str>,
    draft: bool,
) -> Result<u64> {
    let mut args = vec!["pr", "create", "--title", title];

    if !body.is_empty() {
        args.push("--body");
        args.push(body);
    }
    if let Some(b) = base {
        args.push("--base");
        args.push(b);
    }
    if draft {
        args.push("--draft");
    }

    let output = no_window_cmd("gh")
        .args(&args)
        .current_dir(repo_path)
        .output()
        .context("Failed to run gh pr create")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("gh pr create failed: {}", stderr.trim());
    }

    // 从输出中提取 PR 编号
    let stdout = String::from_utf8_lossy(&output.stdout);
    // gh pr create 输出通常是 URL，如 https://github.com/owner/repo/pull/42
    let number = stdout
        .trim()
        .rsplit('/')
        .next()
        .and_then(|s| s.parse::<u64>().ok())
        .context("Failed to parse PR number from output")?;

    Ok(number)
}

/// 合并 PR（参考 Muxy 支持三种方式）
pub fn merge_pr(repo_path: &Path, pr_number: u64, method: &str) -> Result<PRMergeResult> {
    let valid_methods = ["merge", "squash", "rebase"];
    if !valid_methods.contains(&method) {
        anyhow::bail!(
            "Invalid merge method '{}'. Use: merge, squash, or rebase",
            method
        );
    }

    let output = no_window_cmd("gh")
        .args([
            "pr",
            "merge",
            &pr_number.to_string(),
            "--delete-branch",
            &format!("--{}", method),
        ])
        .current_dir(repo_path)
        .output()
        .context("Failed to run gh pr merge")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("gh pr merge failed: {}", stderr.trim());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    invalidate_repo_caches(repo_path);
    Ok(PRMergeResult {
        success: true,
        message: stdout.trim().to_string(),
    })
}

/// 关闭 PR
pub fn close_pr(repo_path: &Path, pr_number: u64) -> Result<()> {
    let output = no_window_cmd("gh")
        .args(["pr", "close", &pr_number.to_string()])
        .current_dir(repo_path)
        .output()
        .context("Failed to run gh pr close")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("gh pr close failed: {}", stderr.trim());
    }
    invalidate_repo_caches(repo_path);
    Ok(())
}

/// Checkout PR
pub fn checkout_pr(repo_path: &Path, pr_number: u64) -> Result<()> {
    let output = no_window_cmd("gh")
        .args(["pr", "checkout", &pr_number.to_string()])
        .current_dir(repo_path)
        .output()
        .context("Failed to run gh pr checkout")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("gh pr checkout failed: {}", stderr.trim());
    }
    invalidate_repo_caches(repo_path);
    Ok(())
}
