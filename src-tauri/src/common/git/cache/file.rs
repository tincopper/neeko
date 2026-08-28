#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use crate::common::git::types::DiffResult;
use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::{LazyLock, Mutex};

use super::key::{diff_cache_key, repo_key_prefix};

// ─── LRU Diff Cache ───────────────────────────────────────────────────────

const DIFF_CACHE_CAP: usize = 50;

/// Worktree file input fingerprint: mtime + size.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileFingerprint {
    /// File modification time (nanoseconds since UNIX epoch).
    pub mtime_ns: u64,
    /// File byte size.
    pub size: u64,
}

/// Capture current file's (mtime_ns, size) fingerprint; None if file missing.
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
                queue.remove(idx);
                queue.push_back((key.to_string(), val.clone()));
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

        if let Some(&idx) = map.get(&key) {
            queue.remove(idx);
        }

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

/// Get cached worktree diff or compute — fingerprint-checked.
///
/// Only calls `fetch` when fingerprint (mtime+size) disagrees or entry missing.
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

/// Invalidate LRU diff cache for a repo.
pub(crate) fn invalidate_file_caches(repo_path: &Path) {
    DIFF_CACHE.invalidate_repo(repo_path);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

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
