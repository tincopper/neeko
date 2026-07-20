//! Shared types for file changes, git branches, commits, PRs, and worktrees.

use serde::{Deserialize, Serialize};
use serde_json;
use std::path::PathBuf;

// ─── File types ───────────────────────────────────────────────────────────────

/// Status of a file change in the working tree.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FileStatus {
    /// File was modified.
    Modified,
    /// File was added to the index.
    Added,
    /// File was deleted.
    Deleted,
    /// File was renamed.
    Renamed,
    /// File is untracked.
    Untracked,
}

/// A file change with its status and line counts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    /// Path relative to the repository root.
    pub path: PathBuf,
    /// Change status (modified, added, etc.).
    pub status: FileStatus,
    /// Number of added lines.
    pub additions: usize,
    /// Number of deleted lines.
    pub deletions: usize,
}

/// Diff statistics for a single file (additions/deletions only).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiffStats {
    /// Path relative to the repository root.
    pub path: PathBuf,
    /// Number of added lines.
    pub additions: usize,
    /// Number of deleted lines.
    pub deletions: usize,
}

/// Content of a file including metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileContent {
    /// File path relative to project root.
    pub path: String,
    /// File content as UTF-8 string.
    pub content: String,
    /// File size in bytes.
    pub size: u64,
    /// Whether the file is binary.
    pub is_binary: bool,
}

/// A node in the file tree (file or directory).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    /// File or directory name.
    pub name: String,
    /// Full path relative to project root.
    pub path: String,
    /// Whether this node is a directory.
    pub is_dir: bool,
    /// Child nodes (empty for files).
    pub children: Vec<FileNode>,
}

// ─── Git types ────────────────────────────────────────────────────────────────

/// A git worktree entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Worktree {
    /// Filesystem path to the worktree.
    pub path: PathBuf,
    /// Currently checked-out branch name.
    pub branch: String,
    /// HEAD commit hash.
    pub head: String,
}

/// Git branch information including local branches and worktrees.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitBranchInfo {
    /// Name of the currently checked-out branch.
    pub current_branch: String,
    /// List of all local branch names.
    pub branches: Vec<String>,
    /// All registered worktrees.
    pub worktrees: Vec<Worktree>,
}

/// Supported git hosting providers.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum GitProvider {
    /// gitHub.
    GitHub,
    /// Gitee.
    Gitee,
    /// gitLab.
    GitLab,
    /// Unknown or unsupported provider.
    Unknown,
}

/// Complete git repository information for a project.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitInfo {
    /// Currently checked-out branch.
    pub current_branch: String,
    /// All local branches.
    pub branches: Vec<String>,
    /// Registered worktrees.
    pub worktrees: Vec<Worktree>,
    /// Files with uncommitted changes.
    pub changed_files: Vec<FileChange>,
    /// Whether the working tree has no uncommitted changes.
    pub is_clean: bool,
    /// Detected git hosting provider.
    pub git_provider: GitProvider,
}

/// A single commit entry in a log listing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitEntry {
    /// Full commit hash.
    pub hash: String,
    /// Abbreviated commit hash (7 characters).
    pub short_hash: String,
    /// Author name.
    pub author: String,
    /// ISO 8601 timestamp of the commit.
    pub timestamp: String,
    /// Commit message subject.
    pub message: String,
    /// git ref names (branches, tags) pointing to this commit.
    pub refs: String,
    /// Parent commit hashes.
    #[serde(default)]
    pub parents: Vec<String>,
}

/// Detailed information about a single commit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitDetail {
    /// Full commit hash.
    pub hash: String,
    /// Abbreviated commit hash.
    pub short_hash: String,
    /// Author name.
    pub author: String,
    /// Author email address.
    pub email: String,
    /// ISO 8601 timestamp.
    pub timestamp: String,
    /// Full commit message body.
    pub message: String,
    /// Parent commit hashes.
    pub parents: Vec<String>,
    /// git ref names.
    pub refs: String,
}

