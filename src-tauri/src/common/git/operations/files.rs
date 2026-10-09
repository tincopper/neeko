// Git operations — files sub-module (split from operations.rs God File).

use crate::common::git::status_worker::parse_porcelain;
use crate::common::git::transport::GitTransport;
use crate::project::types::FileChange;
use anyhow::{bail, Result};

/// 计算某Workspace的 status：**porcelain 单一引擎**（三端一致）。
///
/// 取代旧的 `get_worktree_changed_files`（libgit2 一套 + CLI 一套）：双引擎除维护成本外，
/// 更致命的是词表与语义不一致（`renamed_from` 在 libgit2 分支恒 `None`），且 libgit2
/// 分支**没有 version 语义**，读接口只能返回 `version: 0` 让前端「恒放行」—— 于是任何
/// 一次 pull 都能覆盖任何时刻的 push 快照。
///
/// 行数（additions/deletions）不在本函数职责内：由 `get_changed_files_diff_stats`
/// 按需拉取（G4，status 主链路保持单次 porcelain）。
pub async fn status_porcelain(
    transport: &dyn GitTransport,
    work_dir: &str,
) -> Result<(Vec<FileChange>, String)> {
    // 「是不是仓库」必须由 transport 判定：WSL / SSH 的工作树在别的机器上，
    // 本地 `path.join(".git").exists()` 必然为 false —— 用本地判定会把远端单元的
    // status 一律判死（本次改造实测踩过，见任务 09-26 的 AC13）。
    if !transport.is_git_repo(work_dir).await {
        bail!("not a git repository: {work_dir}");
    }
    let output = transport
        .run_git(&["status", "--porcelain"], work_dir)
        .await?;
    let entries = parse_porcelain(&output);
    let branch = transport
        .run_git(&["rev-parse", "--abbrev-ref", "HEAD"], work_dir)
        .await
        .map(|head| {
            let head = head.trim().to_string();
            if head.is_empty() {
                "HEAD".to_string()
            } else {
                head
            }
        })
        .unwrap_or_default();
    Ok((entries, branch))
}

/// List untracked files under `dir_path`, expanding a collapsed untracked-dir
/// entry from `get_worktree_changed_files` (changes list shows `dir/` as a single
/// row; the UI expands it on demand). `git ls-files --others --exclude-standard`
/// respects .gitignore and works for all transports; result is capped to guard
/// IPC size on huge untracked directories (公理：随输入规模增长的结构必须有界).
pub async fn get_untracked_files(
    transport: &dyn GitTransport,
    worktree_path: &str,
    dir_path: &str,
) -> Result<Vec<String>> {
    const MAX_UNTRACKED_FILES: usize = 500;
    let dir = dir_path.trim_end_matches('/');
    if dir.is_empty() {
        return Ok(Vec::new());
    }
    let output = transport
        .run_git(
            // -z：NUL 分隔且 git **不做 C 转义**。文本形态下含非 ASCII 的名字会被转成
            // `"test/\346\265\213\350\257\225.txt"`（core.quotePath 默认开启），
            // 直接进 UI 就是乱码、拿它当 pathspec 也找不到目录。
            &[
                "ls-files",
                "--others",
                "--exclude-standard",
                "-z",
                "--",
                dir,
            ],
            worktree_path,
        )
        .await?;
    // -z 形态下路径是原样字节：不做 trim（文件名可以合法地含首尾空格），只丢弃
    // 末尾 NUL 切出的空片段。
    let mut entries: Vec<String> = output
        .split('\0')
        .filter(|entry| !entry.is_empty())
        .map(str::to_string)
        .collect();
    if entries.len() > MAX_UNTRACKED_FILES {
        // 与 local.rs MAX_CHANGED_FILES 截断惯例一致：超限必须留痕，避免静默丢数据
        ::log::warn!(
            "get_untracked_files({}) exceeded cap: {} entries truncated to {}",
            dir,
            entries.len(),
            MAX_UNTRACKED_FILES
        );
        entries.truncate(MAX_UNTRACKED_FILES);
    }
    Ok(entries)
}

/// Get changed files diff stats (additions/deletions).
/// Uses git2 for local transports, local shell fallback otherwise.
pub async fn get_recent_commit_messages(
    transport: &dyn GitTransport,
    work_dir: &str,
    count: usize,
) -> Result<Vec<String>> {
    let count_str = format!("-{}", count);
    let output = transport
        .run_git(&["log", count_str.as_str(), "--format=%s"], work_dir)
        .await?;
    let messages: Vec<String> = output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    Ok(messages)
}
