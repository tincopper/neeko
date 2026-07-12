use serde::{Deserialize, Serialize};
use serde_json;
use std::path::PathBuf;

// ─── File types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub path: PathBuf,
    pub status: FileStatus,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiffStats {
    pub path: PathBuf,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub size: u64,
    pub is_binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<FileNode>,
}

// ─── Git types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Worktree {
    pub path: PathBuf,
    pub branch: String,
    pub head: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitBranchInfo {
    pub current_branch: String,
    pub branches: Vec<String>,
    pub worktrees: Vec<Worktree>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitInfo {
    pub current_branch: String,
    pub branches: Vec<String>,
    pub worktrees: Vec<Worktree>,
    pub changed_files: Vec<FileChange>,
    pub is_clean: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitEntry {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub timestamp: String,
    pub message: String,
    pub refs: String,
    #[serde(default)]
    pub parents: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitDetail {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub email: String,
    pub timestamp: String,
    pub message: String,
    pub parents: Vec<String>,
    pub refs: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitFileChange {
    pub path: String,
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitResult {
    pub success: bool,
    pub hash: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AheadBehind {
    pub ahead: usize,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrLabel {
    pub name: String,
    #[serde(default)]
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PRListItem {
    pub number: u64,
    pub title: String,
    pub state: String,
    #[serde(deserialize_with = "deserialize_author")]
    pub author: String,
    pub head_ref_name: String,
    pub base_ref_name: String,
    pub created_at: String,
    #[serde(default)]
    pub is_cross_repository: bool,
    #[serde(default, deserialize_with = "deserialize_head_repo_owner")]
    pub head_repository_owner: String,
    #[serde(default)]
    pub labels: Vec<PrLabel>,
    #[serde(default)]
    pub comments: Vec<serde_json::Value>,
    #[serde(default)]
    pub comment_count: u64,
    #[serde(default)]
    pub assignees: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PRInfo {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub body: Option<String>,
    #[serde(deserialize_with = "deserialize_author")]
    pub author: String,
    pub head_ref_name: String,
    pub base_ref_name: String,
    pub url: String,
    pub created_at: String,
    #[serde(default)]
    pub mergeable: Option<String>,
    #[serde(default)]
    pub merge_state_status: Option<String>,
    #[serde(default)]
    pub is_draft: bool,
    #[serde(default)]
    pub is_cross_repository: bool,
    #[serde(default)]
    pub status_check_rollup: Option<serde_json::Value>,
    #[serde(default)]
    pub merge_commit: Option<MergeCommit>,
    #[serde(default)]
    pub merged_by: Option<Actor>,
    #[serde(default)]
    pub closed_by: Option<Actor>,
    #[serde(default)]
    pub merged_at: Option<String>,
    #[serde(default)]
    pub closed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeCommit {
    pub oid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Actor {
    pub login: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PRMergeResult {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PRFileChange {
    pub path: String,
    pub status: String,
    #[serde(default)]
    pub additions: u64,
    #[serde(default)]
    pub deletions: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PRCommit {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    #[serde(deserialize_with = "deserialize_author")]
    pub author: String,
    pub timestamp: String,
}

// ─── PR Comment types ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PRReviewComment {
    pub id: String,
    pub author: String,
    #[serde(default)]
    pub author_avatar: Option<String>,
    pub body: String,
    pub path: String,
    pub line: u64,
    pub side: String,
    pub commit_id: String,
    pub created_at: String,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PRComment {
    pub id: String,
    pub author: String,
    #[serde(default)]
    pub author_avatar: Option<String>,
    pub body: String,
    pub created_at: String,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub reactions: Option<Vec<CommentReaction>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentReaction {
    pub emoji: String,
    pub count: u32,
    pub user_reacted: bool,
}

// ─── Watcher types ────────────────────────────────────────────────────────────

/// 增量状态差异：与上次 git status 对比后的变化
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct GitStatusDiff {
    pub project_id: String,
    pub added: Vec<GitStatusFile>,
    pub removed: Vec<String>,
    pub modified: Vec<GitStatusFile>,
}

/// 单个文件的 git status 信息
#[derive(Debug, Clone, serde::Serialize)]
pub struct GitStatusFile {
    pub path: String,
    pub status: String,
}
