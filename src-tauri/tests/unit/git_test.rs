use git2::{Repository, Signature};
use neeko_lib::common::executor::factory::ExecTarget;
use neeko_lib::common::git::operations;
use neeko_lib::common::git::refs::RefKind;
use neeko_lib::common::git::types::DiffLine;
use neeko_lib::git;
use std::path::PathBuf;
use tempfile::TempDir;

use super::support;

fn create_test_repo() -> (TempDir, Repository) {
    // 确定性测试仓库：仓库级 core.autocrlf=false + 提交 `.gitattributes * -text`，
    // 见 support.rs 头注释（Windows 上 autocrlf=true 会把 git 写操作后的工作区内容转成 CRLF）。
    support::TestRepo::init().into_parts()
}

// --- parse_unified_diff (pure function) ---

#[test]
fn parse_unified_diff_single_hunk() {
    let diff = r#"diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 line1
+added line
 line2
 line3
"#;
    let result = git::parse_unified_diff(diff);
    assert_eq!(result.hunks.len(), 1);
    assert_eq!(result.hunks[0].new_start, 1);
    assert_eq!(result.hunks[0].new_lines, 4);
    assert_eq!(result.hunks[0].old_start, 1);
    assert_eq!(result.hunks[0].old_lines, 3);
    assert_eq!(result.hunks[0].lines.len(), 4); // 1 context + 1 added + 2 context
}

