#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use std::collections::HashMap;
use std::path::Path;

use crate::common::executor::factory::ExecTarget;
use crate::common::executor::SpawnOptions;
use crate::core::exec::collect_blocking_with;

/// Status information for a single file from `git status --porcelain`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct GitStatusFile {
    /// File path relative to repository root.
    pub path: String,
    /// Status string (Modified, Added, Deleted, Untracked, Renamed).
    pub status: String,
    /// Number of added lines.
    pub additions: i32,
    /// Number of deleted lines.
    pub deletions: i32,
}

impl GitStatusFile {
    pub(crate) const fn new(path: String, status: String) -> Self {
        Self {
            path,
            status,
            additions: 0,
            deletions: 0,
        }
    }
}

/// Incremental status diff: what changed since the last `git status` poll.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct GitStatusDiff {
    /// Project ID that this diff belongs to.
    pub project_id: String,
    /// Newly added files.
    pub added: Vec<GitStatusFile>,
    /// Paths of removed files.
    pub removed: Vec<String>,
    /// Files whose status changed (e.g. Untracked → Added).
    pub modified: Vec<GitStatusFile>,
}

/// Parse `git status --porcelain` output into `GitStatusFile` list.
pub(crate) fn parse_porcelain(output: &str) -> Vec<GitStatusFile> {
    output
        .lines()
        .filter_map(crate::common::git::parsers::parse_status_line)
        .map(|fc| {
            GitStatusFile::new(
                fc.path.to_string_lossy().to_string(),
                status_label(fc.status).to_string(),
            )
        })
        .collect()
}

/// FileStatus → frontend status string.
pub(crate) const fn status_label(status: crate::common::types::FileStatus) -> &'static str {
    match status {
        crate::common::types::FileStatus::Modified => "Modified",
        crate::common::types::FileStatus::Added => "Added",
        crate::common::types::FileStatus::Deleted => "Deleted",
        crate::common::types::FileStatus::Renamed => "Renamed",
        crate::common::types::FileStatus::Untracked => "Untracked",
    }
}

/// Branch-switch full-replacement diff.
pub(crate) fn compute_branch_switch_diff(
    old_files: &[GitStatusFile],
    new_files: &[GitStatusFile],
) -> GitStatusDiff {
    GitStatusDiff {
        project_id: String::new(),
        added: new_files.to_vec(),
        removed: old_files.iter().map(|f| f.path.clone()).collect(),
        modified: Vec::new(),
    }
}

/// Incremental diff between two `git status` snapshots.
pub(crate) fn compute_status_diff(
    old_files: &[GitStatusFile],
    new_files: &[GitStatusFile],
) -> GitStatusDiff {
    let old_map: HashMap<String, &GitStatusFile> =
        old_files.iter().map(|f| (f.path.clone(), f)).collect();
    let new_map: HashMap<String, &GitStatusFile> =
        new_files.iter().map(|f| (f.path.clone(), f)).collect();

    let mut diff = GitStatusDiff::default();

    for (path, file) in &new_map {
        match old_map.get(path) {
            None => {
                diff.added.push((*file).clone());
            }
            Some(old_file) => {
                if old_file.status != file.status
                    || old_file.additions != file.additions
                    || old_file.deletions != file.deletions
                {
                    diff.modified.push((*file).clone());
                }
            }
        }
    }

    for path in old_map.keys() {
        if !new_map.contains_key(path) {
            diff.removed.push(path.clone());
        }
    }

    diff
}

/// Serialize file list for comparison (includes counts).
pub(crate) fn serialize_files_for_diff(files: &[GitStatusFile]) -> String {
    let mut parts: Vec<String> = files
        .iter()
        .map(|f| format!("{}:{}:+{}-{}", f.path, f.status, f.additions, f.deletions))
        .collect();
    parts.sort();
    parts.join("\n")
}

