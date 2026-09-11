//! WSL/Remote ignored 路径的进程级缓存与远程获取。
//!
//! 远程端 `git ls-files --ignored` 获取被忽略路径集合，供文件树标记 + 剪枝
//! （与 Local `GitIgnoreFilter` 同语义）；watcher 失效是主失效路径，TTL 仅兜底。

use crate::common::executor::factory::ExecTarget;
use crate::common::utils::command::local::safe_path;
use crate::core::exec::collect;
use crate::project::types::FileNode;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use super::shell_cmd::remote_shell_name;

/// 远程 ignored 路径解析上限：异常仓库 / 异常输出不能造成无界内存增长。
pub(super) const MAX_IGNORED_PATHS: usize = 100_000;

/// Remote ignored 查询缓存兜底 TTL；watcher 失效是主路径。
pub(super) const REMOTE_IGNORED_PATHS_TTL: Duration = Duration::from_secs(30);

#[derive(Clone, PartialEq, Eq, Hash)]
pub(super) struct RemoteIgnoredCacheKey {
    pub(super) project_id: String,
    pub(super) target_id: String,
    pub(super) root_path: String,
}

pub(super) struct CachedRemoteIgnoredPaths {
    pub(super) paths: HashSet<String>,
    pub(super) fetched_at: Instant,
}

pub(super) fn remote_ignored_cache(
) -> &'static Mutex<HashMap<RemoteIgnoredCacheKey, CachedRemoteIgnoredPaths>> {
    static CACHE: OnceLock<Mutex<HashMap<RemoteIgnoredCacheKey, CachedRemoteIgnoredPaths>>> =
        OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 项目级 cache generation：失效时递增，阻止 in-flight fetch 回插 stale 数据。
fn remote_ignored_cache_generations() -> &'static Mutex<HashMap<String, u64>> {
    static GENERATIONS: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
    GENERATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn current_remote_ignored_cache_generation(project_id: &str) -> u64 {
    remote_ignored_cache_generations()
        .lock()
        .ok()
        .and_then(|generations| generations.get(project_id).copied())
        .unwrap_or(0)
}

fn next_remote_ignored_cache_generation(project_id: &str) -> u64 {
    let mut generations = remote_ignored_cache_generations()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let next = generations.get(project_id).copied().unwrap_or(0) + 1;
    generations.insert(project_id.to_string(), next);
    next
}

/// 缓存 target 身份只保留稳定非敏感信息，不缓存认证凭据。
pub(super) fn remote_target_id(target: &ExecTarget) -> Option<String> {
    match target {
        ExecTarget::Local => None,
        ExecTarget::Wsl { distro } => Some(format!("wsl:{distro}")),
        ExecTarget::Remote {
            host,
            port,
            username,
            auth: _,
        } => Some(format!("remote:{username}@{host}:{port}")),
    }
}

pub(super) fn is_remote_ignored_cache_fresh(fetched_at: Instant, now: Instant) -> bool {
    now.duration_since(fetched_at) < REMOTE_IGNORED_PATHS_TTL
}

/// 清除一个项目的 remote ignored 缓存。
/// watcher 规则变化与 unwatch 时必须调用，避免 ignored 标记 / 剪枝 stale。
pub fn invalidate_remote_ignored_cache(project_id: &str) {
    if let Ok(mut cache) = remote_ignored_cache().lock() {
        cache.retain(|key, _| key.project_id != project_id);
    }
    next_remote_ignored_cache_generation(project_id);
}

/// 同 key fetch 的 single-flight 锁：避免并发 cache miss 重复执行 remote 查询。
fn remote_ignored_fetch_locks(
) -> &'static Mutex<HashMap<RemoteIgnoredCacheKey, Arc<tokio::sync::Mutex<()>>>> {
    static FETCH_LOCKS: OnceLock<
        Mutex<HashMap<RemoteIgnoredCacheKey, Arc<tokio::sync::Mutex<()>>>>,
    > = OnceLock::new();
    FETCH_LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 使用进程级缓存读取 WSL / Remote ignored 路径。
