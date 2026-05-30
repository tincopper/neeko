use crate::git::types::DiffResult;
use crate::project::types::{AheadBehind, FileDiffStats, PRInfo, PRListItem};
use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

// ─── TTL Metadata Cache (参考 Muxy GitMetadataCache) ────────────────────────

const METADATA_TTL: Duration = Duration::from_secs(60);

struct TtlCache<T> {
    inner: Mutex<HashMap<String, (Instant, T)>>,
}

impl<T> TtlCache<T> {
    fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    fn get(&self, key: &str) -> Option<T>
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

    fn set(&self, key: String, val: T) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.insert(key, (Instant::now(), val));
        }
    }

    fn invalidate_repo(&self, repo_path: &Path) {
        if let Ok(mut guard) = self.inner.lock() {
            let prefix = repo_key_prefix(repo_path);
            guard.retain(|k, _| !k.starts_with(&prefix));
        }
    }
}

static PR_LIST_CACHE: LazyLock<TtlCache<Vec<PRListItem>>> = LazyLock::new(TtlCache::new);
static PR_INFO_CACHE: LazyLock<TtlCache<PRInfo>> = LazyLock::new(TtlCache::new);
static DEFAULT_BRANCH_CACHE: LazyLock<TtlCache<String>> = LazyLock::new(TtlCache::new);
static GH_INSTALLED_CACHE: Mutex<Option<(Instant, bool)>> = Mutex::new(None);

// ─── LRU Diff Cache (参考 Muxy DiffCache) ─────────────────────────────────

const DIFF_CACHE_CAP: usize = 50;

struct LruCache {
    map: Mutex<HashMap<String, usize>>,
    queue: Mutex<VecDeque<(String, DiffResult)>>,
}

impl LruCache {
    fn new() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
            queue: Mutex::new(VecDeque::new()),
        }
    }

    fn get(&self, key: &str) -> Option<DiffResult> {
        let mut queue = self.queue.lock().ok()?;
        let mut map = self.map.lock().ok()?;
        if let Some(&idx) = map.get(key) {
            if let Some(entry) = queue.get(idx) {
                let val = entry.1.clone();
                // Move to back (most recently used)
                queue.remove(idx);
                queue.push_back((key.to_string(), val.clone()));
                // Update indices
                self.rebuild_indices(&mut map, &queue);
                return Some(val);
            }
        }
        None
    }

    fn set(&self, key: String, val: DiffResult) {
        let mut queue = self
            .queue
            .lock()
            .expect("infallible: LRU queue lock should not be poisoned");
        let mut map = self
            .map
            .lock()
            .expect("infallible: LRU map lock should not be poisoned");

        // Remove existing entry if present
        if let Some(&idx) = map.get(&key) {
            queue.remove(idx);
        }

        // Evict if at capacity
        while queue.len() >= DIFF_CACHE_CAP {
            if let Some((old_key, _)) = queue.pop_front() {
                map.remove(&old_key);
            }
        }

        queue.push_back((key.clone(), val));
        self.rebuild_indices(&mut map, &queue);
    }

    fn invalidate_repo(&self, repo_path: &Path) {
        let mut queue = self
            .queue
            .lock()
            .expect("infallible: LRU queue lock should not be poisoned");
        let mut map = self
            .map
            .lock()
            .expect("infallible: LRU map lock should not be poisoned");
        let prefix = repo_key_prefix(repo_path);
        queue.retain(|(k, _)| !k.starts_with(&prefix));
        self.rebuild_indices(&mut map, &queue);
    }

    fn rebuild_indices(
        &self,
        map: &mut HashMap<String, usize>,
        queue: &VecDeque<(String, DiffResult)>,
    ) {
        let _ = self;
        map.clear();
        for (i, (key, _)) in queue.iter().enumerate() {
            map.insert(key.clone(), i);
        }
    }
}

static DIFF_CACHE: LazyLock<LruCache> = LazyLock::new(LruCache::new);
static DIFF_STATS_CACHE: LazyLock<TtlCache<Vec<FileDiffStats>>> = LazyLock::new(TtlCache::new);
static AHEAD_BEHIND_CACHE: LazyLock<TtlCache<AheadBehind>> = LazyLock::new(TtlCache::new);

// ─── Helpers ──────────────────────────────────────────────────────────────

fn repo_key_prefix(repo_path: &Path) -> String {
    repo_path.to_string_lossy().to_string()
}

fn diff_cache_key(repo_path: &Path, file_path: &str) -> String {
    format!("{}:{}", repo_path.to_string_lossy(), file_path)
}

// ─── Public API ───────────────────────────────────────────────────────────

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

/// Check if gh is installed (cached for TTL)
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

/// Get cached diff or compute
pub fn get_cached_diff(
    repo_path: &Path,
    file_path: &str,
    fetch: impl FnOnce() -> anyhow::Result<DiffResult>,
) -> anyhow::Result<DiffResult> {
    let key = diff_cache_key(repo_path, file_path);
    if let Some(cached) = DIFF_CACHE.get(&key) {
        return Ok(cached);
    }
    let result = fetch()?;
    DIFF_CACHE.set(key, result.clone());
    Ok(result)
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

/// Invalidate all caches for a repo (called after write operations)
pub fn invalidate_repo_caches(repo_path: &Path) {
    PR_LIST_CACHE.invalidate_repo(repo_path);
    PR_INFO_CACHE.invalidate_repo(repo_path);
    DEFAULT_BRANCH_CACHE.invalidate_repo(repo_path);
    DIFF_CACHE.invalidate_repo(repo_path);
    DIFF_STATS_CACHE.invalidate_repo(repo_path);
    AHEAD_BEHIND_CACHE.invalidate_repo(repo_path);
}
