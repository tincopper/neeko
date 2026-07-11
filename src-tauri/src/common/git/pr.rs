use crate::project::types::{PRInfo, PRListItem, PRMergeResult, PRFileChange, PRCommit, PRComment, CommentReaction, PrLabel};
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

/// 检测 gh CLI 是否已登录 GitHub
pub fn is_gh_authenticated() -> bool {
    cache::get_cached_gh_authenticated(|| {
        no_window_cmd("gh")
            .args(["auth", "status"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    })
}

/// 获取 PR 列表（参考 Muxy gh pr list）
pub fn list_prs(repo_path: &Path, state: &str, limit: usize) -> Result<Vec<PRListItem>> {
    let s = state.to_string();
    cache::get_cached_pr_list(repo_path, &s, limit, || {
        let json_fields = "number,title,state,author,headRefName,baseRefName,createdAt,isCrossRepository,headRepositoryOwner,labels,comments";
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
        log::info!("[list_prs] Raw output: {}", &stdout[..stdout.len().min(500)]);
        let mut result: Vec<PRListItem> = serde_json::from_str(&stdout).context("Failed to parse gh pr list output")?;
        // Compute comment_count from the comments array
        for item in &mut result {
            item.comment_count = item.comments.len() as u64;
        }
        if let Some(first) = result.first() {
            log::info!("[list_prs] First PR created_at: {:?}", first.created_at);
        }
        Ok(result)
    })
}

/// 获取仓库所有 labels（通过 gh label list）
pub fn list_repo_labels(repo_path: &Path) -> Result<Vec<PrLabel>> {
    cache::get_cached_repo_labels(repo_path, || {
        let output = no_window_cmd("gh")
            .args(["label", "list", "--json", "name,color", "--limit", "200"])
            .current_dir(repo_path)
            .output()
            .context("Failed to run gh label list")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("gh label list failed: {}", stderr.trim());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let labels: Vec<PrLabel> =
            serde_json::from_str(&stdout).context("Failed to parse gh label list output")?;
        Ok(labels)
    })
}

/// 获取仓库所有 PR 作者（通过 gh pr list --state all --limit 1000 提取去重）
pub fn list_repo_authors(repo_path: &Path) -> Result<Vec<String>> {
    cache::get_cached_repo_authors(repo_path, || {
        let output = no_window_cmd("gh")
            .args(["pr", "list", "--state", "all", "--limit", "1000", "--json", "author"])
            .current_dir(repo_path)
            .output()
            .context("Failed to run gh pr list for authors")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("gh pr list failed: {}", stderr.trim());
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let items: Vec<serde_json::Value> =
            serde_json::from_str(&stdout).context("Failed to parse gh pr list output")?;

        let mut authors: Vec<String> = items
            .iter()
            .filter_map(|v| {
                v.get("author").and_then(|a| {
                    if let Some(s) = a.as_str() {
                        Some(s.to_string())
                    } else if let Some(obj) = a.as_object() {
                        obj.get("login").and_then(|l| l.as_str()).map(String::from)
                    } else {
                        None
                    }
                })
            })
            .collect();
        authors.sort();
        authors.dedup();
        Ok(authors)
    })
}

/// 获取单个 PR 详情
pub fn view_pr(repo_path: &Path, pr_number: u64) -> Result<PRInfo> {
    cache::get_cached_pr_info(repo_path, pr_number, || {
        let json_fields = "number,title,state,body,author,headRefName,baseRefName,url,createdAt,mergeable,mergeStateStatus,isDraft,isCrossRepository,statusCheckRollup,mergeCommit";
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

/// 获取 PR 变更文件列表
pub fn list_pr_files(repo_path: &Path, pr_number: u64) -> Result<Vec<PRFileChange>> {
    let output = no_window_cmd("gh")
        .args([
            "pr",
            "view",
            &pr_number.to_string(),
            "--json",
            "files",
        ])
        .current_dir(repo_path)
        .output()
        .context("Failed to run gh pr view")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("gh pr view failed: {}", stderr.trim());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let value: serde_json::Value = serde_json::from_str(&stdout)
        .context("Failed to parse gh pr view output")?;

    let files = value
        .get("files")
        .and_then(|f| f.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|f| {
                    let path = f.get("path")?.as_str()?.to_string();
                    let additions = f.get("additions").and_then(|v| v.as_u64()).unwrap_or(0);
                    let deletions = f.get("deletions").and_then(|v| v.as_u64()).unwrap_or(0);
                    let change_type = f.get("changeType")
                        .and_then(|v| v.as_str())
                        .unwrap_or("MODIFIED");
                    let status = match change_type {
                        "ADDED" => "added",
                        "REMOVED" => "removed",
                        "RENAMED" => "renamed",
                        _ => "modified",
                    };
                    Some(PRFileChange {
                        path,
                        status: status.to_string(),
                        additions,
                        deletions,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(files)
}

/// 获取 PR 提交列表
pub fn list_pr_commits(repo_path: &Path, pr_number: u64) -> Result<Vec<PRCommit>> {
    let output = no_window_cmd("gh")
        .args([
            "pr",
            "view",
            &pr_number.to_string(),
            "--json",
            "commits",
        ])
        .current_dir(repo_path)
        .output()
        .context("Failed to run gh pr view")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("gh pr view failed: {}", stderr.trim());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let value: serde_json::Value = serde_json::from_str(&stdout)
        .context("Failed to parse gh pr view output")?;

    let commits = value
        .get("commits")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|c| {
                    let oid = c.get("oid")?.as_str()?.to_string();
                    let short_hash = oid.chars().take(7).collect::<String>();
                    let message_headline = c.get("messageHeadline")
                        .and_then(|m| m.as_str())
                        .unwrap_or("")
                        .to_string();
                    // authors is an array, get first author's login
                    let author_login = c.get("authors")
                        .and_then(|a| a.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|a| a.get("login"))
                        .and_then(|l| l.as_str())
                        .unwrap_or("")
                        .to_string();
                    let authored_date = c.get("authoredDate")
                        .and_then(|d| d.as_str())
                        .unwrap_or("")
                        .to_string();
                    Some(PRCommit {
                        hash: oid,
                        short_hash,
                        message: message_headline,
                        author: author_login,
                        timestamp: authored_date,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(commits)
}

// ─── PR Comments ────────────────────────────────────────────────────────────

/// 获取 PR 评论列表（合并 issue comments + PR reviews）
pub fn list_pr_comments(repo_path: &Path, pr_number: u64) -> Result<Vec<PRComment>> {
    log::info!("[list_pr_comments] Loading comments for PR #{} at {:?}", pr_number, repo_path);

    // First get the repo info to construct the API URL
    let repo_output = no_window_cmd("gh")
        .args(["repo", "view", "--json", "owner,name"])
        .current_dir(repo_path)
        .output()
        .context("Failed to get repo info")?;

    if !repo_output.status.success() {
        let stderr = String::from_utf8_lossy(&repo_output.stderr);
        log::error!("[list_pr_comments] Failed to get repo info: {}", stderr.trim());
        anyhow::bail!("Failed to get repo info");
    }

    let repo_info: serde_json::Value = serde_json::from_str(
        &String::from_utf8_lossy(&repo_output.stdout)
    ).context("Failed to parse repo info")?;

    let owner = repo_info.get("owner")
        .and_then(|o| o.get("login"))
        .and_then(|l| l.as_str())
        .unwrap_or("");
    let repo = repo_info.get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("");

    if owner.is_empty() || repo.is_empty() {
        anyhow::bail!("Failed to get owner or repo name");
    }

    log::info!("[list_pr_comments] Repo: {}/{}", owner, repo);

    // 1. Fetch issue comments
    let issue_comments = fetch_issue_comments(owner, repo, pr_number, repo_path)?;
    let issue_count = issue_comments.len();

    // 2. Fetch PR reviews and convert to comment format
    let review_comments = fetch_pr_reviews(owner, repo, pr_number, repo_path)?;
    let review_count = review_comments.len();

    // 3. Merge and sort by created_at
    let mut all_comments: Vec<PRComment> = issue_comments.into_iter().chain(review_comments).collect();
    all_comments.sort_by(|a, b| a.created_at.cmp(&b.created_at));

    log::info!("[list_pr_comments] Merged {} comments ({} issue + {} reviews)",
        all_comments.len(), issue_count, review_count);

    Ok(all_comments)
}

/// 拉取 issue comments（普通讨论评论）
fn fetch_issue_comments(owner: &str, repo: &str, pr_number: u64, repo_path: &Path) -> Result<Vec<PRComment>> {
    let output = no_window_cmd("gh")
        .args(["api", &format!("repos/{}/{}/issues/{}/comments", owner, repo, pr_number)])
        .current_dir(repo_path)
        .output()
        .context("Failed to list PR comments")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("gh api failed: {}", stderr.trim());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let values: Vec<serde_json::Value> = serde_json::from_str(&stdout)
        .context("Failed to parse PR comments response")?;

    Ok(values.iter().filter_map(|v| {
        let id = v.get("id")?.as_u64()?.to_string();
        let author = v.get("user")?.get("login")?.as_str()?.to_string();
        let author_avatar = v.get("user")?.get("avatar_url")?.as_str().map(|s| s.to_string());
        let body = v.get("body")?.as_str()?.to_string();
        let created_at = v.get("created_at")?.as_str()?.to_string();
        let updated_at = v.get("updated_at")?.as_str().map(|s| s.to_string());

        Some(PRComment {
            id,
            author,
            author_avatar,
            body,
            created_at,
            updated_at,
            reactions: None,
        })
    }).collect())
}

/// 拉取 PR reviews（审查摘要，转换为 PRComment 格式）
fn fetch_pr_reviews(owner: &str, repo: &str, pr_number: u64, repo_path: &Path) -> Result<Vec<PRComment>> {
    let output = no_window_cmd("gh")
        .args(["api", &format!("repos/{}/{}/pulls/{}/reviews", owner, repo, pr_number)])
        .current_dir(repo_path)
        .output()
        .context("Failed to list PR reviews")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::warn!("[list_pr_comments] Failed to fetch PR reviews: {}", stderr.trim());
        return Ok(vec![]); // reviews are optional — non-blocking
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let values: Vec<serde_json::Value> = match serde_json::from_str(&stdout) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("[list_pr_comments] Failed to parse PR reviews: {}", e);
            return Ok(vec![]);
        }
    };

    let state_label = |state: &str| -> &'static str {
        match state {
            "APPROVED" => "✅ Approved",
            "CHANGES_REQUESTED" => "🔴 Changes requested",
            "COMMENTED" => "💬 Reviewed",
            _ => "📝 Reviewed",
        }
    };

    Ok(values.iter().filter_map(|v| {
        let id = v.get("id")?.as_u64()?.to_string();
        let author = v.get("user")?.get("login")?.as_str()?.to_string();
        let author_avatar = v.get("user")?.get("avatar_url")?.as_str().map(|s| s.to_string());
        let body = v.get("body")?.as_str().unwrap_or("").to_string();
        let state = v.get("state")?.as_str().unwrap_or("").to_string();
        let submitted_at = v.get("submitted_at")?.as_str()?.to_string();

        // Prefix body with review state for visibility
        let display_body = if body.is_empty() {
            format!("{}", state_label(&state))
        } else {
            format!("{}:\n\n{}", state_label(&state), body)
        };

        Some(PRComment {
            id,
            author,
            author_avatar,
            body: display_body,
            created_at: submitted_at.clone(),
            updated_at: Some(submitted_at),
            reactions: None,
        })
    }).collect())
}

/// 添加 PR 评论
pub fn add_pr_comment(repo_path: &Path, pr_number: u64, body: &str) -> Result<PRComment> {
    log::info!("[add_pr_comment] Adding comment to PR #{}", pr_number);
    log::info!("[add_pr_comment] Body: {}", body);

    // First get the repo info to construct the API URL
    let repo_output = no_window_cmd("gh")
        .args(["repo", "view", "--json", "owner,name"])
        .current_dir(repo_path)
        .output()
        .context("Failed to get repo info")?;

    if !repo_output.status.success() {
        let stderr = String::from_utf8_lossy(&repo_output.stderr);
        log::error!("[add_pr_comment] Failed to get repo info: {}", stderr.trim());
        anyhow::bail!("Failed to get repo info");
    }

    let repo_info: serde_json::Value = serde_json::from_str(
        &String::from_utf8_lossy(&repo_output.stdout)
    ).context("Failed to parse repo info")?;

    let owner = repo_info.get("owner")
        .and_then(|o| o.get("login"))
        .and_then(|l| l.as_str())
        .unwrap_or("");
    let repo = repo_info.get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("");

    if owner.is_empty() || repo.is_empty() {
        anyhow::bail!("Failed to get owner or repo name");
    }

    log::info!("[add_pr_comment] Repo: {}/{}", owner, repo);

    let output = no_window_cmd("gh")
        .args([
            "api",
            &format!("repos/{}/{}/issues/{}/comments", owner, repo, pr_number),
            "--method",
            "POST",
            "--raw-field",
            &format!("body={}", body),
        ])
        .current_dir(repo_path)
        .output()
        .context("Failed to add PR comment")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::error!("[add_pr_comment] gh api failed: {}", stderr.trim());
        anyhow::bail!("gh api failed: {}", stderr.trim());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    log::info!("[add_pr_comment] Response: {}", &stdout[..stdout.len().min(500)]);

    let v: serde_json::Value = serde_json::from_str(&stdout)
        .context("Failed to parse PR comment response")?;

    let id = v.get("id").and_then(|i| i.as_u64()).map(|i| i.to_string()).unwrap_or_default();
    let author = v.get("user")
        .and_then(|u| u.get("login"))
        .and_then(|l| l.as_str())
        .unwrap_or("unknown")
        .to_string();
    let author_avatar = v.get("user")
        .and_then(|u| u.get("avatar_url"))
        .and_then(|a| a.as_str())
        .map(|s| s.to_string());
    let comment_body = v.get("body")
        .and_then(|b| b.as_str())
        .unwrap_or("")
        .to_string();
    let created_at = v.get("created_at")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();
    let updated_at = v.get("updated_at")
        .and_then(|u| u.as_str())
        .map(|s| s.to_string());

    log::info!("[add_pr_comment] Comment added successfully: id={}", id);

    Ok(PRComment {
        id,
        author,
        author_avatar,
        body: comment_body,
        created_at,
        updated_at,
        reactions: None,
    })
}

/// 编辑 PR 评论
pub fn edit_pr_comment(
    repo_path: &Path,
    _pr_number: u64,
    comment_id: &str,
    body: &str,
) -> Result<PRComment> {
    // First get the repo info to construct the API URL
    let repo_output = no_window_cmd("gh")
        .args(["repo", "view", "--json", "owner,name"])
        .current_dir(repo_path)
        .output()
        .context("Failed to get repo info")?;

    if !repo_output.status.success() {
        anyhow::bail!("Failed to get repo info");
    }

    let repo_info: serde_json::Value = serde_json::from_str(
        &String::from_utf8_lossy(&repo_output.stdout)
    ).context("Failed to parse repo info")?;

    let owner = repo_info.get("owner")
        .and_then(|o| o.get("login"))
        .and_then(|l| l.as_str())
        .unwrap_or("");
    let repo = repo_info.get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("");

    if owner.is_empty() || repo.is_empty() {
        anyhow::bail!("Failed to get owner or repo name");
    }

    let output = no_window_cmd("gh")
        .args([
            "api",
            &format!("repos/{}/{}/issues/comments/{}", owner, repo, comment_id),
            "--method",
            "PATCH",
            "--raw-field",
            &format!("body={}", body),
        ])
        .current_dir(repo_path)
        .output()
        .context("Failed to edit PR comment")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("gh api failed: {}", stderr.trim());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let v: serde_json::Value = serde_json::from_str(&stdout)
        .context("Failed to parse PR comment response")?;

    let id = v.get("id").and_then(|i| i.as_u64()).map(|i| i.to_string()).unwrap_or_default();
    let author = v.get("user")
        .and_then(|u| u.get("login"))
        .and_then(|l| l.as_str())
        .unwrap_or("unknown")
        .to_string();
    let author_avatar = v.get("user")
        .and_then(|u| u.get("avatar_url"))
        .and_then(|a| a.as_str())
        .map(|s| s.to_string());
    let comment_body = v.get("body")
        .and_then(|b| b.as_str())
        .unwrap_or("")
        .to_string();
    let created_at = v.get("created_at")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();
    let updated_at = v.get("updated_at")
        .and_then(|u| u.as_str())
        .map(|s| s.to_string());

    Ok(PRComment {
        id,
        author,
        author_avatar,
        body: comment_body,
        created_at,
        updated_at,
        reactions: None,
    })
}

/// 删除 PR 评论
pub fn delete_pr_comment(repo_path: &Path, _pr_number: u64, comment_id: &str) -> Result<()> {
    // First get the repo info to construct the API URL
    let repo_output = no_window_cmd("gh")
        .args(["repo", "view", "--json", "owner,name"])
        .current_dir(repo_path)
        .output()
        .context("Failed to get repo info")?;

    if !repo_output.status.success() {
        anyhow::bail!("Failed to get repo info");
    }

    let repo_info: serde_json::Value = serde_json::from_str(
        &String::from_utf8_lossy(&repo_output.stdout)
    ).context("Failed to parse repo info")?;

    let owner = repo_info.get("owner")
        .and_then(|o| o.get("login"))
        .and_then(|l| l.as_str())
        .unwrap_or("");
    let repo = repo_info.get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("");

    if owner.is_empty() || repo.is_empty() {
        anyhow::bail!("Failed to get owner or repo name");
    }

    let output = no_window_cmd("gh")
        .args([
            "api",
            &format!("repos/{}/{}/issues/comments/{}", owner, repo, comment_id),
            "--method",
            "DELETE",
        ])
        .current_dir(repo_path)
        .output()
        .context("Failed to delete PR comment")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("gh api failed: {}", stderr.trim());
    }

    Ok(())
}

/// 添加评论反应
pub fn add_comment_reaction(
    repo_path: &Path,
    _pr_number: u64,
    comment_id: &str,
    emoji: &str,
) -> Result<()> {
    // First get the repo info to construct the API URL
    let repo_output = no_window_cmd("gh")
        .args(["repo", "view", "--json", "owner,name"])
        .current_dir(repo_path)
        .output()
        .context("Failed to get repo info")?;

    if !repo_output.status.success() {
        anyhow::bail!("Failed to get repo info");
    }

    let repo_info: serde_json::Value = serde_json::from_str(
        &String::from_utf8_lossy(&repo_output.stdout)
    ).context("Failed to parse repo info")?;

    let owner = repo_info.get("owner")
        .and_then(|o| o.get("login"))
        .and_then(|l| l.as_str())
        .unwrap_or("");
    let repo = repo_info.get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("");

    if owner.is_empty() || repo.is_empty() {
        anyhow::bail!("Failed to get owner or repo name");
    }

    let output = no_window_cmd("gh")
        .args([
            "api",
            &format!("repos/{}/{}/issues/comments/{}/reactions", owner, repo, comment_id),
            "--method",
            "POST",
            "--field",
            &format!("content={}", emoji),
        ])
        .current_dir(repo_path)
        .output()
        .context("Failed to add comment reaction")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("gh api failed: {}", stderr.trim());
    }

    Ok(())
}
