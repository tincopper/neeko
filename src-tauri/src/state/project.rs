use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use super::terminal::TerminalSession;

/// 文件状态
#[derive(Debug, Clone, Serialize, Deserialize)]
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
