#![allow(unused_imports, missing_docs)]
use super::run_cmd_local;
use crate::project::types::Worktree;
use git2::Repository;

pub(crate) fn get_worktrees(repo: &Repository) -> Vec<Worktree> {
    let mut worktrees = Vec::new();

    let Ok(names) = repo.worktrees() else {
        return worktrees;
    };
    for name in names.iter().flatten() {
        let Ok(wt) = repo.find_worktree(name) else {
            continue;
        };
        let path = wt.path().to_path_buf();
        let wt_path_str = path.to_str().unwrap_or(".");
        // Use git command to get branch and head info (avoids N+1 repo opens)
        let Ok(output) = run_cmd_local(
            None,
            "git",
            &["-C", wt_path_str, "rev-parse", "--abbrev-ref", "HEAD"],
        ) else {
            continue;
        };
        let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let branch = if branch.is_empty() {
            "HEAD".to_string()
        } else {
            branch
        };

        let Ok(output) = run_cmd_local(None, "git", &["-C", wt_path_str, "rev-parse", "HEAD"])
        else {
            continue;
        };
        let head = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let head = if head.is_empty() {
            "detached".to_string()
        } else {
            head
        };

        worktrees.push(Worktree { path, branch, head });
    }

    worktrees
}