/// 同一 project + target + root 在 TTL 内复用；同 key miss 通过 single-flight 合并。
pub(super) async fn get_or_fetch_remote_ignored_paths<F, Fut>(
    project_id: &str,
    target: &ExecTarget,
    root_path: &str,
    fetch: F,
) -> HashSet<String>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = HashSet<String>>,
{
    let Some(target_id) = remote_target_id(target) else {
        return fetch().await;
    };
    let key = RemoteIgnoredCacheKey {
        project_id: project_id.to_string(),
        target_id,
        root_path: root_path.to_string(),
    };

    if let Ok(cache) = remote_ignored_cache().lock() {
        if let Some(entry) = cache.get(&key) {
            if is_remote_ignored_cache_fresh(entry.fetched_at, Instant::now()) {
                return entry.paths.clone();
            }
        }
    }

    // 登记锁时只短暂持有 std Mutex；跨 await 等待使用 tokio Mutex。
    let fetch_lock = {
        let mut locks = remote_ignored_fetch_locks()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        locks.entry(key.clone()).or_default().clone()
    };
    let _fetch_guard = fetch_lock.lock().await;

    // 等锁期间前一个请求可能已完成插入，必须二次检查。
    if let Ok(cache) = remote_ignored_cache().lock() {
        if let Some(entry) = cache.get(&key) {
            if is_remote_ignored_cache_fresh(entry.fetched_at, Instant::now()) {
                drop(_fetch_guard);
                if Arc::strong_count(&fetch_lock) == 1 {
                    remote_ignored_fetch_locks()
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .remove(&key);
                }
                return entry.paths.clone();
            }
        }
    }

    let generation = current_remote_ignored_cache_generation(project_id);
    let paths = fetch().await;
    if current_remote_ignored_cache_generation(project_id) == generation {
        if let Ok(mut cache) = remote_ignored_cache().lock() {
            cache.insert(
                key.clone(),
                CachedRemoteIgnoredPaths {
                    paths: paths.clone(),
                    fetched_at: Instant::now(),
                },
            );
        }
    }

    drop(_fetch_guard);
    if Arc::strong_count(&fetch_lock) == 1 {
        remote_ignored_fetch_locks()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&key);
    }
    paths
}

/// 构建远程 `git ls-files --ignored` 命令（路径已 safe_path 转义）。
/// `--directory` 将整个被忽略目录折叠为单条路径；`--exclude-standard` 尊重
/// `.gitignore` / `.git/info/exclude` / 全局排除。输出为相对项目根的路径，
/// 目录带尾斜杠（`node_modules/`）。
pub(super) fn build_git_ignored_command(safe_root: &str) -> String {
    format!(
        "cd '{safe_root}' && git ls-files --others --ignored --exclude-standard --directory 2>/dev/null"
    )
}

/// 远程获取被忽略路径集合（相对项目根，尾斜杠已去除）。
/// 非 git 项目 / git 不可用时返回空集合（树保持原样，退化为仅 .git 硬过滤）。
pub(super) async fn fetch_remote_ignored_paths(
    target: &ExecTarget,
    root_path: &str,
) -> HashSet<String> {
    let safe_root = safe_path(root_path);
    let cmd = build_git_ignored_command(&safe_root);
    let shell = remote_shell_name(target);
    let output = collect(target, shell, &["-c", &cmd], None).await;
    match output {
        Ok(out) if out.exit_code == 0 => {
            parse_remote_ignored_output(&String::from_utf8_lossy(&out.stdout))
        }
        _ => HashSet::new(),
    }
}

/// 解析远程 `git ls-files --ignored` 输出，并强制容量上限。
pub(super) fn parse_remote_ignored_output(output: &str) -> HashSet<String> {
    let mut paths = HashSet::with_capacity(64);
    for line in output.lines() {
        let path = line.trim_end_matches('/');
        if path.is_empty() {
            continue;
        }
        if paths.len() >= MAX_IGNORED_PATHS {
            log::warn!(
                "Remote ignored paths exceeded capacity; truncated at {} entries",
                MAX_IGNORED_PATHS
            );
            break;
        }
        paths.insert(path.to_string());
    }
    paths
}

/// 将被忽略路径集合应用到文件树：命中节点标记 `ignored` 并清空 children
/// （保留灰显节点但不递归后代，与 Local 读前剪枝语义一致）。
/// 剪枝只作用于匹配节点自身 —— 子路径不在集合内时正常展开。
pub(super) fn apply_ignored_to_tree(
    tree: &mut [FileNode],
    ignored_set: &std::collections::HashSet<String>,
) {
    for node in tree.iter_mut() {
        if ignored_set.contains(&node.path) {
            node.ignored = true;
            node.children.clear();
        } else if node.is_dir && !node.children.is_empty() {
            apply_ignored_to_tree(&mut node.children, ignored_set);
        }
    }
}
