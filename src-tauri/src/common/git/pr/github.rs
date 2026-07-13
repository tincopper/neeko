use std::path::Path;

use anyhow::{Context, Result};

use crate::common::git::pr::PrProvider;
use crate::common::utils::command::gh::GhCli;
use crate::project::types::{
    PRComment, PRCommit, PRFileChange, PRInfo, PRListItem, PRMergeResult, PRReviewComment, PrLabel,
};

// ─── JSON Response Parsing Helpers ───────────────────────────────────────

fn parse_issue_comment(v: &serde_json::Value) -> Option<PRComment> {
    let id = v.get("id")?.as_u64()?.to_string();
    let author = v.get("user")?.get("login")?.as_str()?.to_string();
    let author_avatar = v
        .get("user")?
        .get("avatar_url")?
        .as_str()
        .map(String::from);
    let body = v.get("body")?.as_str()?.to_string();
    let created_at = v.get("created_at")?.as_str()?.to_string();
    let updated_at = v.get("updated_at")?.as_str().map(String::from);
    Some(PRComment {
        id,
        author,
        author_avatar,
        body,
        created_at,
        updated_at,
        reactions: None,
    })
}

fn state_label(state: &str) -> &'static str {
    match state {
        "APPROVED" => "✅ Approved",
        "CHANGES_REQUESTED" => "🔴 Changes requested",
        "COMMENTED" => "💬 Reviewed",
        _ => "📝 Reviewed",
    }
}

fn parse_review_to_comment(v: &serde_json::Value) -> Option<PRComment> {
    let id = v.get("id")?.as_u64()?.to_string();
    let author = v.get("user")?.get("login")?.as_str()?.to_string();
    let author_avatar = v
        .get("user")?
        .get("avatar_url")?
        .as_str()
        .map(String::from);
    let body = v.get("body")?.as_str().unwrap_or("").to_string();
    let state = v.get("state")?.as_str().unwrap_or("").to_string();
    let submitted_at = v.get("submitted_at")?.as_str()?.to_string();
    let display_body = if body.is_empty() {
        state_label(&state).to_string()
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
}

fn parse_comment_response(stdout: &str) -> Result<PRComment> {
    let v: serde_json::Value =
        serde_json::from_str(stdout).context("Failed to parse PR comment response")?;
    Ok(PRComment {
        id: v
            .get("id")
            .and_then(|i| i.as_u64())
            .map(|i| i.to_string())
            .unwrap_or_default(),
        author: v
            .get("user")
            .and_then(|u| u.get("login"))
            .and_then(|l| l.as_str())
            .unwrap_or("unknown")
            .to_string(),
        author_avatar: v
            .get("user")
            .and_then(|u| u.get("avatar_url"))
            .and_then(|a| a.as_str())
            .map(String::from),
        body: v
            .get("body")
            .and_then(|b| b.as_str())
            .unwrap_or("")
            .to_string(),
        created_at: v
            .get("created_at")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string(),
        updated_at: v
            .get("updated_at")
            .and_then(|u| u.as_str())
            .map(String::from),
        reactions: None,
    })
}

fn parse_review_comment_response(stdout: &str) -> Result<PRReviewComment> {
    let v: serde_json::Value =
        serde_json::from_str(stdout).context("Failed to parse PR review comment response")?;
    Ok(PRReviewComment {
        id: v
            .get("id")
            .and_then(|i| i.as_u64())
            .map(|i| i.to_string())
            .unwrap_or_default(),
        author: v
            .get("user")
            .and_then(|u| u.get("login"))
            .and_then(|l| l.as_str())
            .unwrap_or("unknown")
            .to_string(),
        author_avatar: v
            .get("user")
            .and_then(|u| u.get("avatar_url"))
            .and_then(|a| a.as_str())
            .map(String::from),
        body: v
            .get("body")
            .and_then(|b| b.as_str())
            .unwrap_or("")
            .to_string(),
        path: v
            .get("path")
            .and_then(|p| p.as_str())
            .unwrap_or("")
            .to_string(),
        line: v.get("line").and_then(|l| l.as_u64()).unwrap_or(0),
        side: v
            .get("side")
            .and_then(|s| s.as_str())
            .unwrap_or("RIGHT")
            .to_string(),
        commit_id: v
            .get("commit_id")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string(),
        created_at: v
            .get("created_at")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string(),
        updated_at: v
            .get("updated_at")
            .and_then(|u| u.as_str())
            .map(String::from),
    })
}

fn parse_review_comments_response(stdout: &str) -> Vec<PRReviewComment> {
    let values: Vec<serde_json::Value> = match serde_json::from_str(stdout) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("[list_pr_review_comments] Failed to parse: {}", e);
            return vec![];
        }
    };
    values
        .into_iter()
        .filter_map(|v| {
            let id = v.get("id")?.as_u64()?.to_string();
            let author = v.get("user")?.get("login")?.as_str()?.to_string();
            let author_avatar = v
                .get("user")?
                .get("avatar_url")?
                .as_str()
                .map(String::from);
            let body = v.get("body")?.as_str()?.to_string();
            let path = v.get("path")?.as_str()?.to_string();
            let line = v.get("line")?.as_u64()?;
            let side = v.get("side")?.as_str().unwrap_or("RIGHT").to_string();
            let commit_id = v.get("commit_id")?.as_str()?.to_string();
            let created_at = v.get("created_at")?.as_str()?.to_string();
            let updated_at = v.get("updated_at")?.as_str().map(String::from);
            Some(PRReviewComment {
                id,
                author,
                author_avatar,
                body,
                path,
                line,
                side,
                commit_id,
                created_at,
                updated_at,
            })
        })
        .collect()
}