#[test]
fn parse_unified_diff_crlf_input_strips_carriage_returns() {
    // L4 换行边界：diff 解析必须 CRLF 兼容（`\r` 不得泄漏进行内容）。
    let diff =
        "diff --git a/f b/f\r\n--- a/f\r\n+++ b/f\r\n@@ -0,0 +1,2 @@\r\n+line1\r\n+line2\r\n";
    let result = git::parse_unified_diff(diff);
    assert_eq!(result.hunks.len(), 1);
    let added: Vec<&str> = result.hunks[0]
        .lines
        .iter()
        .filter_map(|l| match l {
            DiffLine::Added(s) => Some(s.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(added, vec!["line1", "line2"], "CRLF 行尾不应泄漏 \\r");
}

#[test]
fn parse_unified_diff_empty_input() {
    let result = git::parse_unified_diff("");
    assert!(result.hunks.is_empty());
}

#[test]
fn parse_unified_diff_multiple_hunks() {
    let diff = r#"@@ -1,3 +1,3 @@
 context
-old
+new
 context2
@@ -10,2 +10,3 @@
 line10
+added
 line11
"#;
    let result = git::parse_unified_diff(diff);
    assert_eq!(result.hunks.len(), 2);
}

#[test]
fn parse_unified_diff_removed_lines() {
    let diff = r#"@@ -1,2 +1,1 @@
-removed line
 kept line
"#;
    let result = git::parse_unified_diff(diff);
    assert_eq!(result.hunks.len(), 1);
    let removed: Vec<_> = result.hunks[0]
        .lines
        .iter()
        .filter(|l| matches!(l, DiffLine::Removed(_)))
        .collect();
    assert_eq!(removed.len(), 1);
}

#[test]
fn parse_unified_diff_omitted_line_counts() {
    let diff = r#"@@ -1 +1 @@
-old
+new
"#;
    let result = git::parse_unified_diff(diff);
    assert_eq!(result.hunks.len(), 1);
    assert_eq!(result.hunks[0].old_lines, 1);
    assert_eq!(result.hunks[0].new_lines, 1);
}

// --- is_git_repo ---

#[test]
fn is_git_repo_returns_true_for_repo() {
    let (tmp, _repo) = create_test_repo();
    assert!(git::is_git_repo(tmp.path()));
}

#[test]
fn is_git_repo_returns_false_for_plain_dir() {
    let tmp = TempDir::new().unwrap();
    assert!(!git::is_git_repo(tmp.path()));
}

// --- get_git_info ---

#[test]
fn get_git_info_on_clean_repo() {
    let (tmp, _repo) = create_test_repo();
    let info = git::get_git_info(tmp.path()).unwrap();

    assert!(info.is_clean);
    assert!(info.changed_files.is_empty());
    assert!(!info.current_branch.is_empty());
}

#[test]
fn get_git_info_detects_modified_file() {
    let (tmp, _repo) = create_test_repo();
    std::fs::write(tmp.path().join("README.md"), "# Modified\n").unwrap();

    let info = git::get_git_info(tmp.path()).unwrap();
    assert!(!info.is_clean);
    assert!(info
        .changed_files
        .iter()
        .any(|f| f.path == PathBuf::from("README.md")));
}

#[test]
fn get_git_info_detects_added_file() {
    let (tmp, _repo) = create_test_repo();
    std::fs::write(tmp.path().join("new_file.txt"), "new content\n").unwrap();

    let info = git::get_git_info(tmp.path()).unwrap();
    assert!(!info.is_clean);
    assert!(info
        .changed_files
        .iter()
        .any(|f| f.path == PathBuf::from("new_file.txt")));
}

// --- get_file_diff ---

#[test]
fn get_file_diff_on_modified_file() {
    let (tmp, _repo) = create_test_repo();
    std::fs::write(tmp.path().join("README.md"), "# Modified\n").unwrap();

    let diff = git::get_file_diff(tmp.path(), "README.md", true).unwrap();
    assert!(!diff.hunks.is_empty());
}

#[test]
fn get_file_diff_on_new_file() {
    let (tmp, _repo) = create_test_repo();
    std::fs::write(tmp.path().join("brand_new.txt"), "line1\nline2\n").unwrap();

    let diff = git::get_file_diff(tmp.path(), "brand_new.txt", true).unwrap();
    assert!(!diff.hunks.is_empty());
    let all_added = diff.hunks[0]
        .lines
        .iter()
        .all(|l| matches!(l, DiffLine::Added(_)));
    assert!(all_added);
}

#[tokio::test]
async fn file_diff_new_crlf_file_strips_carriage_returns() {
    // L4 换行边界：工作区字节是不透明平台数据（Windows/autocrlf 下可能是 CRLF）。
    // 新文件（untracked）diff 无 hunk，走 fallback 读工作区字节构建 Added 行，
    // 必须用 `.lines()` 等 CRLF 兼容解析，禁止把 `\r` 泄漏进 diff 视图。
    let (tmp, _repo) = create_test_repo();
    let path = tmp.path().to_string_lossy().to_string();
    std::fs::write(tmp.path().join("crlf.txt"), "line1\r\nline2\r\n").unwrap();

    let transport = ExecTarget::Local;
    let result = operations::get_file_diff(&transport, &path, "crlf.txt", false)
        .await
        .expect("file diff on new CRLF file should succeed");

    let added: Vec<&str> = result
        .hunks
        .iter()
        .flat_map(|h| h.lines.iter())
        .filter_map(|l| match l {
            DiffLine::Added(s) => Some(s.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(added, vec!["line1", "line2"], "CRLF 行尾不应泄漏 \\r");
}

// --- get_changed_files_diff_stats (numstat) ---

#[test]
fn diff_stats_detects_modified_file() {
    let (tmp, _repo) = create_test_repo();

    // 修改已跟踪文件，增加 1 行，删除 1 行
    std::fs::write(tmp.path().join("README.md"), "# Modified\nNew line\n").unwrap();

    let stats = git::get_changed_files_diff_stats(tmp.path()).unwrap();
    assert_eq!(stats.len(), 1);
    assert_eq!(stats[0].path, PathBuf::from("README.md"));
    // additions 应该 >= 1（新增的 "New line"），deletions 应该 >= 1（删除的旧内容）
    assert!(
        stats[0].additions >= 1,
        "Expected additions >= 1, got {}",
        stats[0].additions
    );
    assert!(
        stats[0].deletions >= 1,
        "Expected deletions >= 1, got {}",
        stats[0].deletions
    );
}

#[test]
fn diff_stats_detects_untracked_file() {
    let (tmp, _repo) = create_test_repo();

    // 新建未跟踪文件
    std::fs::write(tmp.path().join("new_file.txt"), "line1\nline2\nline3\n").unwrap();

    let stats = git::get_changed_files_diff_stats(tmp.path()).unwrap();
    assert_eq!(stats.len(), 1);
    assert_eq!(stats[0].path, PathBuf::from("new_file.txt"));
    assert_eq!(stats[0].additions, 3);
    assert_eq!(stats[0].deletions, 0);
}

#[test]
fn diff_stats_empty_on_clean_repo() {
    let (tmp, _repo) = create_test_repo();

    let stats = git::get_changed_files_diff_stats(tmp.path()).unwrap();
    assert!(stats.is_empty());
}

#[test]
fn diff_stats_cache_returns_same_result() {
    let (tmp, _repo) = create_test_repo();
    std::fs::write(tmp.path().join("README.md"), "# Modified\nNew line\n").unwrap();

    // 第一次调用
    let stats1 = git::get_changed_files_diff_stats(tmp.path()).unwrap();

    // 第二次调用应该返回缓存结果
    let stats2 = git::get_changed_files_diff_stats(tmp.path()).unwrap();

    assert_eq!(stats1.len(), stats2.len());
    assert_eq!(stats1[0].additions, stats2[0].additions);
    assert_eq!(stats1[0].deletions, stats2[0].deletions);
}

#[test]
fn diff_stats_cache_invalidated_on_change() {
    let (tmp, _repo) = create_test_repo();
    std::fs::write(tmp.path().join("README.md"), "# Modified\nNew line\n").unwrap();

    // 第一次调用
    let stats1 = git::get_changed_files_diff_stats(tmp.path()).unwrap();
    assert_eq!(stats1.len(), 1);

    // 修改文件，使缓存失效
    git::invalidate_repo_caches(tmp.path());

    // 添加新文件
    std::fs::write(tmp.path().join("new_file.txt"), "new content\n").unwrap();

    // 第二次调用应该返回新结果
    let stats2 = git::get_changed_files_diff_stats(tmp.path()).unwrap();
    assert!(
        stats2.len() >= 2,
        "Expected >= 2 files after adding new file, got {}",
        stats2.len()
    );
}

// --- parse_decorate_refs (pure function) ---

#[test]
fn parse_decorate_refs_classifies_common_kinds() {
    let refs = git::parse_decorate_refs(
        "HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.0.4, refs/stash",
    );
    assert_eq!(refs.len(), 4);
    assert_eq!(refs[0].kind, RefKind::Branch);
    assert_eq!(refs[0].name, "main");
    assert_eq!(refs[1].kind, RefKind::Remote);
    assert_eq!(refs[1].name, "origin/main");
    assert_eq!(refs[2].kind, RefKind::Tag);
    assert_eq!(refs[2].name, "v1.0.4");
    assert_eq!(refs[3].kind, RefKind::Stash);
    assert_eq!(refs[3].name, "stash");
}

#[test]
fn parse_decorate_refs_discards_tool_private_namespaces() {
    let refs = git::parse_decorate_refs(
        "HEAD -> refs/heads/main, refs/synara/checkpoints/abc, refs/aider/session, refs/bisect/bad",
    );
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].name, "main");
}

#[test]
fn parse_decorate_refs_treats_detached_head_as_branch() {
    let refs = git::parse_decorate_refs("HEAD");
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].kind, RefKind::Branch);
    assert_eq!(refs[0].name, "HEAD");
}

// --- stash list / files (integration) ---

#[tokio::test]
async fn get_stash_list_and_files_roundtrip() {
    let (tmp, _repo) = create_test_repo();
    std::fs::write(tmp.path().join("README.md"), "# Stashed change\n").unwrap();

    // 准备 stash 前置状态：走统一命令执行接口（与业务代码一致，避免裸 std::process::Command）
    let path = tmp.path().to_string_lossy().to_string();
    let out = neeko_lib::core::exec::collect_in_dir(
        &ExecTarget::Local,
        "git",
        &["stash", "push", "-m", "wip stash"],
        Some(&path),
    )
    .await
    .expect("run git stash push");
    assert!(out.exit_code == 0, "git stash push failed");

    let transport = ExecTarget::Local;
    let stashes = operations::get_stash_list(&transport, &path)
        .await
        .expect("get_stash_list should succeed");
    assert_eq!(stashes.len(), 1);
    assert_eq!(stashes[0].selector, "stash@{0}");
    assert!(!stashes[0].hash.is_empty());
    assert!(
        stashes[0].message.contains("wip stash"),
        "stash message should be preserved: {}",
        stashes[0].message
    );
    assert!(!stashes[0].branch.is_empty());

    let files = operations::get_stash_files(&transport, &path, &stashes[0].selector)
        .await
        .expect("get_stash_files should succeed");
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "README.md");
    assert!(!files[0].status.is_empty());
}

#[tokio::test]
async fn get_stash_list_empty_repo_yields_empty_list() {
    let (tmp, _repo) = create_test_repo();
    let transport = ExecTarget::Local;
    let path = tmp.path().to_string_lossy().to_string();
    let stashes = operations::get_stash_list(&transport, &path)
        .await
        .expect("get_stash_list on repo without stashes should succeed");
    assert!(stashes.is_empty());
}

// --- stash file diff / apply / pop (integration) ---

async fn create_stash(repo_path: &str, message: &str) {
    let out = neeko_lib::core::exec::collect_in_dir(
        &ExecTarget::Local,
        "git",
        &["stash", "push", "-m", message],
        Some(repo_path),
    )
    .await
    .expect("run git stash push");
    assert_eq!(out.exit_code, 0, "git stash push failed");
}

#[tokio::test]
async fn get_stash_file_diff_parses_single_file() {
    let (tmp, _repo) = create_test_repo();
    let path = tmp.path().to_string_lossy().to_string();
    std::fs::write(tmp.path().join("README.md"), "# Stashed change\n").unwrap();
    create_stash(&path, "wip stash").await;

    let transport = ExecTarget::Local;
    let result =
        operations::get_stash_file_diff(&transport, &path, "stash@{0}", "README.md", false)
            .await
            .expect("get_stash_file_diff should succeed");
    assert!(!result.hunks.is_empty(), "stash diff should have hunks");
    let added: Vec<_> = result.hunks[0]
        .lines
        .iter()
        .filter(|l| matches!(l, DiffLine::Added(_)))
        .collect();
    assert!(!added.is_empty(), "stash diff should contain added lines");
    let removed: Vec<_> = result.hunks[0]
        .lines
        .iter()
        .filter(|l| matches!(l, DiffLine::Removed(_)))
        .collect();
    assert!(
        !removed.is_empty(),
        "stash diff should contain removed lines"
    );
}

#[tokio::test]
async fn get_stash_file_diff_collapse_limits_context() {
    let (tmp, _repo) = create_test_repo();
    let path = tmp.path().to_string_lossy().to_string();

    // 构造 50 行大文件并提交
    let mut content = String::new();
    for i in 0..50 {
        content.push_str(&format!("line {}\n", i));
    }
    std::fs::write(tmp.path().join("big.txt"), &content).unwrap();
    {
        let repo = Repository::open(tmp.path()).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("big.txt")).unwrap();
        index.write().unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "Add big", &tree, &[&parent])
            .unwrap();
    }

    // 修改第 25 行并 stash
    let mut modified = String::new();
    for i in 0..50 {
        if i == 25 {
            modified.push_str("line 25 CHANGED\n");
        } else {
            modified.push_str(&format!("line {}\n", i));
        }
    }
    std::fs::write(tmp.path().join("big.txt"), &modified).unwrap();
    create_stash(&path, "wip big").await;

    let transport = ExecTarget::Local;
    let collapsed =
        operations::get_stash_file_diff(&transport, &path, "stash@{0}", "big.txt", true)
            .await
            .expect("collapsed stash diff should succeed");
    let ctx = collapsed.hunks[0]
        .lines
        .iter()
        .filter(|l| matches!(l, DiffLine::Context(_)))
        .count();
    assert!(
        ctx <= 6,
        "collapse should keep at most 6 context lines, got {}",
        ctx
    );
}

