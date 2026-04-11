use serde::{Deserialize, Serialize};

/// Diff 行类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DiffLine {
    Context(String),
    Added(String),
    Removed(String),
}

/// Diff Hunk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

/// Diff 结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffResult {
    pub hunks: Vec<DiffHunk>,
}