/// A file change associated with a specific commit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitFileChange {
    /// File path.
    pub path: String,
    /// Change status (A, M, D, R, etc.).
    pub status: String,
    /// Number of added lines.
    pub additions: usize,
    /// Number of deleted lines.
    pub deletions: usize,
}

/// Result of a commit operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitResult {
    /// Whether the commit was successful.
    pub success: bool,
    /// The resulting commit hash.
    pub hash: String,
    /// The commit message used.
    pub message: String,
}

/// Ahead/behind counts relative to a tracked upstream branch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AheadBehind {
    /// Number of commits ahead of the upstream.
    pub ahead: usize,
    /// Number of commits behind the upstream.
    pub behind: usize,
}

// ─── PR types ─────────────────────────────────────────────────────────────────

fn extract_author_login(val: &serde_json::Value) -> String {
    val.get("login")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn deserialize_author<'de, D: serde::Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    use serde::de;
    let val = serde_json::Value::deserialize(d)?;
    match val {
        serde_json::Value::String(s) => Ok(s),
        serde_json::Value::Object(_) => Ok(extract_author_login(&val)),
        _ => Err(de::Error::custom("author must be string or object")),
    }
}

fn deserialize_head_repo_owner<'de, D: serde::Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    let val = serde_json::Value::deserialize(d)?;
    match val {
        serde_json::Value::String(s) => Ok(s),
        serde_json::Value::Object(_) => Ok(extract_author_login(&val)),
        serde_json::Value::Null => Ok(String::new()),
        _ => Ok(String::new()),
    }
}

/// A label attached to a pull request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrLabel {
    /// Label display name.
    pub name: String,
    /// Hex color code for the label.
    #[serde(default)]
    pub color: String,
}

/// A pull request list item (summary).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PRListItem {
    /// PR number.
    pub number: u64,
    /// PR title.
    pub title: String,
    /// PR state (open, closed, merged).
    pub state: String,
    /// PR author login.
    #[serde(deserialize_with = "deserialize_author")]
    pub author: String,
    /// Source branch name.
    pub head_ref_name: String,
    /// Target branch name.
    pub base_ref_name: String,
    /// ISO 8601 creation timestamp.
    pub created_at: String,
    /// Whether the PR originates from a fork.
    #[serde(default)]
    pub is_cross_repository: bool,
    /// Owner of the head repository (for cross-repo PRs).
    #[serde(default, deserialize_with = "deserialize_head_repo_owner")]
    pub head_repository_owner: String,
    /// Labels attached to the PR.
    #[serde(default)]
    pub labels: Vec<PrLabel>,
    /// Raw comment data (used internally to compute comment_count).
    #[serde(default)]
    pub comments: Vec<serde_json::Value>,
    /// Number of comments on the PR.
    #[serde(default)]
    pub comment_count: u64,
    /// PR assignees.
    #[serde(default)]
    pub assignees: Vec<serde_json::Value>,
}

/// Detailed information about a pull request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PRInfo {
    /// PR number.
    pub number: u64,
    /// PR title.
    pub title: String,
    /// PR state (open, closed, merged).
    pub state: String,
    /// PR body text.
    pub body: Option<String>,
    /// PR author login.
    #[serde(deserialize_with = "deserialize_author")]
    pub author: String,
    /// Source branch name.
    pub head_ref_name: String,
    /// Target branch name.
    pub base_ref_name: String,
    /// URL to the PR on the hosting platform.
    pub url: String,
    /// ISO 8601 creation timestamp.
    pub created_at: String,
    /// Whether the PR can be merged.
    #[serde(default)]
    pub mergeable: Option<String>,
    /// Merge state status (clean, dirty, etc.).
    #[serde(default)]
    pub merge_state_status: Option<String>,
    /// Whether the PR is a draft.
    #[serde(default)]
    pub is_draft: bool,
    /// Whether the PR originates from a fork.
    #[serde(default)]
    pub is_cross_repository: bool,
    /// Status check rollup information.
    #[serde(default)]
    pub status_check_rollup: Option<serde_json::Value>,
    /// The merge commit if the PR was merged.
    #[serde(default)]
    pub merge_commit: Option<MergeCommit>,
    /// The user who merged the PR.
    #[serde(default)]
    pub merged_by: Option<Actor>,
    /// The user who closed the PR.
    #[serde(default)]
    pub closed_by: Option<Actor>,
    /// ISO 8601 merge timestamp.
    #[serde(default)]
    pub merged_at: Option<String>,
    /// ISO 8601 close timestamp.
    #[serde(default)]
    pub closed_at: Option<String>,
}

