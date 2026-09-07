//! 统一目录树读取：Local 走 fs 递归（读前剪枝 + ignored 标注），WSL/Remote 走
//! 远程 `find` + `git ls-files --ignored`；含读层 gitignore 过滤器解析兜底。

use crate::common::executor::factory::ExecTarget;
use crate::common::executor::sync::collect_output;
use crate::common::git::parsers::build_file_tree_from_find;
use crate::common::utils::command::local::safe_path;
use crate::project::types::FileNode;
use crate::AppError;
use std::path::{Path, PathBuf};
use std::sync::Arc;

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
            let output = collect_output(target, shell, &["-c", &cmd])
                .await
                .map_err(|e| AppError::File(format!("Failed to read dir tree: {}", e)))?;

            // find 非零退出（如个别目录无权限）不代表整树失败：stdout 仍包含已扫描路径。
            // 故用 collect_output（保留非零退出）而非 exec_on（非零即 Err），避免整树被丢弃。
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

/// 解析读层 gitignore 过滤器（读层自洽，不依赖 watcher 挂载时序）。
///
/// - watcher 已挂载 → 复用共享过滤器（与事件过滤 / 规则热重载同源）；
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
    existing: Option<Arc<crate::common::file::watcher::GitIgnoreFilter>>,
    base: &Path,
) -> Option<Arc<crate::common::file::watcher::GitIgnoreFilter>> {
    if existing.is_some() || !matches!(target, ExecTarget::Local) {
        return existing;
    }
    let root = base.to_path_buf();
    tokio::task::spawn_blocking(move || {
        if !crate::common::git::local::is_git_repo(&root) {
            return None;
        }
        Some(Arc::new(
            crate::common::file::watcher::GitIgnoreFilter::new(root),
        ))
    })
    .await
    .ok()
    .flatten()
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
