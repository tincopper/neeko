use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use super::terminal::TerminalSession;

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

/// Git 提交信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub email: String,
    pub timestamp: i64,
    pub date: String,
    pub parent_hashes: Vec<String>,
}

/// Git 分支分组
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchGroup {
    pub local: Vec<String>,
    pub remote: Vec<String>,
    pub tags: Vec<String>,
    pub current: String,
}

/// 单个提交的详情（含修改文件列表）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitDetail {
    pub commit: CommitInfo,
    pub files: Vec<FileChange>,
    pub parent_hashes: Vec<String>,
}