/// Merge commit reference with its OID.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeCommit {
    /// The merge commit OID.
    pub oid: String,
}

/// A user/actor with login and optional avatar.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Actor {
    /// User login name.
    pub login: String,
    /// URL to the user's avatar image.
    #[serde(default)]
    pub avatar_url: Option<String>,
}

/// Result of a PR merge operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PRMergeResult {
    /// Whether the merge was successful.
    pub success: bool,
    /// Status or response message.
    pub message: String,
}

/// A file changed in a pull request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PRFileChange {
    /// File path.
    pub path: String,
    /// Change status (added, modified, removed, renamed).
    pub status: String,
    /// Number of added lines.
    #[serde(default)]
    pub additions: u64,
    /// Number of deleted lines.
    #[serde(default)]
    pub deletions: u64,
}

/// A commit within a pull request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PRCommit {
    /// Full commit hash.
    pub hash: String,
    /// Abbreviated commit hash.
    pub short_hash: String,
    /// Commit message.
    pub message: String,
    /// Author login.
    #[serde(deserialize_with = "deserialize_author")]
    pub author: String,
    /// ISO 8601 timestamp.
    pub timestamp: String,
}

// ─── PR Comment types ───────────────────────────────────────────────────────

/// A review comment on a specific line of a PR file diff.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PRReviewComment {
    /// Comment ID.
    pub id: String,
    /// Author login.
    pub author: String,
    /// Author avatar URL.
    #[serde(default)]
    pub author_avatar: Option<String>,
    /// Comment body text.
    pub body: String,
    /// File path the comment refers to.
    pub path: String,
    /// Line number the comment is on.
    pub line: u64,
    /// Side of the diff (LEFT or RIGHT).
    pub side: String,
    /// Commit ID the comment is associated with.
    pub commit_id: String,
    /// ISO 8601 creation timestamp.
    pub created_at: String,
    /// ISO 8601 last update timestamp.
    #[serde(default)]
    pub updated_at: Option<String>,
}

/// A general comment on a pull request (not attached to a specific line).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PRComment {
    /// Comment ID.
    pub id: String,
    /// Author login.
    pub author: String,
    /// Author avatar URL.
    #[serde(default)]
    pub author_avatar: Option<String>,
    /// Comment body text.
    pub body: String,
    /// ISO 8601 creation timestamp.
    pub created_at: String,
    /// ISO 8601 last update timestamp.
    #[serde(default)]
    pub updated_at: Option<String>,
    /// Reactions (emoji) on this comment.
    #[serde(default)]
    pub reactions: Option<Vec<CommentReaction>>,
}

/// An emoji reaction to a comment.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentReaction {
    /// Emoji character.
    pub emoji: String,
    /// Number of users who reacted.
    pub count: u32,
    /// Whether the current user reacted.
    pub user_reacted: bool,
}

// ─── Watcher types ────────────────────────────────────────────────────────────

/// Incremental status diff from the last `git status` poll.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct GitStatusDiff {
    /// Project ID this diff belongs to.
    pub project_id: String,
    /// Newly added files.
    pub added: Vec<GitStatusFile>,
    /// Paths of removed files.
    pub removed: Vec<String>,
    /// Files whose status changed.
    pub modified: Vec<GitStatusFile>,
}

/// Status information for a single file from `git status --porcelain`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct GitStatusFile {
    /// File path relative to repository root.
    pub path: String,
    /// Status string (Modified, Added, Deleted, Untracked, Renamed).
    pub status: String,
}