/// Run `git diff --numstat` (unstaged + cached) and return path → (additions, deletions).
#[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
pub(crate) fn get_numstat_map(repo_path: &Path) -> HashMap<String, (i32, i32)> {
    let path_str = repo_path.to_str().unwrap_or(".");
    let mut map: HashMap<String, (i32, i32)> = HashMap::new();

    const READONLY_ENV: &[(&str, &str)] = &[("GIT_OPTIONAL_LOCKS", "0")];

    if let Ok(output) = collect_blocking_with(
        &ExecTarget::Local,
        SpawnOptions::new("git", &["-C", path_str, "diff", "--numstat"]).with_env(READONLY_ENV),
    ) {
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Some((add, del, path)) = crate::common::git::parsers::parse_numstat_line(line) {
                let entry = map.entry(path).or_insert((0, 0));
                entry.0 += add as i32;
                entry.1 += del as i32;
            }
        }
    }

    if let Ok(output) = collect_blocking_with(
        &ExecTarget::Local,
        SpawnOptions::new("git", &["-C", path_str, "diff", "--cached", "--numstat"])
            .with_env(READONLY_ENV),
    ) {
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Some((add, del, path)) = crate::common::git::parsers::parse_numstat_line(line) {
                let entry = map.entry(path).or_insert((0, 0));
                entry.0 += add as i32;
                entry.1 += del as i32;
            }
        }
    }

    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_porcelain_single_file() {
        let output = " M src/main.rs\n";
        let files = parse_porcelain(output);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "src/main.rs");
        assert_eq!(files[0].status, "Modified");
    }

    #[test]
    fn parse_porcelain_untracked() {
        let output = "?? new_file.txt\n";
        let files = parse_porcelain(output);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "new_file.txt");
        assert_eq!(files[0].status, "Untracked");
    }

    #[test]
    fn parse_porcelain_added() {
        let output = "A  staged.txt\n";
        let files = parse_porcelain(output);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "staged.txt");
        assert_eq!(files[0].status, "Added");
    }

    #[test]
    fn parse_porcelain_deleted() {
        let output = " D deleted.txt\n";
        let files = parse_porcelain(output);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "deleted.txt");
        assert_eq!(files[0].status, "Deleted");
    }

    #[test]
    fn parse_porcelain_rename() {
        let output = "R  old.rs -> new.rs\n";
        let files = parse_porcelain(output);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "new.rs");
        assert_eq!(files[0].status, "Renamed");
    }

    #[test]
    fn compute_diff_added_file() {
        let old = parse_porcelain("");
        let new = parse_porcelain("?? new_file.txt\n");
        let new_files: Vec<GitStatusFile> = new
            .into_iter()
            .map(|mut f| {
                f.additions = 10;
                f
            })
            .collect();
        let diff = compute_status_diff(&old, &new_files);
        assert_eq!(diff.added.len(), 1);
        assert_eq!(diff.added[0].path, "new_file.txt");
        assert_eq!(diff.added[0].additions, 10);
        assert!(diff.removed.is_empty());
        assert!(diff.modified.is_empty());
    }

    #[test]
    fn compute_diff_removed_file() {
        let old = parse_porcelain(" M file.txt\n");
        let new = parse_porcelain("");
        let diff = compute_status_diff(&old, &new);
        assert!(diff.added.is_empty());
        assert_eq!(diff.removed.len(), 1);
        assert_eq!(diff.removed[0], "file.txt");
        assert!(diff.modified.is_empty());
    }

    #[test]
    fn compute_diff_status_change() {
        let old = parse_porcelain("?? file.txt\n");
        let new = parse_porcelain("A  file.txt\n");
        let diff = compute_status_diff(&old, &new);
        assert!(diff.added.is_empty());
        assert!(diff.removed.is_empty());
        assert_eq!(diff.modified.len(), 1);
        assert_eq!(diff.modified[0].path, "file.txt");
        assert_eq!(diff.modified[0].status, "Added");
    }

    #[test]
    fn compute_diff_no_change() {
        let old = parse_porcelain(" M file.txt\n");
        let new = parse_porcelain(" M file.txt\n");
        let diff = compute_status_diff(&old, &new);
        assert!(diff.added.is_empty());
        assert!(diff.removed.is_empty());
        assert!(diff.modified.is_empty());
    }

    #[test]
    fn compute_diff_additions_changed() {
        let old: Vec<GitStatusFile> =
            vec![GitStatusFile::new("file.txt".into(), "Modified".into())];
        let mut new: Vec<GitStatusFile> =
            vec![GitStatusFile::new("file.txt".into(), "Modified".into())];
        new[0].additions = 5;
        new[0].deletions = 3;
        let diff = compute_status_diff(&old, &new);
        assert!(diff.added.is_empty());
        assert!(diff.removed.is_empty());
        assert_eq!(diff.modified.len(), 1);
        assert_eq!(diff.modified[0].additions, 5);
        assert_eq!(diff.modified[0].deletions, 3);
    }

    #[test]
    fn compute_branch_switch_diff_removes_old_branch_files() {
        let old = parse_porcelain(" M src/main.rs\n?? notes.md\n");
        let new = parse_porcelain(" A feature.rs\n");
        let diff = compute_branch_switch_diff(&old, &new);
        assert_eq!(diff.removed.len(), 2, "旧分支的全部文件应进入 removed");
        assert!(diff.removed.contains(&"src/main.rs".to_string()));
        assert!(diff.removed.contains(&"notes.md".to_string()));
        assert_eq!(diff.added.len(), 1, "新分支的全部文件应进入 added");
        assert_eq!(diff.added[0].path, "feature.rs");
        assert!(diff.modified.is_empty());
    }

    #[test]
    fn compute_branch_switch_diff_clean_target_branch() {
        let old = parse_porcelain(" M src/main.rs\n");
        let new = parse_porcelain("");
        let diff = compute_branch_switch_diff(&old, &new);
        assert_eq!(diff.removed, vec!["src/main.rs".to_string()]);
        assert!(diff.added.is_empty());
        assert!(diff.modified.is_empty());
    }

    #[test]
    fn compute_branch_switch_diff_keeps_new_counts() {
        let old = parse_porcelain(" M src/main.rs\n");
        let mut new: Vec<GitStatusFile> = parse_porcelain(" M src/main.rs\n");
        new[0].additions = 10;
        new[0].deletions = 4;
        let diff = compute_branch_switch_diff(&old, &new);
        assert_eq!(diff.removed, vec!["src/main.rs".to_string()]);
        assert_eq!(diff.added.len(), 1);
        assert_eq!(diff.added[0].additions, 10);
        assert_eq!(diff.added[0].deletions, 4);
        assert!(diff.modified.is_empty());
    }

    #[test]
    fn get_numstat_map_counts_unstaged() {
        let (tmp, _repo) = create_repo_with_commit();
        let path = tmp.path();
        std::fs::write(path.join("README.md"), "# Changed\nline2\n").unwrap();

        let map = get_numstat_map(path);
        assert_eq!(map.get("README.md"), Some(&(2, 1)));
    }

    #[test]
    fn get_numstat_map_counts_staged() {
        let (tmp, repo) = create_repo_with_commit();
        let path = tmp.path();
        std::fs::write(path.join("README.md"), "# Changed\nline2\n").unwrap();
        {
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("README.md")).unwrap();
            index.write().unwrap();
        }

        let map = get_numstat_map(path);
        assert_eq!(map.get("README.md"), Some(&(2, 1)));
    }

    fn create_repo_with_commit() -> (tempfile::TempDir, git2::Repository) {
        let tmp = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(tmp.path()).unwrap();
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
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
}
