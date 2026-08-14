use git2::{Repository, Signature};
use neeko_lib::common::executor::factory::ExecTarget;
use neeko_lib::common::git::operations;
use neeko_lib::common::git::refs::RefKind;
use neeko_lib::common::git::types::DiffLine;
use neeko_lib::git;
use std::path::PathBuf;
use tempfile::TempDir;

fn create_test_repo() -> (TempDir, Repository) {
    let tmp = TempDir::new().unwrap();
    let repo = Repository::init(tmp.path()).unwrap();

    let sig = Signature::now("Test", "test@test.com").unwrap();
    std::fs::write(tmp.path().join("README.md"), "# Test\n").unwrap();

    {
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
            .unwrap();
    }

    (tmp, repo)
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

// --- create_branch / checkout_branch ---

#[test]
fn create_and_checkout_branch() {
    let (tmp, _repo) = create_test_repo();
    git::create_branch(tmp.path(), "feature-1", None).unwrap();
    git::checkout_branch(tmp.path(), "feature-1").unwrap();

    let info = git::get_git_info(tmp.path()).unwrap();
    assert_eq!(info.current_branch, "feature-1");
}

#[test]
fn create_branch_from_start_point() {
    let (tmp, _repo) = create_test_repo();
    std::fs::write(tmp.path().join("file2.txt"), "hello\n").unwrap();
    {
        let repo = Repository::open(tmp.path()).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("file2.txt")).unwrap();
        index.write().unwrap();
        let sig = Signature::now("Test", "test@test.com").unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let parent = repo.head().unwrap().peel_to_commit().unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "Second", &tree, &[&parent])
            .unwrap();
    }

    git::create_branch(tmp.path(), "from-first", Some("HEAD~1")).unwrap();
}

#[test]
fn checkout_nonexistent_branch_fails() {
    let (tmp, _repo) = create_test_repo();
    let result = git::checkout_branch(tmp.path(), "nonexistent");
    assert!(result.is_err());
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

// --- rename_branch ---

#[test]
fn rename_current_branch() {
    let (tmp, _repo) = create_test_repo();
    let info_before = git::get_git_info(tmp.path()).unwrap();
    let current = info_before.current_branch.clone();

    git::rename_branch(tmp.path(), &current, "renamed-branch").unwrap();
    let info_after = git::get_git_info(tmp.path()).unwrap();
    assert_eq!(info_after.current_branch, "renamed-branch");
}

#[test]
fn rename_nonexistent_branch_fails() {
    let (tmp, _repo) = create_test_repo();
    let result = git::rename_branch(tmp.path(), "no-such-branch", "new-name");
    assert!(result.is_err());
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

// --- get_commit_log scoped to HEAD (integration) ---

#[test]
fn get_commit_log_scoped_to_head_excludes_isolated_tool_refs() {
    let (tmp, repo) = create_test_repo();
    let head_id = repo.head().unwrap().peel_to_commit().unwrap().id();

    // 孤立提交仅被 refs/synara/checkpoints/isolated 引用 —— --all 会展示，HEAD 不应展示
    let sig = Signature::now("Test", "test@test.com").unwrap();
    let blob_oid = repo.blob(b"synara checkpoint\n").unwrap();
    let mut tree_builder = repo.treebuilder(None).unwrap();
    tree_builder
        .insert("synara.txt", blob_oid, 0o100644)
        .unwrap();
    let tree_oid = tree_builder.write().unwrap();
    let orphan_id = repo
        .commit(
            None,
            &sig,
            &sig,
            "synara checkpoint",
            &repo.find_tree(tree_oid).unwrap(),
            &[],
        )
        .unwrap();
    repo.reference(
        "refs/synara/checkpoints/isolated",
        orphan_id,
        true,
        "synara",
    )
    .unwrap();

    // 将另一个工具 ref 指向 HEAD 提交：验证 decorate 中的 tool ref 被过滤
    repo.reference(
        "refs/synara/checkpoints/head-marker",
        head_id,
        true,
        "synara",
    )
    .unwrap();

    let log = git::get_commit_log(tmp.path(), 0, 0).unwrap();
    assert!(
        log.iter().all(|c| c.hash != orphan_id.to_string()),
        "isolated synara-only commit must not appear in HEAD-scoped log"
    );

    let head_entry = log
        .iter()
        .find(|c| c.hash == head_id.to_string())
        .expect("HEAD commit should be in log");
    assert!(
        !head_entry.refs.contains("synara"),
        "refs string must not contain tool refs, got: {}",
        head_entry.refs
    );
    assert!(
        head_entry
            .refs_list
            .iter()
            .all(|r| r.name != "synara/checkpoints/head-marker"),
        "refs_list must not contain tool refs"
    );
    assert!(
        head_entry
            .refs_list
            .iter()
            .any(|r| r.kind == RefKind::Branch),
        "HEAD commit should still expose its branch ref"
    );
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
