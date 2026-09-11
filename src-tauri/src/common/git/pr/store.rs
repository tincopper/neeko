//! PR provider 的进程级缓存（仓库路径 → 已解析 provider）。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::common::git::provider::get_git_provider;
use crate::common::types::GitProvider;

static PROVIDER_STORE: OnceLock<Mutex<HashMap<PathBuf, GitProvider>>> = OnceLock::new();

fn store() -> &'static Mutex<HashMap<PathBuf, GitProvider>> {
    PROVIDER_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 缓存优先，未命中时通过 `get_git_provider` 检测并缓存
#[must_use]
pub fn resolve_provider(repo_path: &Path) -> GitProvider {
    if let Some(p) = store().lock().ok().and_then(|m| m.get(repo_path).copied()) {
        return p;
    }
    let p = get_git_provider(repo_path).unwrap_or(GitProvider::Unknown);
    if let Ok(mut guard) = store().lock() {
        guard.insert(repo_path.to_path_buf(), p);
    }
    p
}

/// 由 `get_git_info` 在刷新时注入已解析的 provider
pub fn set_cached_provider(repo_path: &Path, provider: GitProvider) {
    if let Ok(mut guard) = store().lock() {
        guard.insert(repo_path.to_path_buf(), provider);
    }
}

/// 缓存失效（当 git remote 变更时）
pub fn invalidate_provider_cache(repo_path: &Path) {
    if let Ok(mut guard) = store().lock() {
        guard.remove(repo_path);
    }
}