#[tokio::test]
async fn get_stash_file_diff_unknown_file_returns_empty() {
    let (tmp, _repo) = create_test_repo();
    let path = tmp.path().to_string_lossy().to_string();
    std::fs::write(tmp.path().join("README.md"), "# Stashed change\n").unwrap();
    create_stash(&path, "wip stash").await;

    let transport = ExecTarget::Local;
    let result = operations::get_stash_file_diff(&transport, &path, "stash@{0}", "NOPE.txt", false)
        .await
        .expect("unknown file diff should succeed with empty result");
    assert!(result.hunks.is_empty());
}

#[tokio::test]
async fn stash_apply_restores_changes_keeps_entry() {
    let (tmp, _repo) = create_test_repo();
    let path = tmp.path().to_string_lossy().to_string();
    std::fs::write(tmp.path().join("README.md"), "# Stashed change\n").unwrap();
    create_stash(&path, "wip stash").await;

    let transport = ExecTarget::Local;
    let result = operations::stash_apply(&transport, &path, "stash@{0}")
        .await
        .expect("stash_apply should succeed");
    assert!(result.success, "apply should report success");

    // 语义层断言：apply 后 stash 中的变更恢复到工作区。
    // 1) git 归一化视图（status）为 oracle：README.md 相对 HEAD 应为修改状态。
    //    status 基于归一化 blob 比较，行尾无关，不受平台 autocrlf 影响；
    //    必须用 async 版本（operations::get_git_info），同步版走同步桥，禁止在 #[tokio::test] 调用。
    let info = operations::get_git_info(&transport, &path).await.unwrap();
    assert!(!info.is_clean, "apply 后工作区应非 clean");
    assert!(
        info.changed_files
            .iter()
            .any(|f| f.path == PathBuf::from("README.md")),
        "apply 后 README.md 应处于修改状态"
    );
    // 2) 工作区字节做行尾无关比较：git smudge 可能把 LF 转成平台 CRLF，
    //    工作区字节是不透明平台数据，禁止字节级精确断言。
    support::assert_content_eq(tmp.path(), "README.md", "# Stashed change\n");

    // stash 条目仍然保留
    let stashes = operations::get_stash_list(&transport, &path).await.unwrap();
    assert_eq!(stashes.len(), 1);
}

