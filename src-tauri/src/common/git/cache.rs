//! In-memory caches for git operations and PR data.

#![allow(clippy::unwrap_used, clippy::expect_used)]

use crate::common::git::types::DiffResult;
use crate::project::types::{AheadBehind, FileDiffStats, PRInfo, PRListItem, PrLabel};
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
static REPO_LABELS_CACHE: LazyLock<TtlCache<Vec<PrLabel>>> = LazyLock::new(TtlCache::new);
static REPO_AUTHORS_CACHE: LazyLock<TtlCache<Vec<String>>> = LazyLock::new(TtlCache::new);
static DEFAULT_BRANCH_CACHE: LazyLock<TtlCache<String>> = LazyLock::new(TtlCache::new);
static GH_INSTALLED_CACHE: Mutex<Option<(Instant, bool)>> = Mutex::new(None);
static GH_AUTHENTICATED_CACHE: Mutex<Option<(Instant, bool)>> = Mutex::new(None);

// ─── LRU Diff Cache (参考 Muxy DiffCache) ─────────────────────────────────
// 正确性靠「输入指纹」自洽：工作区 diff 命中时校验文件 mtime+size，
// 不一致即重算，不依赖任何事件失效（事件只影响新鲜度，不影响正确性）。

const DIFF_CACHE_CAP: usize = 50;

/// 工作区文件输入指纹：mtime（纳秒）+ 大小。
/// 缓存命中时重新 stat 当前文件并对比，决定是否仍新鲜。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileFingerprint {
    /// 文件修改时间（UNIX epoch 以来的纳秒数）。
    pub mtime_ns: u64,
    /// 文件字节大小。
    pub size: u64,
}

/// 捕获当前文件的 (mtime_ns, size) 指纹；文件不存在返回 None。
#[must_use]
pub fn capture_file_fingerprint(repo_path: &Path, file_path: &str) -> Option<FileFingerprint> {
    let meta = std::fs::metadata(repo_path.join(file_path)).ok()?;
    let mtime_ns = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| u64::try_from(d.as_nanos()).unwrap_or(u64::MAX))
        .unwrap_or(0);
    Some(FileFingerprint {
        mtime_ns,
        size: meta.len(),
    })
}

/// 缓存条目：指纹为 None 表示「计算时文件不存在」（None↔Some 变化同样触发重算）。
#[derive(Debug, Clone)]
struct DiffEntry {
    result: DiffResult,
    fingerprint: Option<FileFingerprint>,
}

struct LruCache {
    map: Mutex<HashMap<String, usize>>,
    queue: Mutex<VecDeque<(String, DiffEntry)>>,
}

