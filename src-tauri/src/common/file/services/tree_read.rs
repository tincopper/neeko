//! 统一目录树读取：Local 走 fs 递归（读前剪枝 + ignored 标注），WSL/Remote 走
//! 远程 `find` + `git ls-files --ignored`；含读层 gitignore 过滤器解析兜底。

use crate::common::executor::factory::ExecTarget;
use crate::common::file::watcher::GitIgnoreFilter;
use crate::common::git::parsers::build_file_tree_from_find;
use crate::common::utils::command::local::safe_path;
use crate::core::exec::collect;
use crate::project::types::FileNode;
use crate::AppError;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use super::ignored_cache::{
    apply_ignored_to_tree, fetch_remote_ignored_paths, get_or_fetch_remote_ignored_paths,
};

/// 文件树默认递归深度
pub const DEFAULT_TREE_DEPTH: u32 = 3;

/// 校验 WSL / Remote 文件树懒加载使用的相对子路径。
/// 远程路径无法在本端 canonicalize，必须先用严格语法校验拒绝越界：
/// 仅接受以 `/` 分隔、不含穿越段或分隔符变体的普通相对路径。
pub(super) fn validate_remote_sub_path(sub_path: &str) -> Result<(), AppError> {
    if sub_path.is_empty()
        || sub_path.starts_with('/')
        || sub_path.contains('\\')
        || sub_path.contains('\0')
        || sub_path
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(AppError::File(format!(
            "Invalid sub path outside root directory: {sub_path}"
        )));
    }
    Ok(())
}

/// 统一读取目录树，按 ExecTarget 类型分发。
///
/// Local：`gitignore` 为分层过滤器引用，由命令层从 `WatcherManager::gitignore_for`
/// 取得 —— 读前剪枝 + ignored 标记与 watcher 事件过滤共用同一份规则。
/// WSL/Remote：通过远程 `git ls-files` 获取被忽略路径集合，标记 + 剪枝。
pub async fn read_dir_tree(
    project_id: &str,
    target: &ExecTarget,
    root_path: &str,
    sub_path: Option<&str>,
    max_depth: u32,
    gitignore: Option<&crate::common::file::watcher::GitIgnoreFilter>,
) -> Result<Vec<FileNode>, AppError> {
    match target {
        ExecTarget::Local => {
            let base = PathBuf::from(root_path);
            let target_path = match sub_path {
                Some(sp) => base.join(sp),
                None => base.clone(),
            };
            crate::common::utils::path_resolver::validate_within_root(&target_path, &base)?;
            // 读前剪枝（S1-2）：进入 ignored 目录前即停止递归 —— 大仓库的
            // node_modules/target 在 depth 内可能有数千条目，先扫后剪等于白付全部 IO。
            // std::fs 递归扫描会阻塞 async driver，必须整体移交 blocking 线程池；
            // GitIgnoreFilter 内部是 Arc 共享，clone 只复制控制块与路径。
            let filter = gitignore.cloned();
            tokio::task::spawn_blocking(move || {
                read_dir_recursive(&target_path, &base, max_depth, filter.as_ref())
            })
            .await
            .map_err(|e| AppError::File(format!("Failed to read directory tree: {}", e)))?
        }
        ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
            let effective_sub = sub_path.filter(|sp| !sp.is_empty());
            if let Some(sp) = effective_sub {
                validate_remote_sub_path(sp)?;
            }
            let actual_path = match effective_sub {
                Some(sp) => format!("{}/{}", root_path, sp),
                None => root_path.to_string(),
            };
            let safe_ap = safe_path(&actual_path);
            let cmd = build_find_tree_command(&safe_ap, max_depth);
            let shell = if matches!(target, ExecTarget::Wsl { .. }) {
                "bash"
            } else {
                "sh"
            };
            let output = collect(target, shell, &["-c", &cmd], None)
                .await
                .map_err(|e| AppError::File(format!("Failed to read dir tree: {}", e)))?;

            // find 非零退出（如个别目录无权限）不代表整树失败：stdout 仍包含已扫描路径。
            // 故用 collect（保留非零退出）而非 run（非零即 Err），避免整树被丢弃。
            let find_output = String::from_utf8_lossy(&output.stdout);
            let mut tree = build_file_tree_from_find(&find_output, &actual_path);
            if let Some(sp) = effective_sub {
                prefix_paths(&mut tree, sp);
            }
            // WSL/Remote gitignore：远程端 git ls-files 获取被忽略路径集合，
            // 标记 + 剪枝（与 Local GitIgnoreFilter 同语义）。
            let ignored_paths =
                get_or_fetch_remote_ignored_paths(project_id, target, root_path, || {
                    fetch_remote_ignored_paths(target, root_path)
                })
                .await;
            apply_ignored_to_tree(&mut tree, &ignored_paths);
            Ok(tree)
        }
    }
}

