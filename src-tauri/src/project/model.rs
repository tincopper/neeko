use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::common::terminal::types::TerminalSession;
use crate::common::types::GitProvider;

/// 文件状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
}

/// 文件变更信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub path: PathBuf,
    pub status: FileStatus,
    pub additions: usize,
    pub deletions: usize,
}

/// 文件 diff 统计信息（仅 additions / deletions，不含 diff 内容）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiffStats {
    pub path: PathBuf,
    pub additions: usize,
    pub deletions: usize,
}

/// Git 分支信息（轻量级，不含 changed_files）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitBranchInfo {
    pub current_branch: String,
    pub branches: Vec<String>,
    pub worktrees: Vec<Worktree>,
}

/// 视图模式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ViewMode {
    Terminal,
    Diff { file_path: PathBuf },
}

/// Git Worktree 信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Worktree {
    pub path: PathBuf,
    pub branch: String,
    pub head: String,
}

/// Git 仓库信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitInfo {
    pub current_branch: String,
    pub branches: Vec<String>,
    pub worktrees: Vec<Worktree>,
    pub changed_files: Vec<FileChange>,
    pub is_clean: bool,
    pub git_provider: GitProvider,
}

/// 项目信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub git_info: Option<GitInfo>,
    pub terminal: TerminalSession,
    pub selected_agent: Option<String>,
    pub selected_ide: Option<String>,
    pub active_view: ViewMode,
    pub collapsed: bool,
    /// 用户在 ProjectSettingsDialog 中选择的 avatar 颜色（十六进制 hex 字符串，如 "#61afef"）。
    /// `None` 表示走前端 DJB2 hash 兜底。
    #[serde(default)]
    pub avatar_color: Option<String>,
}

/// 文件树节点（目录树返回类型）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<FileNode>,
}

/// 文件内容（读取文件返回类型）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub size: u64,
    pub is_binary: bool,
}

/// Commit 记录
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

/// Commit 详细信息
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

/// Commit 改动的文件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitFileChange {
    pub path: String,
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
}

/// Commit 结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitResult {
    pub success: bool,
    pub hash: String,
    pub message: String,
}

/// Ahead/Behind 计数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AheadBehind {
    pub ahead: usize,
    pub behind: usize,
}

/// gh --json author 返回 {"login":"xxx",...}，提取 login 字段
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

/// PR 列表项（对应 gh pr list --json）
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
    #[serde(default)]
    pub head_repository_owner: String,
}

/// PR 合并结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PRMergeResult {
    pub success: bool,
    pub message: String,
}