impl LruCache {
    fn new() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
            queue: Mutex::new(VecDeque::new()),
        }
    }

    fn get(&self, key: &str) -> Option<DiffEntry> {
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

    fn set(&self, key: String, val: DiffEntry) {
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
        queue: &VecDeque<(String, DiffEntry)>,
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

fn diff_cache_key(repo_path: &Path, file_path: &str, collapse: bool) -> String {
    format!(
        "{}:{}:collapse={}",
        repo_path.to_string_lossy(),
        file_path,
        collapse
    )
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

/// Get cached worktree diff or compute — 输入指纹校验版。
///
/// 命中时重新 stat 当前文件，指纹（mtime+size）一致才返回缓存；不一致则重算并刷新。
/// 正确性自洽，不依赖任何事件失效；文件删除/新增（Some↔None）同样触发重算。
/// 仅在 `spawn_blocking` 内调用（内部含 `std::fs::metadata` 阻塞 I/O）。
pub fn get_cached_worktree_diff(
    repo_path: &Path,
    file_path: &str,
    collapse: bool,
    fetch: impl FnOnce() -> anyhow::Result<DiffResult>,
) -> anyhow::Result<DiffResult> {
    let key = diff_cache_key(repo_path, file_path, collapse);
    if let Some(entry) = DIFF_CACHE.get(&key) {
        if capture_file_fingerprint(repo_path, file_path) == entry.fingerprint {
            return Ok(entry.result);
        }
    }
    let fingerprint = capture_file_fingerprint(repo_path, file_path);
    let result = fetch()?;
    DIFF_CACHE.set(
        key,
        DiffEntry {
            result: result.clone(),
            fingerprint,
        },
    );
    Ok(result)
}

// ─── Public get/set for async pattern (no closure) ────────────────────────────

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

/// Invalidate all caches for a repo (called after write operations)
pub fn invalidate_repo_caches(repo_path: &Path) {
    PR_LIST_CACHE.invalidate_repo(repo_path);
    PR_INFO_CACHE.invalidate_repo(repo_path);
    REPO_LABELS_CACHE.invalidate_repo(repo_path);
    REPO_AUTHORS_CACHE.invalidate_repo(repo_path);
    DEFAULT_BRANCH_CACHE.invalidate_repo(repo_path);
    DIFF_CACHE.invalidate_repo(repo_path);
    DIFF_STATS_CACHE.invalidate_repo(repo_path);
    AHEAD_BEHIND_CACHE.invalidate_repo(repo_path);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// 返回一个 fetch 闭包：每次真正执行都会记录 label，命中缓存时不执行（不记录）。
    fn fetch_with_label(
        computed: Arc<Mutex<Vec<String>>>,
        label: &'static str,
    ) -> impl FnOnce() -> anyhow::Result<DiffResult> {
        move || {
            computed.lock().unwrap().push(label.to_string());
            Ok(DiffResult {
                hunks: vec![],
                truncated: label.is_empty(),
            })
        }
    }

    #[test]
    fn worktree_diff_hits_cache_when_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        let file = "a.txt";
        std::fs::write(repo.join(file), "hello").unwrap();
        let computed = Arc::new(Mutex::new(Vec::new()));

        get_cached_worktree_diff(
            repo,
            file,
            true,
            fetch_with_label(computed.clone(), "first"),
        )
        .unwrap();
        get_cached_worktree_diff(
            repo,
            file,
            true,
            fetch_with_label(computed.clone(), "second"),
        )
        .unwrap();

        assert_eq!(
            *computed.lock().unwrap(),
            vec!["first".to_string()],
            "文件未变时第二次调用必须命中缓存（fetch 只执行一次）"
        );
    }

    #[test]
    fn worktree_diff_recomputes_when_file_changed() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        let file = "a.txt";
        std::fs::write(repo.join(file), "hello").unwrap();
        let computed = Arc::new(Mutex::new(Vec::new()));

        get_cached_worktree_diff(
            repo,
            file,
            true,
            fetch_with_label(computed.clone(), "hello"),
        )
        .unwrap();
        // 修改文件（内容 + 尺寸都变，保证指纹变化与 mtime 粒度无关）
        std::fs::write(repo.join(file), "much longer content").unwrap();
        get_cached_worktree_diff(repo, file, true, fetch_with_label(computed.clone(), "new"))
            .unwrap();

        assert_eq!(
            *computed.lock().unwrap(),
            vec!["hello".to_string(), "new".to_string()],
            "文件已修改时指纹不一致必须重算（回归：旧实现命中旧缓存）"
        );
    }

    #[test]
    fn worktree_diff_recomputes_when_file_removed() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        let file = "a.txt";
        let path = repo.join(file);
        std::fs::write(&path, "hello").unwrap();
        let computed = Arc::new(Mutex::new(Vec::new()));

        get_cached_worktree_diff(
            repo,
            file,
            true,
            fetch_with_label(computed.clone(), "exists"),
        )
        .unwrap();
        std::fs::remove_file(&path).unwrap();
        get_cached_worktree_diff(
            repo,
            file,
            true,
            fetch_with_label(computed.clone(), "removed"),
        )
        .unwrap();

        assert_eq!(
            *computed.lock().unwrap(),
            vec!["exists".to_string(), "removed".to_string()],
            "文件被删除后指纹变化（Some→None）必须重算"
        );
    }

    #[test]
    fn worktree_diff_collapse_is_separate_key() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        let file = "a.txt";
        std::fs::write(repo.join(file), "hello").unwrap();
        let computed = Arc::new(Mutex::new(Vec::new()));

        get_cached_worktree_diff(
            repo,
            file,
            true,
            fetch_with_label(computed.clone(), "collapsed"),
        )
        .unwrap();
        get_cached_worktree_diff(
            repo,
            file,
            false,
            fetch_with_label(computed.clone(), "full"),
        )
        .unwrap();

        assert_eq!(
            *computed.lock().unwrap(),
            vec!["collapsed".to_string(), "full".to_string()],
            "collapse 不同应各自缓存（键隔离）"
        );
    }
}
