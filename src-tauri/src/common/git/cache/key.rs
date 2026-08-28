#![allow(unused_imports, missing_docs)]

use std::path::Path;

/// Prefix for repo-scoped cache keys.
#[must_use]
pub fn repo_key_prefix(repo_path: &Path) -> String {
    repo_path.to_string_lossy().to_string()
}

/// Cache key for worktree diff entries.
#[must_use]
pub fn diff_cache_key(repo_path: &Path, file_path: &str, collapse: bool) -> String {
    format!(
        "{}:{}:collapse={}",
        repo_path.to_string_lossy(),
        file_path,
        collapse
    )
}