#[tokio::test]
async fn stash_pop_restores_and_drops_entry() {
    let (tmp, _repo) = create_test_repo();
    let path = tmp.path().to_string_lossy().to_string();
    std::fs::write(tmp.path().join("README.md"), "# Stashed change\n").unwrap();
    create_stash(&path, "wip stash").await;

    let transport = ExecTarget::Local;
    let result = operations::stash_pop(&transport, &path, "stash@{0}")
        .await
        .expect("stash_pop should succeed");
    assert!(result.success, "pop should report success");

    // pop 后 stash 条目被移除
    let stashes = operations::get_stash_list(&transport, &path).await.unwrap();
    assert!(stashes.is_empty(), "pop should drop the stash entry");
}

#[tokio::test]
async fn stash_pop_conflict_keeps_entry_and_reports_failure() {
    let (tmp, _repo) = create_test_repo();
    let path = tmp.path().to_string_lossy().to_string();
    std::fs::write(tmp.path().join("README.md"), "# Stashed change\n").unwrap();
    create_stash(&path, "wip stash").await;

    // 制造冲突：stash 之后在同一文件上做了不同修改
    std::fs::write(tmp.path().join("README.md"), "# Different change\n").unwrap();

    let transport = ExecTarget::Local;
    let result = operations::stash_pop(&transport, &path, "stash@{0}")
        .await
        .expect("stash_pop should return a result even on conflict");
    assert!(!result.success, "conflicting pop should report failure");
    assert!(
        result.message.contains("overwritten by merge") || result.message.contains("CONFLICT"),
        "conflict message should surface the git conflict marker, got: {}",
        result.message
    );

    // 冲突时 stash 条目保留
    let stashes = operations::get_stash_list(&transport, &path).await.unwrap();
    assert_eq!(stashes.len(), 1, "stash entry should be kept on conflict");
}

