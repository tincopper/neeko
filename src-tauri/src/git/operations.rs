use anyhow::Result;

use super::transport::GitTransport;

/// Stage specific files: `git add -- <files>`
pub async fn stage_files(
    transport: &GitTransport,
    work_dir: &str,
    file_paths: &[String],
) -> Result<()> {
    let mut args: Vec<&str> = vec!["add", "--"];
    for f in file_paths {
        args.push(f);
    }
    transport.run_git(&args, work_dir).await?;
    Ok(())
}

/// Unstage specific files: `git restore --staged -- <files>`
pub async fn unstage_files(
    transport: &GitTransport,
    work_dir: &str,
    file_paths: &[String],
) -> Result<()> {
    let mut args: Vec<&str> = vec!["restore", "--staged", "--"];
    for f in file_paths {
        args.push(f);
    }
    transport.run_git(&args, work_dir).await?;
    Ok(())
}

/// Stage all changes: `git add -A`
pub async fn stage_all(transport: &GitTransport, work_dir: &str) -> Result<()> {
    transport.run_git(&["add", "-A"], work_dir).await?;
    Ok(())
}

/// Unstage all changes: `git restore --staged .`
pub async fn unstage_all(transport: &GitTransport, work_dir: &str) -> Result<()> {
    transport
        .run_git(&["restore", "--staged", "."], work_dir)
        .await?;
    Ok(())
}

/// Discard file changes: `git checkout -- <file>`
pub async fn discard_file(
    transport: &GitTransport,
    work_dir: &str,
    file_path: &str,
) -> Result<()> {
    transport
        .run_git(&["checkout", "--", file_path], work_dir)
        .await?;
    Ok(())
}

/// Discard all changes: `git checkout -- .`
pub async fn discard_all(transport: &GitTransport, work_dir: &str) -> Result<()> {
    transport.run_git(&["checkout", "--", "."], work_dir).await?;
    // Also clean untracked files
    let _ = transport.run_git(&["clean", "-fd"], work_dir).await;
    Ok(())
}

/// Fetch from all remotes: `git fetch --all`
pub async fn fetch(transport: &GitTransport, work_dir: &str) -> Result<()> {
    transport.run_git(&["fetch", "--all"], work_dir).await?;
    Ok(())
}

/// Push to remote: `git push [--set-upstream]`
pub async fn push(
    transport: &GitTransport,
    work_dir: &str,
    set_upstream: bool,
) -> Result<()> {
    if set_upstream {
        transport
            .run_git(&["push", "--set-upstream"], work_dir)
            .await?;
    } else {
        transport.run_git(&["push"], work_dir).await?;
    }
    Ok(())
}

/// Cherry-pick a commit: `git cherry-pick <commit_hash>`
pub async fn cherry_pick(
    transport: &GitTransport,
    work_dir: &str,
    commit_hash: &str,
) -> Result<()> {
    transport
        .run_git(&["cherry-pick", commit_hash], work_dir)
        .await?;
    Ok(())
}

/// Revert a commit: `git revert --no-edit <commit_hash>`
pub async fn revert(
    transport: &GitTransport,
    work_dir: &str,
    commit_hash: &str,
) -> Result<()> {
    transport
        .run_git(&["revert", "--no-edit", commit_hash], work_dir)
        .await?;
    Ok(())
}

/// Create a tag: `git tag -a <name> -m <message>`
pub async fn create_tag(
    transport: &GitTransport,
    work_dir: &str,
    name: &str,
    message: &str,
) -> Result<()> {
    transport
        .run_git(&["tag", "-a", name, "-m", message], work_dir)
        .await?;
    Ok(())
}
