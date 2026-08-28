//! High-level git operations (push, pull, clone, etc.) using the transport abstraction.
//!
//! 按 services.rs 模式拆分：`operations.rs` 原为 2400+ 行 God File，违反高内聚低耦合。
//! 现按职责拆为 9 个子模块，`mod.rs` 保持极薄（仅 mod 声明 + pub use + 共享常量/helpers）。

#![allow(unused_imports, missing_docs)]
use anyhow::{bail, Result};

use super::credential::{
    credential_approve, credential_reject, resolve_credential_helper, Credential,
};
use super::transport::{ErrorKind, GitExecError, GitTransport};
use super::types::PushOutcome;
use crate::common::executor::factory::ExecTarget;
use crate::common::git::parsers::{parse_numstat_line, parse_status_line};
use crate::common::git::provider::detect_provider;
use crate::common::git::types::{DiffHunk, DiffLine, DiffResult};
use crate::core::exec::collect_in_dir;
use crate::project::types::{
    AheadBehind, CommitDetail, CommitEntry, CommitFileChange, CommitResult, FileChange,
    FileDiffStats, GitBranchInfo, GitInfo, GitProvider, StashActionResult, StashEntry, Worktree,
};

/// 只读 git 查询的执行环境（公理2：查询无副作用）。
const READONLY_ENV: &[(&str, &str)] = &[("GIT_OPTIONAL_LOCKS", "0")];

/// 构造只读查询的 [`GitExecOptions`]（env 为静态切片，可安全跨 await 借用）。
pub(crate) const fn readonly_opts() -> super::transport::GitExecOptions<'static> {
    super::transport::GitExecOptions {
        env: READONLY_ENV,
        extra_config: &[],
    }
}

/// 写操作成功后失效该仓库的全部内存缓存（AGENTS.md：缓存失效不得散落调用点遗漏）。
pub(crate) fn invalidate_caches(work_dir: &str) {
    super::cache::invalidate_repo_caches(std::path::Path::new(work_dir));
}

/// 解析 worktree_path：空字符串视为「未指定 worktree」，回落项目根目录。
#[must_use]
pub fn resolve_worktree_path<'a>(worktree_path: &'a Option<String>, wd: &'a str) -> &'a str {
    match worktree_path.as_deref() {
        Some(p) if !p.trim().is_empty() => p,
        _ => wd,
    }
}

pub mod branch;
pub mod commit;
pub mod diff;
pub mod files;
pub mod info;
pub mod log;
pub mod stage;
pub mod stash;
pub mod sync;
pub mod worktree;

pub use branch::*;
pub use commit::*;
pub use diff::*;
pub use files::*;
pub use info::*;
pub use log::*;
pub use stage::*;
pub use stash::*;
pub use sync::*;
pub use worktree::*;

#[cfg(test)]
mod tests;