// ── 非 git 仓库守卫（TDD Red）──────────────────────────────────────────────

/// 创建普通临时目录（非 git 仓库），用于验证守卫路径。
fn create_plain_dir() -> TempDir {
    TempDir::new().expect("create temp dir")
}

#[tokio::test]
async fn get_git_info_rejects_non_git_repo() {
    let tmp = create_plain_dir();
    let path = tmp.path().to_string_lossy().to_string();
    let transport = ExecTarget::Local;
    let err = operations::get_git_info(&transport, &path)
        .await
        .unwrap_err();
    assert!(
        err.chain()
            .any(|e| e.to_string().contains("not a git repository")),
        "应返回 not a git repository 错误，实际: {err:?}"
    );
}

#[tokio::test]
async fn get_git_branch_info_rejects_non_git_repo() {
    let tmp = create_plain_dir();
    let path = tmp.path().to_string_lossy().to_string();
    let transport = ExecTarget::Local;
    let err = operations::get_git_branch_info(&transport, &path)
        .await
        .unwrap_err();
    assert!(
        err.chain()
            .any(|e| e.to_string().contains("not a git repository")),
        "应返回 not a git repository 错误，实际: {err:?}"
    );
}

#[tokio::test]
async fn get_ahead_behind_rejects_non_git_repo() {
    let tmp = create_plain_dir();
    let path = tmp.path().to_string_lossy().to_string();
    let transport = ExecTarget::Local;
    let err = operations::get_ahead_behind(&transport, &path)
        .await
        .unwrap_err();
    assert!(
        err.chain()
            .any(|e| e.to_string().contains("not a git repository")),
        "应返回 not a git repository 错误，实际: {err:?}"
    );
}

