// Git operations — sync sub-module (split from operations.rs God File).

#![allow(unused_imports, missing_docs)]
use super::{invalidate_caches, readonly_opts, READONLY_ENV};
use crate::common::executor::factory::ExecTarget;
use crate::common::git::cache;
use crate::common::git::credential::{
    credential_approve, credential_reject, resolve_credential_helper, Credential,
};
use crate::common::git::parsers::{parse_numstat_line, parse_status_line};
use crate::common::git::provider::detect_provider;
use crate::common::git::transport::{ErrorKind, GitExecError, GitTransport};
use crate::common::git::types::PushOutcome;
use crate::common::git::types::{DiffHunk, DiffLine, DiffResult};
use crate::core::exec::collect_in_dir;
use crate::project::types::{
    AheadBehind, CommitDetail, CommitEntry, CommitFileChange, CommitResult, FileChange,
    FileDiffStats, GitBranchInfo, GitInfo, GitProvider, StashActionResult, StashEntry, Worktree,
};
use anyhow::{bail, Result};

pub async fn fetch(transport: &dyn GitTransport, work_dir: &str) -> Result<PushOutcome> {
    let result = transport.run_git(&["fetch", "--all"], work_dir).await;
    match result {
        Ok(_) => {
            invalidate_caches(work_dir);
            Ok(PushOutcome::Success {})
        }
        Err(e) => classify_git_error(transport, work_dir, e).await,
    }
}

/// Fetch with cached credentials (approve before fetch).
pub async fn fetch_with_credentials(
    transport: &dyn GitTransport,
    work_dir: &str,
    username: &str,
    password: &str,
) -> Result<PushOutcome> {
    exec_with_credentials(transport, work_dir, &["fetch", "--all"], username, password).await?;
    invalidate_caches(work_dir);
    Ok(PushOutcome::Success {})
}

/// Push to remote: `git push [--set-upstream [-o origin <branch>]]`
pub async fn push(
    transport: &dyn GitTransport,
    work_dir: &str,
    set_upstream: bool,
) -> Result<PushOutcome> {
    let owned = push_args(transport, work_dir, set_upstream).await;
    let args: Vec<&str> = owned.iter().map(|s| s.as_str()).collect();
    let result = transport.run_git(&args, work_dir).await;
    match result {
        Ok(_) => {
            invalidate_caches(work_dir);
            Ok(PushOutcome::Success {})
        }
        Err(e) => classify_git_error(transport, work_dir, e).await,
    }
}

/// Push with pre-approved credentials (credential_approve + push).
pub async fn push_with_credentials(
    transport: &dyn GitTransport,
    work_dir: &str,
    set_upstream: bool,
    username: &str,
    password: &str,
) -> Result<PushOutcome> {
    let owned = push_args(transport, work_dir, set_upstream).await;
    let args: Vec<&str> = owned.iter().map(|s| s.as_str()).collect();
    exec_with_credentials(transport, work_dir, &args, username, password).await?;
    invalidate_caches(work_dir);
    Ok(PushOutcome::Success {})
}

/// Pull: fetch + merge --ff-only
pub async fn pull(transport: &dyn GitTransport, work_dir: &str) -> Result<PushOutcome> {
    let branch = transport
        .run_git(&["rev-parse", "--abbrev-ref", "HEAD"], work_dir)
        .await?;
    let branch = branch.trim();
    let _ = transport
        .run_git(&["fetch", "origin", branch], work_dir)
        .await;
    let remote_branch = format!("origin/{}", branch);
    let result = transport
        .run_git(&["merge", "--ff-only", &remote_branch], work_dir)
        .await;
    match result {
        Ok(_) => {
            invalidate_caches(work_dir);
            Ok(PushOutcome::Success {})
        }
        Err(e) => classify_git_error(transport, work_dir, e).await,
    }
}

/// Pull with pre-approved credentials.
pub async fn pull_with_credentials(
    transport: &dyn GitTransport,
    work_dir: &str,
    username: &str,
    password: &str,
) -> Result<PushOutcome> {
    let branch = transport
        .run_git(&["rev-parse", "--abbrev-ref", "HEAD"], work_dir)
        .await?;
    let branch = branch.trim();
    exec_with_credentials(
        transport,
        work_dir,
        &["fetch", "origin", branch],
        username,
        password,
    )
    .await?;
    let remote_branch = format!("origin/{}", branch);
    let result = transport
        .run_git(&["merge", "--ff-only", &remote_branch], work_dir)
        .await;
    match result {
        Ok(_) => {
            invalidate_caches(work_dir);
            Ok(PushOutcome::Success {})
        }
        Err(e) => classify_git_error(transport, work_dir, e).await,
    }
}

