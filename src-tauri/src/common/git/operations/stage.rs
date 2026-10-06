// Git operations — stage sub-module (split from operations.rs God File).

use super::invalidate_caches;
use crate::common::git::transport::GitTransport;
use anyhow::Result;

/// 暂存指定路径（`git add`）。
pub async fn stage_files(
    transport: &dyn GitTransport,
    work_dir: &str,
    file_paths: &[String],
) -> Result<()> {
    let mut args: Vec<&str> = vec!["add", "--"];
    for f in file_paths {
        args.push(f);
    }
    transport.run_git(&args, work_dir).await?;
    invalidate_caches(work_dir);
    Ok(())
}

/// Unstage specific files: `git restore --staged -- <files>`
pub async fn unstage_files(
    transport: &dyn GitTransport,
    work_dir: &str,
    file_paths: &[String],
) -> Result<()> {
    let mut args: Vec<&str> = vec!["restore", "--staged", "--"];
    for f in file_paths {
        args.push(f);
    }
    transport.run_git(&args, work_dir).await?;
    invalidate_caches(work_dir);
    Ok(())
}

/// Stage all changes: `git add -A`
pub async fn stage_all(transport: &dyn GitTransport, work_dir: &str) -> Result<()> {
    transport.run_git(&["add", "-A"], work_dir).await?;
    invalidate_caches(work_dir);
    Ok(())
}

/// Unstage all changes: `git restore --staged .`
pub async fn unstage_all(transport: &dyn GitTransport, work_dir: &str) -> Result<()> {
    transport
        .run_git(&["restore", "--staged", "."], work_dir)
        .await?;
    invalidate_caches(work_dir);
    Ok(())
}

// discard 系列（丢弃变更）已迁至 `operations/discard.rs`：
// 唯一入口 `discard_paths(paths)` 同时承载「单文件 / 选中 / 整组」三种 UI 入口。