// ─── Trait Implementation ────────────────────────────────────────────────

pub struct GitHubPrProvider;

impl PrProvider for GitHubPrProvider {
    fn name(&self) -> &'static str {
        "GitHub"
    }

    fn is_installed(&self) -> bool {
        GhCli::is_installed()
    }

    fn is_authenticated(&self) -> bool {
        GhCli::is_authenticated()
    }

    fn list_prs(
        &self,
        repo_path: &Path,
        state: &str,
        limit: usize,
    ) -> Result<Vec<PRListItem>> {
        let cli = GhCli::new(repo_path);
        let mut result: Vec<PRListItem> = cli.run_json(|cmd| {
            cmd.args([
                "pr",
                "list",
                "--json",
                "number,title,state,author,headRefName,baseRefName,createdAt,isCrossRepository,headRepositoryOwner,labels,comments,assignees",
                "--state",
                state,
                "--limit",
                &limit.to_string(),
            ]);
        })?;
        for item in &mut result {
            item.comment_count = item.comments.len() as u64;
        }
        Ok(result)
    }

    fn list_repo_labels(&self, repo_path: &Path) -> Result<Vec<PrLabel>> {
        let cli = GhCli::new(repo_path);
        cli.run_json(|cmd| {
            cmd.args(["label", "list", "--json", "name,color", "--limit", "200"]);
        })
    }

    fn list_repo_authors(&self, repo_path: &Path) -> Result<Vec<String>> {
        let cli = GhCli::new(repo_path);
        let items: Vec<serde_json::Value> = cli.run_json(|cmd| {
            cmd.args([
                "pr",
                "list",
                "--state",
                "all",
                "--limit",
                "1000",
                "--json",
                "author",
            ]);
        })?;
        let mut authors: Vec<String> = items
            .iter()
            .filter_map(|v| {
                v.get("author").and_then(|a| {
                    if let Some(s) = a.as_str() {
                        Some(s.to_string())
                    } else if let Some(obj) = a.as_object() {
                        obj.get("login")
                            .and_then(|l| l.as_str())
                            .map(String::from)
                    } else {
                        None
                    }
                })
            })
            .collect();
        authors.sort();
        authors.dedup();
        Ok(authors)
    }

    fn view_pr(&self, repo_path: &Path, pr_number: u64) -> Result<PRInfo> {
        let cli = GhCli::new(repo_path);
        let mut info: PRInfo = cli.run_json(|cmd| {
            cmd.args([
                "pr",
                "view",
                &pr_number.to_string(),
                "--json",
                "number,title,state,body,author,headRefName,baseRefName,url,createdAt,mergeable,mergeStateStatus,isDraft,isCrossRepository,statusCheckRollup,mergeCommit,mergedBy,mergedAt,closedAt",
            ]);
        })?;
        if info.closed_by.is_none() {
            info.closed_by = fetch_pr_closed_by(repo_path, pr_number).ok().flatten();
        }
        Ok(info)
    }

    fn create_pr(
        &self,
        repo_path: &Path,
        title: &str,
        body: &str,
        base: Option<&str>,
        draft: bool,
    ) -> Result<u64> {
        let cli = GhCli::new(repo_path);
        let stdout = cli.run(|cmd| {
            cmd.arg("pr").arg("create").arg("--title").arg(title);
            if !body.is_empty() {
                cmd.args(["--body", body]);
            }
            if let Some(b) = base {
                cmd.args(["--base", b]);
            }
            if draft {
                cmd.arg("--draft");
            }
        })?;
        stdout
            .rsplit('/')
            .next()
            .and_then(|s| s.parse::<u64>().ok())
            .context("Failed to parse PR number from gh pr create output")
    }

    fn merge_pr(
        &self,
        repo_path: &Path,
        pr_number: u64,
        method: &str,
    ) -> Result<PRMergeResult> {
        if !["merge", "squash", "rebase"].contains(&method) {
            anyhow::bail!(
                "Invalid merge method '{}'. Use: merge, squash, or rebase",
                method
            );
        }
        let cli = GhCli::new(repo_path);
        let stdout = cli.run(|cmd| {
            cmd.args([
                "pr",
                "merge",
                &pr_number.to_string(),
                "--delete-branch",
                &format!("--{}", method),
            ]);
        })?;
        Ok(PRMergeResult {
            success: true,
            message: stdout,
        })
    }

    fn close_pr(&self, repo_path: &Path, pr_number: u64) -> Result<()> {
        let cli = GhCli::new(repo_path);
        cli.run(|cmd| {
            cmd.args(["pr", "close", &pr_number.to_string()]);
        })?;
        Ok(())
    }

    fn list_pr_files(&self, repo_path: &Path, pr_number: u64) -> Result<Vec<PRFileChange>> {
        let cli = GhCli::new(repo_path);
        let value: serde_json::Value = cli.run_json(|cmd| {
            cmd.args(["pr", "view", &pr_number.to_string(), "--json", "files"]);
        })?;
        let files = value
            .get("files")
            .and_then(|f| f.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|f| {
                        let path = f.get("path")?.as_str()?.to_string();
                        let additions =
                            f.get("additions").and_then(|v| v.as_u64()).unwrap_or(0);
                        let deletions =
                            f.get("deletions").and_then(|v| v.as_u64()).unwrap_or(0);
                        let change_type = f
                            .get("changeType")
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

    fn list_pr_commits(&self, repo_path: &Path, pr_number: u64) -> Result<Vec<PRCommit>> {
        let cli = GhCli::new(repo_path);
        let value: serde_json::Value = cli.run_json(|cmd| {
            cmd.args(["pr", "view", &pr_number.to_string(), "--json", "commits"]);
        })?;
        let commits = value
            .get("commits")
            .and_then(|c| c.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|c| {
                        let oid = c.get("oid")?.as_str()?.to_string();
                        let short_hash = oid.chars().take(7).collect();
                        let message_headline = c
                            .get("messageHeadline")
                            .and_then(|m| m.as_str())
                            .unwrap_or("")
                            .to_string();
                        let author_login = c
                            .get("authors")
                            .and_then(|a| a.as_array())
                            .and_then(|arr| arr.first())
                            .and_then(|a| a.get("login"))
                            .and_then(|l| l.as_str())
                            .unwrap_or("")
                            .to_string();
                        let authored_date = c
                            .get("authoredDate")
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

    fn list_pr_comments(&self, repo_path: &Path, pr_number: u64) -> Result<Vec<PRComment>> {
        let cli = GhCli::new(repo_path);
        log::info!("[list_pr_comments] Loading comments for PR #{}", pr_number);

        let issue_comments: Vec<serde_json::Value> = cli
            .api_json(&format!("issues/{}/comments", pr_number), |_| {})?;
        let issue_count = issue_comments.len();
        let issue_comments: Vec<PRComment> =
            issue_comments.iter().filter_map(parse_issue_comment).collect();

        let reviews: Vec<serde_json::Value> = cli
            .api_json(&format!("pulls/{}/reviews", pr_number), |_| {})
            .unwrap_or_default();
        let review_count = reviews.len();
        let review_comments: Vec<PRComment> =
            reviews.iter().filter_map(parse_review_to_comment).collect();

        let mut all: Vec<PRComment> = issue_comments.into_iter().chain(review_comments).collect();
        all.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        log::info!(
            "[list_pr_comments] Merged {} comments ({} issue + {} reviews)",
            all.len(),
            issue_count,
            review_count
        );
        Ok(all)
    }

    fn add_pr_comment(
        &self,
        repo_path: &Path,
        pr_number: u64,
        body: &str,
    ) -> Result<PRComment> {
        log::info!("[add_pr_comment] Adding comment to PR #{}", pr_number);
        let cli = GhCli::new(repo_path);
        let stdout = cli.api_run(&format!("issues/{}/comments", pr_number), |cmd| {
            cmd.args(["--method", "POST", "--raw-field", &format!("body={}", body)]);
        })?;
        parse_comment_response(&stdout)
    }

    fn edit_pr_comment(
        &self,
        repo_path: &Path,
        _pr_number: u64,
        comment_id: &str,
        body: &str,
    ) -> Result<PRComment> {
        let cli = GhCli::new(repo_path);
        let stdout =
            cli.api_run(&format!("issues/comments/{}", comment_id), |cmd| {
                cmd.args(["--method", "PATCH", "--raw-field", &format!("body={}", body)]);
            })?;
        parse_comment_response(&stdout)
    }

    fn delete_pr_comment(
        &self,
        repo_path: &Path,
        _pr_number: u64,
        comment_id: &str,
    ) -> Result<()> {
        let cli = GhCli::new(repo_path);
        cli.api_run(&format!("issues/comments/{}", comment_id), |cmd| {
            cmd.args(["--method", "DELETE"]);
        })?;
        Ok(())
    }

    fn add_comment_reaction(
        &self,
        repo_path: &Path,
        _pr_number: u64,
        comment_id: &str,
        emoji: &str,
    ) -> Result<()> {
        let cli = GhCli::new(repo_path);
        cli.api_run(
            &format!("issues/comments/{}/reactions", comment_id),
            |cmd| {
                cmd.args(["--method", "POST", "--field", &format!("content={}", emoji)]);
            },
        )?;
        Ok(())
    }

    fn add_pr_review_comment(
        &self,
        repo_path: &Path,
        pr_number: u64,
        body: &str,
        path: &str,
        line: u64,
        side: &str,
    ) -> Result<PRReviewComment> {
        log::info!(
            "[add_pr_review_comment] PR #{} path={} line={} side={}",
            pr_number,
            path,
            line,
            side
        );
        let cli = GhCli::new(repo_path);
        let (owner, repo) = cli.repo_owner_name()?;
        let commit_id = cli.run(|cmd| {
            cmd.args([
                "api",
                &format!("repos/{}/{}/pulls/{}", owner, repo, pr_number),
                "--jq",
                ".head.sha",
            ]);
        })?;
        let stdout = cli.api_run(&format!("pulls/{}/comments", pr_number), |cmd| {
            cmd.args([
                "--method",
                "POST",
                "--field",
                &format!("body={}", body),
                "--field",
                &format!("commit_id={}", commit_id),
                "--field",
                &format!("path={}", path),
                "--field",
                &format!("line={}", line),
                "--field",
                &format!("side={}", side),
            ]);
        })?;
        let comment = parse_review_comment_response(&stdout)?;
        log::info!(
            "[add_pr_review_comment] Comment added successfully: id={}",
            comment.id
        );
        Ok(comment)
    }

    fn list_pr_review_comments(
        &self,
        repo_path: &Path,
        pr_number: u64,
    ) -> Result<Vec<PRReviewComment>> {
        log::info!("[list_pr_review_comments] Loading for PR #{}", pr_number);
        let cli = GhCli::new(repo_path);
        let stdout = cli.api_run(&format!("pulls/{}/comments", pr_number), |_| {})?;
        let comments = parse_review_comments_response(&stdout);
        log::info!(
            "[list_pr_review_comments] Loaded {} comments",
            comments.len()
        );
        Ok(comments)
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

fn fetch_pr_closed_by(
    repo_path: &Path,
    pr_number: u64,
) -> Result<Option<crate::project::types::Actor>> {
    let cli = GhCli::new(repo_path);
    let events: Vec<serde_json::Value> = cli
        .api_json(&format!("issues/{}/events", pr_number), |_| {})
        .unwrap_or_default();
    for event in &events {
        if event.get("event").and_then(|e| e.as_str()) != Some("closed") {
            continue;
        }
        let login = event.get("actor").and_then(|a| {
            a.as_str()
                .or_else(|| a.get("login").and_then(|l| l.as_str()))
                .map(String::from)
        });
        if let Some(login) = login {
            return Ok(Some(crate::project::types::Actor {
                login,
                avatar_url: None,
            }));
        }
    }
    Ok(None)
}