/// 构建 WSL/Remote 文件树扫描命令。
/// 仅排除 git 元数据目录 `.git`（`git status --ignored` 永不报告它，且不是用户工作文件）；
/// `node_modules`、`target` 等改由前端基于 .gitignore 灰显，不再在后端硬编码排除。
pub(super) fn build_find_tree_command(safe_path: &str, max_depth: u32) -> String {
    format!(
        "find '{safe_path}' -maxdepth {max_depth} \
         -not -path '*/.git/*' \
         -not -name '.git' \
          2>/dev/null | sort"
    )
}

/// 读层现场构建的 gitignore 过滤器缓存（键 = 过滤器根）。
///
/// 只缓存「现场构建」的过滤器：主项目读路径复用 watcher 共享过滤器（不进缓存），
/// 本缓存服务 linked worktree 等根不匹配场景 —— 避免每次读树（含懒加载逐目录
/// 展开）重复全树遍历构建。失效由 watcher 的 worktree 规则变更信号驱动
/// （`invalidate_local_gitignore_cache`），规则变更后下次读树重建 → 规则最新。
static LOCAL_GITIGNORE_CACHE: LazyLock<Mutex<HashMap<PathBuf, Arc<GitIgnoreFilter>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn local_gitignore_cache() -> &'static Mutex<HashMap<PathBuf, Arc<GitIgnoreFilter>>> {
    &LOCAL_GITIGNORE_CACHE
}

/// 清除读层现场构建的 gitignore 过滤器缓存。
///
/// watcher 的 worktree 规则变更（`.gitignore` / `exclude`）时调用，避免 ignored
/// 标记 / 剪枝 stale；主项目读路径复用 watcher 过滤器，不受影响。
pub fn invalidate_local_gitignore_cache() {
    if let Ok(mut cache) = local_gitignore_cache().lock() {
        cache.clear();
    }
}

/// 解析读层 gitignore 过滤器（读层自洽，不依赖 watcher 挂载时序）。
///
/// - watcher 已挂载且过滤器根 == 读取根 → 复用共享过滤器（与事件过滤 /
///   规则热重载同源），并携带热重载；
/// - 读取根 ≠ 共享过滤器根（linked worktree 的 base 在主仓库之外；watcher
///   过滤器根固定在主项目路径，`path.starts_with(level.dir)` 对 worktree 路径
///   永不命中 → worktree 内 ignored 标注恒缺）→ 现场构建以读取根为根的过滤器，
///   结果按 root 进读层缓存（`invalidate_local_gitignore_cache` 失效），避免
///   懒加载逐目录展开时重复全树遍历构建；
/// - watcher 未挂载（切换项目时前端 fire-and-forget 激活与文件树首载并发，
///   watch 尚未完成）且 Local 目标是 git 仓库 → 现场构建兜底，保证首屏
///   文件树即带 ignored 标注 —— 否则无标注的首载结果被前端目录缓存为
///   loaded，灰显只能靠手动刷新修复；
/// - 非 git 目录 / 非 Local 目标（ignored 走远程 `git ls-files`）→ 不构建。
///
/// `is_git_repo`（fs 元数据探测）与 `GitIgnoreFilter::new`（阻塞全树遍历）
/// 均为阻塞 I/O，必须整体移交 blocking 线程执行，禁止进入 async driver。
pub async fn resolve_gitignore_filter(
    target: &ExecTarget,
    existing: Option<Arc<GitIgnoreFilter>>,
    base: &Path,
) -> Option<Arc<GitIgnoreFilter>> {
    // 非 Local 目标的 ignored 标注走远程 `git ls-files`，不构建本地兜底过滤器
    // （远程路径可能恰好以本地挂载/UNC 形式存在，误判会引入无谓的全树遍历）。
    if !matches!(target, ExecTarget::Local) {
        return None;
    }
    // 复用共享过滤器仅当根一致；根不匹配（linked worktree）落到下方现场构建。
    if let Some(filter) = existing {
        if filter.same_root(base) {
            return Some(filter);
        }
    }
    // 读层缓存：同 root 的现场构建复用（worktree 场景每次读树全树遍历成本高）。
    // 规则变更由 invalidate_local_gitignore_cache 清除（core.rs worktree 回调驱动）。
    if let Ok(cache) = local_gitignore_cache().lock() {
        if let Some(cached) = cache.get(base) {
            return Some(Arc::clone(cached));
        }
    }
    let root = base.to_path_buf();
    let built = tokio::task::spawn_blocking(move || {
        if !crate::common::git::local::is_git_repo(&root) {
            return None;
        }
        Some(Arc::new(GitIgnoreFilter::new(root)))
    })
    .await;
    let filter = flatten_join_result(built)?;
    if let Ok(mut cache) = local_gitignore_cache().lock() {
        cache.insert(base.to_path_buf(), Arc::clone(&filter));
    }
    Some(filter)
}