/// 构造 push 参数列表（带 --set-upstream 时附加 origin branch）。返回 String 避免生命周期问题。
async fn push_args(
    transport: &dyn GitTransport,
    work_dir: &str,
    set_upstream: bool,
) -> Vec<String> {
    if set_upstream {
        if let Some(branch) = get_current_branch_opt(transport, work_dir).await {
            vec![
                "push".to_string(),
                "--set-upstream".to_string(),
                "origin".to_string(),
                branch,
            ]
        } else {
            vec!["push".to_string(), "--set-upstream".to_string()]
        }
    } else {
        vec!["push".to_string()]
    }
}

/// 跑一条 git 命令并在鉴权失败时返回 AuthRequired（approve 后重试用）。
async fn exec_with_credentials(
    transport: &dyn GitTransport,
    work_dir: &str,
    args: &[&str],
    username: &str,
    password: &str,
) -> Result<PushOutcome> {
    let remote_url = get_remote_url(transport, work_dir)
        .await
        .unwrap_or_else(|_| "unknown".to_string());
    let helper = resolve_credential_helper(transport, work_dir).await?;
    // 如果 remote_url 不是合法 URL（如 "unknown"），跳过 credential 流程直接执行
    if remote_url == "unknown" || !remote_url.contains("://") {
        let result = transport.run_git(args, work_dir).await;
        return match result {
            Ok(_) => Ok(PushOutcome::Success {}),
            Err(e) => classify_git_error(transport, work_dir, e).await,
        };
    }
    let cred = match Credential::from_url(&remote_url, Some(username)) {
        Ok(c) => c,
        Err(_) => {
            // URL 格式无法解析，跳过 credential 流程
            let result = transport.run_git(args, work_dir).await;
            return match result {
                Ok(_) => Ok(PushOutcome::Success {}),
                Err(e) => classify_git_error(transport, work_dir, e).await,
            };
        }
    };
    let _ = credential_approve(transport, work_dir, &helper, &cred, username, password).await;
    let result = transport.run_git(args, work_dir).await;
    match result {
        Ok(_) => Ok(PushOutcome::Success {}),
        Err(e) => {
            let classified = classify_git_error(transport, work_dir, e).await?;
            if let PushOutcome::AuthRequired { ssh: false, .. } = classified {
                let _ = credential_reject(transport, work_dir, &helper, &cred, username).await;
                Ok(PushOutcome::AuthRequired {
                    remote_url,
                    username_hint: Some(username.to_string()),
                    ssh: false,
                })
            } else {
                Ok(classified)
            }
        }
    }
}

/// 从 GitExecError 分类为 PushOutcome（Auth / AuthSsh → AuthRequired；其他 bail）。
/// 异步版本，直接 await remote URL 获取，避免嵌套 tokio Runtime。
async fn classify_git_error(
    transport: &dyn GitTransport,
    work_dir: &str,
    err: anyhow::Error,
) -> Result<PushOutcome> {
    let kind = err
        .chain()
        .find_map(|c| c.downcast_ref::<GitExecError>())
        .map(|e| e.kind)
        .unwrap_or(ErrorKind::Other);
    let remote_url = get_remote_url(transport, work_dir)
        .await
        .unwrap_or_else(|_| "unknown".to_string());
    let username_hint = extract_username_hint(&remote_url);
    let is_ssh_url = remote_url.starts_with("git@") || remote_url.starts_with("ssh://");
    match kind {
        ErrorKind::Auth => Ok(PushOutcome::AuthRequired {
            remote_url,
            username_hint,
            ssh: false,
        }),
        ErrorKind::AuthSsh => Ok(PushOutcome::AuthRequired {
            remote_url,
            username_hint,
            ssh: true,
        }),
        ErrorKind::Network => {
            bail!("Network error (check connectivity): {}", err);
        }
        ErrorKind::Ambiguous => Ok(PushOutcome::AuthRequired {
            remote_url,
            username_hint,
            ssh: is_ssh_url,
        }),
        ErrorKind::NoUpstream => {
            bail!("The current branch has no upstream branch. Push with `--set-upstream` or use the 'Push with upstream' option.");
        }
        ErrorKind::Other => {
            bail!("git operation failed: {}", err);
        }
    }
}

/// 获取 origin remote URL。
async fn get_remote_url(transport: &dyn GitTransport, work_dir: &str) -> Result<String> {
    transport
        .run_git(&["remote", "get-url", "origin"], work_dir)
        .await
        .map(|s| s.trim().to_string())
}

/// 获取当前分支名（Option 版，失败返回 None）。
async fn get_current_branch_opt(transport: &dyn GitTransport, work_dir: &str) -> Option<String> {
    transport
        .run_git(&["rev-parse", "--abbrev-ref", "HEAD"], work_dir)
        .await
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|b| b != "HEAD")
}

/// 从 https://user@host/path 中提取 user。
fn extract_username_hint(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    rest.split_once('@').map(|(user, _)| user.to_string())
}
