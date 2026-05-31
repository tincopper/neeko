use serde::{Deserialize, Serialize};

/// Diff 行类型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DiffLine {
    Context(String),
    Added(String),
    Removed(String),
    /// 折叠的连续未修改上下文（"12 unmodified lines"）
    Collapsed(String),
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
    /// 是否因为 line_limit 被截断
    #[serde(default)]
    pub truncated: bool,
}
