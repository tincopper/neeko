use anyhow::Result;

use crate::common::utils::command::local::safe_path;
use crate::common::utils::command::wsl::{exec, open_ide};
use crate::project::types::FileNode;

use super::parsers::build_file_tree_from_find;

/// 通过 WSL 打开 IDE
pub fn open_wsl_ide(distro: &str, project_path: &str, ide: &str) -> Result<()> {
    open_ide(distro, project_path, ide)
}

/// 通过 WSL 读取目录树（使用 find 命令）
pub fn wsl_read_dir_tree(
    distro: &str,
    root_path: &str,
    sub_path: Option<&str>,
    max_depth: u32,
) -> Result<Vec<FileNode>> {
    let effective_sub = sub_path.filter(|sp| !sp.is_empty());
    let actual_path = match effective_sub {
        Some(sp) => format!("{}/{}", root_path, sp),
        None => root_path.to_string(),
    };
    let safe_ap = safe_path(&actual_path);
    let safe_root = safe_path(root_path);

    let cmd = format!(
        "find '{safe_ap}' -maxdepth {max_depth} \
         -not -path '*/.git/*' \
         -not -path '*/node_modules/*' \
         -not -path '*/target/*' \
         -not -name '.git' \
          2>/dev/null | sort"
    );
    let output = exec(distro, &cmd)?;

    // Build tree from flat path list，路径相对于 actual_path
    let mut tree = build_file_tree(&output, &actual_path, &safe_root)?;

    // 如果使用了 sub_path，需要将路径修正为相对于项目根的完整路径
    if let Some(sp) = effective_sub {
        prefix_paths(&mut tree, sp);
    }

    Ok(tree)
}

/// 递归给所有节点的 path 字段加上前缀（确保路径相对于项目根）
fn prefix_paths(nodes: &mut Vec<FileNode>, prefix: &str) {
    for node in nodes.iter_mut() {
        node.path = format!("{}/{}", prefix, node.path);
        if !node.children.is_empty() {
            prefix_paths(&mut node.children, prefix);
        }
    }
}

fn build_file_tree(find_output: &str, root_path: &str, _safe_root: &str) -> Result<Vec<FileNode>> {
    build_file_tree_from_find(find_output, root_path)
}