#[tokio::test]
async fn get_worktree_changed_files_rejects_non_git_repo() {
    let tmp = create_plain_dir();
    let path = tmp.path().to_string_lossy().to_string();
    let transport = ExecTarget::Local;
    let err = operations::get_worktree_changed_files(&transport, &path)
        .await
        .unwrap_err();
    assert!(
        err.chain()
            .any(|e| e.to_string().contains("not a git repository")),
        "应返回 not a git repository 错误，实际: {err:?}"
    );
}

// ── get_untracked_files（折叠 untracked 目录按需展开）───────────────────────

#[tokio::test]
async fn get_untracked_files_lists_files_under_dir() {
    let (tmp, _repo) = create_test_repo();
    let path = tmp.path().to_string_lossy().to_string();
    std::fs::create_dir_all(tmp.path().join("assets")).unwrap();
    std::fs::write(tmp.path().join("assets/logo.png"), "png").unwrap();
    std::fs::write(tmp.path().join("assets/notes.md"), "notes").unwrap();

    let transport = ExecTarget::Local;
    let mut files = operations::get_untracked_files(&transport, &path, "assets/")
        .await
        .expect("list untracked files under assets");
    files.sort();
    assert_eq!(files, vec!["assets/logo.png", "assets/notes.md"]);
}

