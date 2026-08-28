#![allow(unused_imports, missing_docs)]

pub mod file;
pub mod key;
pub mod memory;

pub use file::{capture_file_fingerprint, get_cached_worktree_diff, FileFingerprint};
pub use key::{diff_cache_key, repo_key_prefix};
pub use memory::{
    get_cached_ahead_behind, get_cached_default_branch, get_cached_diff_stats,
    get_cached_gh_authenticated, get_cached_gh_installed, get_cached_pr_info, get_cached_pr_list,
    get_cached_repo_authors, get_cached_repo_labels, get_gh_authenticated_cached,
    get_gh_installed_cached, get_pr_info_cached, get_pr_list_cached, get_repo_authors_cached,
    get_repo_labels_cached, set_gh_authenticated_cache, set_gh_installed_cache, set_pr_info_cache,
    set_pr_list_cache, set_repo_authors_cache, set_repo_labels_cache,
};

use std::path::Path;

/// Invalidate all caches for a repo (called after write operations).
pub fn invalidate_repo_caches(repo_path: &Path) {
    memory::invalidate_memory_caches(repo_path);
    file::invalidate_file_caches(repo_path);
}
