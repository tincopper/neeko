#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use crate::project::types::{AheadBehind, FileDiffStats, PRInfo, PRListItem, PrLabel};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use super::key::repo_key_prefix;

// ─── TTL Metadata Cache ───────────────────────────────────────────────────

pub(crate) const METADATA_TTL: Duration = Duration::from_secs(60);

pub(crate) struct TtlCache<T> {
    inner: Mutex<HashMap<String, (Instant, T)>>,
}

impl<T> TtlCache<T> {
    pub(crate) fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn get(&self, key: &str) -> Option<T>
    where
        T: Clone,
    {
        let guard = self.inner.lock().ok()?;
        guard.get(key).and_then(|(ts, val)| {
            if ts.elapsed() < METADATA_TTL {
                Some(val.clone())
            } else {
                None
            }
        })
    }

    pub(crate) fn set(&self, key: String, val: T) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.insert(key, (Instant::now(), val));
        }
    }

    pub(crate) fn invalidate_repo(&self, repo_path: &Path) {
        if let Ok(mut guard) = self.inner.lock() {
            let prefix = repo_key_prefix(repo_path);
            guard.retain(|k, _| !k.starts_with(&prefix));
        }
    }
}

pub(crate) static PR_LIST_CACHE: LazyLock<TtlCache<Vec<PRListItem>>> = LazyLock::new(TtlCache::new);
pub(crate) static PR_INFO_CACHE: LazyLock<TtlCache<PRInfo>> = LazyLock::new(TtlCache::new);
pub(crate) static REPO_LABELS_CACHE: LazyLock<TtlCache<Vec<PrLabel>>> =
    LazyLock::new(TtlCache::new);
pub(crate) static REPO_AUTHORS_CACHE: LazyLock<TtlCache<Vec<String>>> =
    LazyLock::new(TtlCache::new);
pub(crate) static DEFAULT_BRANCH_CACHE: LazyLock<TtlCache<String>> = LazyLock::new(TtlCache::new);
pub(crate) static GH_INSTALLED_CACHE: Mutex<Option<(Instant, bool)>> = Mutex::new(None);
pub(crate) static GH_AUTHENTICATED_CACHE: Mutex<Option<(Instant, bool)>> = Mutex::new(None);
pub(crate) static DIFF_STATS_CACHE: LazyLock<TtlCache<Vec<FileDiffStats>>> =
    LazyLock::new(TtlCache::new);
pub(crate) static AHEAD_BEHIND_CACHE: LazyLock<TtlCache<AheadBehind>> =
    LazyLock::new(TtlCache::new);

// ─── Public API (TTL-backed) ──────────────────────────────────────────────

/// Get cached PR list or fetch via callback
pub fn get_cached_pr_list(
    repo_path: &Path,
    state: &str,
    limit: usize,
    fetch: impl FnOnce() -> anyhow::Result<Vec<PRListItem>>,
) -> anyhow::Result<Vec<PRListItem>> {
    let key = format!("{}:pr_list:{}:{}", repo_key_prefix(repo_path), state, limit);
    if let Some(cached) = PR_LIST_CACHE.get(&key) {
        return Ok(cached);
    }
    let result = fetch()?;
    PR_LIST_CACHE.set(key, result.clone());
    Ok(result)
}

/// Get cached PR info or fetch via callback
pub fn get_cached_pr_info(
    repo_path: &Path,
    pr_number: u64,
    fetch: impl FnOnce() -> anyhow::Result<PRInfo>,
) -> anyhow::Result<PRInfo> {
    let key = format!("{}:pr_info:{}", repo_key_prefix(repo_path), pr_number);
    if let Some(cached) = PR_INFO_CACHE.get(&key) {
        return Ok(cached);
    }
    let result = fetch()?;
    PR_INFO_CACHE.set(key, result.clone());
    Ok(result)
}

/// Get cached repo labels or fetch via callback
pub fn get_cached_repo_labels(
    repo_path: &Path,
    fetch: impl FnOnce() -> anyhow::Result<Vec<PrLabel>>,
) -> anyhow::Result<Vec<PrLabel>> {
    let key = repo_key_prefix(repo_path);
    if let Some(cached) = REPO_LABELS_CACHE.get(&key) {
        return Ok(cached);
    }
    let result = fetch()?;
    REPO_LABELS_CACHE.set(key, result.clone());
    Ok(result)
}

/// Get cached repo authors or fetch via callback
pub fn get_cached_repo_authors(
    repo_path: &Path,
    fetch: impl FnOnce() -> anyhow::Result<Vec<String>>,
) -> anyhow::Result<Vec<String>> {
    let key = repo_key_prefix(repo_path);
    if let Some(cached) = REPO_AUTHORS_CACHE.get(&key) {
        return Ok(cached);
    }
    let result = fetch()?;
    REPO_AUTHORS_CACHE.set(key, result.clone());
    Ok(result)
}

/// Get cached default branch or compute
pub fn get_cached_default_branch(
    repo_path: &Path,
    fetch: impl FnOnce() -> anyhow::Result<String>,
) -> anyhow::Result<String> {
    let key = repo_key_prefix(repo_path);
    if let Some(cached) = DEFAULT_BRANCH_CACHE.get(&key) {
        return Ok(cached);
    }
    let result = fetch()?;
    DEFAULT_BRANCH_CACHE.set(key, result.clone());
    Ok(result)
}

/// Check if gh is installed (cached for TTL) — sync closure variant
pub fn get_cached_gh_installed(check: impl FnOnce() -> bool) -> bool {
    if let Ok(guard) = GH_INSTALLED_CACHE.lock() {
        if let Some((ts, val)) = &*guard {
            if ts.elapsed() < METADATA_TTL {
                return *val;
            }
        }
    }
    let result = check();
    if let Ok(mut guard) = GH_INSTALLED_CACHE.lock() {
        *guard = Some((Instant::now(), result));
    }
    result
}