#[tokio::test]
async fn get_untracked_files_respects_gitignore() {
    let (tmp, _repo) = create_test_repo();
    let path = tmp.path().to_string_lossy().to_string();
    std::fs::write(tmp.path().join(".gitignore"), "secret/\n").unwrap();
    std::fs::create_dir_all(tmp.path().join("secret")).unwrap();
    std::fs::write(tmp.path().join("secret/hidden.txt"), "hidden").unwrap();
    std::fs::create_dir_all(tmp.path().join("visible")).unwrap();
    std::fs::write(tmp.path().join("visible/kept.txt"), "kept").unwrap();

    let transport = ExecTarget::Local;
    // --exclude-standard 尊重 .gitignore：secret/ 被排除
    let secret = operations::get_untracked_files(&transport, &path, "secret")
        .await
        .expect("list under gitignored dir");
    assert!(secret.is_empty(), "gitignore 排除项不应返回: {secret:?}");

    let visible = operations::get_untracked_files(&transport, &path, "visible")
        .await
        .expect("list under visible dir");
    assert_eq!(visible, vec!["visible/kept.txt"]);
}

#[tokio::test]
async fn get_untracked_files_empty_dir_path_returns_empty() {
    let (tmp, _repo) = create_test_repo();
    let path = tmp.path().to_string_lossy().to_string();
    std::fs::write(tmp.path().join("root.txt"), "x").unwrap();

    let transport = ExecTarget::Local;
    // 空串与纯斜杠路径（trim 后为空）都应返回空列表，不做全库列举
    for dir in ["", "/", "///"] {
        let files = operations::get_untracked_files(&transport, &path, dir)
            .await
            .expect("empty dir should return empty vec");
        assert!(files.is_empty(), "dir {dir:?} 应返回空列表");
    }
}

#[tokio::test]
async fn get_untracked_files_caps_at_500_entries() {
    let (tmp, _repo) = create_test_repo();
    let path = tmp.path().to_string_lossy().to_string();
    std::fs::create_dir_all(tmp.path().join("bulk")).unwrap();
    for i in 0..520 {
        std::fs::write(tmp.path().join(format!("bulk/file-{i:03}.txt")), "x").unwrap();
    }

    let transport = ExecTarget::Local;
    let files = operations::get_untracked_files(&transport, &path, "bulk")
        .await
        .expect("capped list");
    assert_eq!(files.len(), 500, "应封顶 500 条，实际 {}", files.len());
}

#[tokio::test]
async fn get_ignored_files_caps_at_500_entries() {
    let (tmp, _repo) = create_test_repo();
    let path = tmp.path().to_string_lossy().to_string();
    // 根级通配忽略：整目录被忽略时 git 折叠为单条 `!! dir/`，故文件必须放在根目录
    // 逐条列出，才能产生超过 cap 的条目数触发截断。
    std::fs::write(tmp.path().join(".gitignore"), "ignored-*\n").unwrap();
    for i in 0..520 {
        std::fs::write(tmp.path().join(format!("ignored-{i:03}.txt")), "x").unwrap();
    }

    let transport = ExecTarget::Local;
    let files = operations::get_ignored_files(&transport, &path)
        .await
        .expect("capped ignored list");
    assert_eq!(files.len(), 500, "应封顶 500 条，实际 {}", files.len());
    assert!(
        files.iter().all(|p| p.starts_with("ignored-")),
        "截断后条目应全部是 ignored- 文件，实际: {files:?}"
    );
}

#[tokio::test]
async fn get_untracked_files_rejects_non_git_repo() {
    let tmp = create_plain_dir();
    let path = tmp.path().to_string_lossy().to_string();
    let transport = ExecTarget::Local;
    let err = operations::get_untracked_files(&transport, &path, "dir")
        .await
        .unwrap_err();
    assert!(
        err.chain()
            .any(|e| e.to_string().contains("not a git repository")),
        "应返回 not a git repository 错误，实际: {err:?}"
    );
}