/// `spawn_blocking` join 结果 → 过滤器的退化映射。
///
/// join 失败（runtime 关闭 / 闭包 panic）语义为退化为 `None` = 无过滤器 =
/// 无 ignored 标注（与修复前一致），不掩盖错误。独立纯函数使 join 失败分支可直测。
pub(super) fn flatten_join_result(
    result: Result<Option<Arc<GitIgnoreFilter>>, tokio::task::JoinError>,
) -> Option<Arc<GitIgnoreFilter>> {
    result.ok().flatten()
}

/// 递归给所有节点的 path 字段加上前缀
fn prefix_paths(nodes: &mut [FileNode], prefix: &str) {
    for node in nodes.iter_mut() {
        node.path = format!("{}/{}", prefix, node.path);
        if !node.children.is_empty() {
            prefix_paths(&mut node.children, prefix);
        }
    }
}

/// 本地递归读取目录树：.git 硬过滤 + gitignore 分层过滤器读前剪枝 + ignored 标注。
pub(super) fn read_dir_recursive(
    dir: &Path,
    project_root: &Path,
    depth: u32,
    gitignore: Option<&crate::common::file::watcher::GitIgnoreFilter>,
) -> Result<Vec<FileNode>, AppError> {
    if depth == 0 {
        return Ok(vec![]);
    }

    let mut nodes = Vec::new();

    let entries = std::fs::read_dir(dir)
        .map_err(|e| AppError::File(format!("Failed to read directory: {}", e)))?;

    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy().to_string();

        // git 元数据目录永不进入文件树：git status --ignored 不报告 .git（含 linked
        // worktree 场景的 .git 文件），只能在此排除；node_modules 等改由前端 .gitignore 灰显。
        if name == ".git" {
            continue;
        }

        let file_type = entry
            .file_type()
            .map_err(|e| AppError::File(e.to_string()))?;
        let full_path = entry.path();

        let relative_path = full_path
            .strip_prefix(project_root)
            .map_err(|e| AppError::File(e.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");

        // S5：gitignore 判定走分层过滤器（与 watcher 事件过滤同一份规则）；
        // 命中的目录保留节点（灰显）但不递归 children，命中的文件保留并标记。
        let is_ignored =
            gitignore.is_some_and(|f| f.should_ignore_own(&full_path, file_type.is_dir()));
        if file_type.is_dir() {
            if is_ignored {
                nodes.push(FileNode {
                    name,
                    path: relative_path,
                    is_dir: true,
                    children: vec![],
                    ignored: true,
                });
                continue;
            }
            let children = read_dir_recursive(&full_path, project_root, depth - 1, gitignore)?;
            nodes.push(FileNode {
                name,
                path: relative_path,
                is_dir: true,
                children,
                ignored: false,
            });
        } else {
            nodes.push(FileNode {
                name,
                path: relative_path,
                is_dir: false,
                children: vec![],
                ignored: is_ignored,
            });
        }
    }

    nodes.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            if a.is_dir {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(nodes)
}
