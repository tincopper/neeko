//! tree_read：目录树读取、远程子路径校验与读层 gitignore 过滤器测试。

use super::super::tree_read::{
    build_find_tree_command, read_dir_recursive, validate_remote_sub_path,
};
use super::temp_root;
use crate::common::executor::factory::ExecTarget;
use crate::common::file::watcher::GitIgnoreFilter;
use crate::AppError;
use std::fs;
use std::sync::Arc;

#[tokio::test]
async fn read_dir_tree_local_reads_tree_from_blocking_task() {
    let root = temp_root("tree_local_async");
    fs::create_dir_all(root.join("src/inner")).expect("创建 src/inner 失败");
    fs::write(root.join("src/inner/a.rs"), "fn main() {}").expect("写入 a.rs 失败");
    fs::write(root.join("top.txt"), "x").expect("写入 top.txt 失败");

    let tree = crate::common::file::services::read_dir_tree(
        "local-block-test",
        &ExecTarget::Local,
        root.to_str().unwrap(),
        None,
        3,
        None,
    )
    .await
    .expect("async 读取目录树失败");
    let names: Vec<&str> = tree.iter().map(|n| n.name.as_str()).collect();
    assert!(names.contains(&"src"), "普通目录应保留: {names:?}");
    assert!(names.contains(&"top.txt"), "普通文件应保留: {names:?}");

    let sub_tree = crate::common::file::services::read_dir_tree(
        "local-block-test",
        &ExecTarget::Local,
        root.to_str().unwrap(),
        Some("src/inner"),
        3,
        None,
    )
    .await
    .expect("async 读取 sub_path 失败");
    assert_eq!(sub_tree.len(), 1, "sub_path 懒加载应只返回目标层节点");
    assert_eq!(sub_tree[0].name, "a.rs");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn validate_remote_sub_path_rejects_traversal_and_invalid_segments() {
    for invalid in [
        "../../etc",
        "/etc",
        "..",
        "src/../etc",
        "src//sub",
        "src/./sub",
        "src\\..\\sub",
        "src\0sub",
    ] {
        assert!(
            validate_remote_sub_path(invalid).is_err(),
            "sub_path 必须拒绝越界或非法输入: {invalid}"
        );
    }
}

#[tokio::test]
async fn read_dir_tree_wsl_rejects_traversal_before_remote_command() {
    let wsl = ExecTarget::Wsl {
        distro: "Ubuntu-22.04".to_string(),
    };
    let err = crate::common::file::services::read_dir_tree(
        "traversal-test",
        &wsl,
        "/home/user/project",
        Some("../../etc"),
        1,
        None,
    )
    .await
    .expect_err("WSL sub_path 穿越必须失败");
    assert!(
        matches!(err, AppError::File(ref message) if message.contains("Invalid sub path outside root directory")),
        "应在进入远程命令执行前返回路径越界错误: {err:?}"
    );
}

#[test]
fn validate_remote_sub_path_accepts_normal_relative_path() {
    assert!(validate_remote_sub_path("src/sub").is_ok());
    assert!(validate_remote_sub_path("docs/中文 目录/file.md").is_ok());
}

#[test]
fn read_dir_tree_excludes_git_meta_directory() {
    let root = temp_root("tree_git_exclude");
    // .git 元数据目录：git status --ignored 永不报告它，必须由后端排除
    fs::create_dir_all(root.join(".git/objects")).expect("创建 .git 测试目录失败");
    fs::write(root.join(".git/HEAD"), "ref: refs/heads/main").expect("写入 .git/HEAD 失败");
    // 普通文件与依赖目录应保留（node_modules 改由前端 .gitignore 灰显）
    fs::write(root.join("a.txt"), "hello").expect("写入 a.txt 失败");
    fs::create_dir_all(root.join("node_modules/pkg")).expect("创建 node_modules 测试目录失败");
    fs::write(root.join("node_modules/pkg/index.js"), "x").expect("写入 index.js 失败");

    let tree = read_dir_recursive(&root, &root, 3, None).expect("读取测试目录树失败");
    let names: Vec<&str> = tree.iter().map(|n| n.name.as_str()).collect();
    assert!(
        !names.contains(&".git"),
        ".git 元数据目录不应出现在文件树中: {:?}",
        names
    );
    assert!(names.contains(&"a.txt"), "普通文件应保留");
    assert!(
        names.contains(&"node_modules"),
        "node_modules 不再由后端硬编码排除，应保留供前端灰显: {:?}",
        names
    );
    let _ = fs::remove_dir_all(&root);
}

/// 回归（S1-2 读前剪枝）：ignored 目录只保留灰显节点，不再递归 children ——
/// 大仓库的 node_modules/target 在 depth 内可能有数千条目，
/// 先扫后剪等于白付全部 IO 与内存。
#[test]
fn read_dir_tree_prunes_ignored_dirs_before_descending() {
    let root = temp_root("tree_prune_before_descend");
    fs::create_dir_all(root.join("target/debug/deps")).expect("创建 target 深层目录失败");
    for i in 0..5 {
        fs::write(root.join(format!("target/debug/deps/lib_{i}.o")), "x")
            .expect("写入深层文件失败");
    }
    fs::write(root.join("src.rs"), "fn main() {}").expect("写入 src.rs 失败");
    fs::write(root.join(".gitignore"), "target/\n").expect("写入 .gitignore 失败");

    let filter = GitIgnoreFilter::new(root.clone());
    let tree = read_dir_recursive(&root, &root, 3, Some(&filter)).expect("读取目录树失败");

    // 3 节点：target（灰显）+ src.rs + .gitignore（合法工作文件）
    assert_eq!(
        tree.len(),
        3,
        "应恰好有 target / src.rs / .gitignore 三个顶层节点"
    );
    let target_node = tree.iter().find(|n| n.name == "target").unwrap();
    assert!(
        target_node.is_dir && target_node.children.is_empty() && target_node.ignored,
        "ignored 目录节点必须保留、children 为空且带 ignored 标记，实际: {:?}",
        target_node
    );

    // 对照：无 gitignore 时深层内容正常展开
    let full = read_dir_recursive(&root, &root, 3, None).unwrap();
    let target_full = full.iter().find(|n| n.name == "target").unwrap();
    assert!(
        !target_full.children.is_empty(),
        "无 ignored 时深层内容应正常展开"
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn find_tree_command_excludes_git_but_keeps_others() {
    let cmd = build_find_tree_command("/safe/path", 3);
    assert!(
        cmd.contains("-not -path '*/.git/*'"),
        "find 应排除 .git 内部内容: {}",
        cmd
    );
    assert!(
        cmd.contains("-not -name '.git'"),
        "find 应排除 .git 条目本身: {}",
        cmd
    );
    assert!(
        !cmd.contains("*/node_modules/*"),
        "node_modules 不再由后端 find 排除: {}",
        cmd
    );
    assert!(cmd.contains("-maxdepth 3"), "应保留最大深度: {}", cmd);
}

// ── 读层 gitignore 过滤器解析（watcher 挂载 race 兜底）─────────────────

/// 回归（切换项目 → 文件树首载与 watcher 挂载并发）：watcher 未挂载时
/// 读层必须现场构建 gitignore 过滤器，否则首屏文件树无 ignored 标注，
/// 且结果被 dirCache 缓存为 loaded，灰显只能靠手动刷新修复。
#[tokio::test]
async fn resolve_gitignore_filter_builds_fallback_for_local_git_repo() {
    let root = temp_root("gitignore_fallback_build");
    fs::create_dir_all(root.join(".git")).expect("创建 .git 测试目录失败");
    fs::write(root.join(".gitignore"), "*.log\n").expect("写入 .gitignore 失败");
    fs::write(root.join("debug.log"), "").expect("写入 debug.log 失败");

    let filter =
        crate::common::file::services::resolve_gitignore_filter(&ExecTarget::Local, None, &root)
            .await
            .expect("本地 git 仓库必须构建兜底过滤器");
    assert!(
        filter.should_ignore_own(&root.join("debug.log"), false),
        "兜底过滤器必须具备 gitignore 语义"
    );
    let _ = fs::remove_dir_all(&root);
}

/// 非 git 目录不构建过滤器（保持「仅 .git 硬过滤」退化语义）。
#[tokio::test]
async fn resolve_gitignore_filter_returns_none_for_non_git_dir() {
    let root = temp_root("gitignore_fallback_non_git");
    let filter =
        crate::common::file::services::resolve_gitignore_filter(&ExecTarget::Local, None, &root)
            .await;
    assert!(filter.is_none(), "非 git 目录不应构建过滤器");
    let _ = fs::remove_dir_all(&root);
}

/// watcher 已挂载时必须复用共享过滤器（与事件过滤 / 规则热重载同源），不得重建。
#[tokio::test]
async fn resolve_gitignore_filter_reuses_existing_watcher_filter() {
    let root = temp_root("gitignore_fallback_existing");
    fs::create_dir_all(root.join(".git")).expect("创建 .git 测试目录失败");
    let shared = Arc::new(GitIgnoreFilter::new(root.clone()));
    let resolved = crate::common::file::services::resolve_gitignore_filter(
        &ExecTarget::Local,
        Some(Arc::clone(&shared)),
        &root,
    )
    .await
    .expect("已有过滤器必须原样返回");
    assert!(
        Arc::ptr_eq(&shared, &resolved),
        "应复用 watcher 共享过滤器，而非重建"
    );
    let _ = fs::remove_dir_all(&root);
}

/// WSL/Remote 的 ignored 标注走远程 `git ls-files`，不构建本地兜底过滤器
/// （远程路径可能恰好以本地挂载/UNC 形式存在，误判会引入无谓的全树遍历）。
#[tokio::test]
async fn resolve_gitignore_filter_never_builds_fallback_for_remote_targets() {
    let root = temp_root("gitignore_fallback_remote");
    fs::create_dir_all(root.join(".git")).expect("创建 .git 测试目录失败");
    let wsl = ExecTarget::Wsl {
        distro: "Ubuntu-22.04".to_string(),
    };
    assert!(
        crate::common::file::services::resolve_gitignore_filter(&wsl, None, &root)
            .await
            .is_none(),
        "WSL 目标不应构建本地兜底过滤器"
    );
    let _ = fs::remove_dir_all(&root);
}

// ── S5：GitIgnoreFilter 读层语义 ────────────────────────────────────────

/// 部分忽略：仅命中的子目录被剪枝 + 标记，兄弟保留
#[test]
fn read_dir_recursive_partial_ignore_only_prunes_matched_dir() {
    let root = temp_root("filter_partial_ignore");
    fs::create_dir_all(root.join("sub/deep")).unwrap();
    fs::write(root.join("sub/deep/cache.dat"), "x").unwrap();
    fs::write(root.join("sub/keep.txt"), "x").unwrap();
    fs::write(root.join(".gitignore"), "sub/deep\n").unwrap();

    let filter = GitIgnoreFilter::new(root.clone());
    let tree = read_dir_recursive(&root, &root, 3, Some(&filter)).unwrap();
    let sub = &tree[0];
    assert_eq!(sub.children.len(), 2, "sub 自身未命中，children 应保留");
    let deep = &sub.children[0];
    assert!(
        deep.ignored && deep.children.is_empty(),
        "sub/deep 命中 → 剪枝 + 标记"
    );
    assert_eq!(sub.children[1].name, "keep.txt", "未忽略项保留且不标记");
    let _ = fs::remove_dir_all(&root);
}

/// 穿透语义：展开一个被忽略目录（懒加载以该目录为根）时，其内容按自身路径
/// 判定（不继承父链命中）——否则 ignored 目录展开后全部灰显/剪枝。
#[test]
fn read_dir_recursive_expand_inside_ignored_dir_keeps_children_visible() {
    let root = temp_root("filter_passthrough");
    fs::create_dir_all(root.join("node_modules/lodash")).unwrap();
    fs::write(root.join("node_modules/lodash/index.js"), "x").unwrap();
    fs::write(root.join(".gitignore"), "node_modules/\n").unwrap();

    let filter = GitIgnoreFilter::new(root.clone());
    // 懒加载：根 = node_modules 本身，depth=2 覆盖到孙子
    let tree = read_dir_recursive(&root.join("node_modules"), &root, 2, Some(&filter)).unwrap();
    assert_eq!(tree.len(), 1);
    assert!(
        !tree[0].ignored && !tree[0].children.is_empty(),
        "展开目标目录的内容不应被父链命中剪枝: {:?}",
        tree[0]
    );
    let _ = fs::remove_dir_all(&root);
}

/// 被忽略的文件保留节点并标记（灰显输入）
#[test]
fn read_dir_recursive_marks_ignored_files() {
    let root = temp_root("filter_ignored_file");
    fs::write(root.join(".env"), "secret").unwrap();
    fs::write(root.join(".gitignore"), ".env\n").unwrap();

    let filter = GitIgnoreFilter::new(root.clone());
    let tree = read_dir_recursive(&root, &root, 1, Some(&filter)).unwrap();
    assert_eq!(tree.len(), 2, "被忽略文件与 .gitignore 本身都保留节点");
    let env = tree.iter().find(|n| n.name == ".env").unwrap();
    assert!(env.ignored, "ignored 文件应带标记供前端灰显");
    let gitignore = tree.iter().find(|n| n.name == ".gitignore").unwrap();
    assert!(!gitignore.ignored, ".gitignore 本身是工作文件，不标记");
    let _ = fs::remove_dir_all(&root);
}
