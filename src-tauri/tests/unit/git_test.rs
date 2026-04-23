use git2::{Repository, Signature};
use neeko_lib::git;
use neeko_lib::models::DiffLine;
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

    let diff = git::get_file_diff(tmp.path(), "README.md").unwrap();
    assert!(!diff.hunks.is_empty());
}

#[test]
fn get_file_diff_on_new_file() {
    let (tmp, _repo) = create_test_repo();
    std::fs::write(tmp.path().join("brand_new.txt"), "line1\nline2\n").unwrap();

    let diff = git::get_file_diff(tmp.path(), "brand_new.txt").unwrap();
    assert!(!diff.hunks.is_empty());
    let all_added = diff.hunks[0]
        .lines
        .iter()
        .all(|l| matches!(l, DiffLine::Added(_)));
    assert!(all_added);
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