/// Check cached gh installed status without computing
pub fn get_gh_installed_cached() -> Option<bool> {
    let guard = GH_INSTALLED_CACHE.lock().ok()?;
    let (ts, val) = guard.as_ref()?;
    if ts.elapsed() < METADATA_TTL {
        Some(*val)
    } else {
        None
    }
}

/// Set cached gh installed status
pub fn set_gh_installed_cache(val: bool) {
    if let Ok(mut guard) = GH_INSTALLED_CACHE.lock() {
        *guard = Some((Instant::now(), val));
    }
}

/// Check if gh is authenticated (cached for TTL) — sync closure variant
pub fn get_cached_gh_authenticated(check: impl FnOnce() -> bool) -> bool {
    if let Ok(guard) = GH_AUTHENTICATED_CACHE.lock() {
        if let Some((ts, val)) = &*guard {
            if ts.elapsed() < METADATA_TTL {
                return *val;
            }
        }
    }
    let result = check();
    if let Ok(mut guard) = GH_AUTHENTICATED_CACHE.lock() {
        *guard = Some((Instant::now(), result));
    }
    result
}

/// Check cached gh authenticated status without computing
pub fn get_gh_authenticated_cached() -> Option<bool> {
    let guard = GH_AUTHENTICATED_CACHE.lock().ok()?;
    let (ts, val) = guard.as_ref()?;
    if ts.elapsed() < METADATA_TTL {
        Some(*val)
    } else {
        None
    }
}

/// Set cached gh authenticated status
pub fn set_gh_authenticated_cache(val: bool) {
    if let Ok(mut guard) = GH_AUTHENTICATED_CACHE.lock() {
        *guard = Some((Instant::now(), val));
    }
}

/// Check cached PR list without fetching
pub fn get_pr_list_cached(repo_path: &Path, state: &str, limit: usize) -> Option<Vec<PRListItem>> {
    let key = format!("{}:pr_list:{}:{}", repo_key_prefix(repo_path), state, limit);
    PR_LIST_CACHE.get(&key)
}

/// Set cached PR list
pub fn set_pr_list_cache(repo_path: &Path, state: &str, limit: usize, value: Vec<PRListItem>) {
    let key = format!("{}:pr_list:{}:{}", repo_key_prefix(repo_path), state, limit);
    PR_LIST_CACHE.set(key, value);
}

/// Check cached PR info without fetching
pub fn get_pr_info_cached(repo_path: &Path, pr_number: u64) -> Option<PRInfo> {
    let key = format!("{}:pr_info:{}", repo_key_prefix(repo_path), pr_number);
    PR_INFO_CACHE.get(&key)
}

/// Set cached PR info
pub fn set_pr_info_cache(repo_path: &Path, pr_number: u64, value: PRInfo) {
    let key = format!("{}:pr_info:{}", repo_key_prefix(repo_path), pr_number);
    PR_INFO_CACHE.set(key, value);
}

/// Check cached repo labels without fetching
pub fn get_repo_labels_cached(repo_path: &Path) -> Option<Vec<PrLabel>> {
    let key = repo_key_prefix(repo_path);
    REPO_LABELS_CACHE.get(&key)
}

/// Set cached repo labels
pub fn set_repo_labels_cache(repo_path: &Path, value: Vec<PrLabel>) {
    let key = repo_key_prefix(repo_path);
    REPO_LABELS_CACHE.set(key, value);
}

/// Check cached repo authors without fetching
pub fn get_repo_authors_cached(repo_path: &Path) -> Option<Vec<String>> {
    let key = repo_key_prefix(repo_path);
    REPO_AUTHORS_CACHE.get(&key)
}

/// Set cached repo authors
pub fn set_repo_authors_cache(repo_path: &Path, value: Vec<String>) {
    let key = repo_key_prefix(repo_path);
    REPO_AUTHORS_CACHE.set(key, value);
}

/// Get cached diff stats or compute
pub fn get_cached_diff_stats(
    repo_path: &Path,
    fetch: impl FnOnce() -> anyhow::Result<Vec<FileDiffStats>>,
) -> anyhow::Result<Vec<FileDiffStats>> {
    let key = repo_key_prefix(repo_path);
    if let Some(cached) = DIFF_STATS_CACHE.get(&key) {
        return Ok(cached);
    }
    let result = fetch()?;
    DIFF_STATS_CACHE.set(key, result.clone());
    Ok(result)
}

/// Get cached ahead/behind or compute
pub fn get_cached_ahead_behind(
    repo_path: &Path,
    fetch: impl FnOnce() -> anyhow::Result<AheadBehind>,
) -> anyhow::Result<AheadBehind> {
    let key = repo_key_prefix(repo_path);
    if let Some(cached) = AHEAD_BEHIND_CACHE.get(&key) {
        return Ok(cached);
    }
    let result = fetch()?;
    AHEAD_BEHIND_CACHE.set(key, result.clone());
    Ok(result)
}

/// Invalidate TTL-backed caches for a repo.
pub(crate) fn invalidate_memory_caches(repo_path: &Path) {
    PR_LIST_CACHE.invalidate_repo(repo_path);
    PR_INFO_CACHE.invalidate_repo(repo_path);
    REPO_LABELS_CACHE.invalidate_repo(repo_path);
    REPO_AUTHORS_CACHE.invalidate_repo(repo_path);
    DEFAULT_BRANCH_CACHE.invalidate_repo(repo_path);
    DIFF_STATS_CACHE.invalidate_repo(repo_path);
    AHEAD_BEHIND_CACHE.invalidate_repo(repo_path);
}
