//! Git diff and push model types.

use serde::{Deserialize, Serialize};

/// A single line in a diff hunk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DiffLine {
    /// Unchanged context line.
    Context(String),
    /// Added line.
    Added(String),
    /// Removed line.
    Removed(String),
    /// Collapsed consecutive unmodified lines ("12 unmodified lines").
    Collapsed(String),
}

/// A single diff hunk (a contiguous block of changed lines).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffHunk {
    /// Starting line number in the old file.
    pub old_start: u32,
    /// Number of lines in the old file covered by this hunk.
    pub old_lines: u32,
    /// Starting line number in the new file.
    pub new_start: u32,
    /// Number of lines in the new file covered by this hunk.
    pub new_lines: u32,
    /// Lines in this hunk.
    pub lines: Vec<DiffLine>,
}

/// The complete diff result for a file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffResult {
    /// All hunks in the diff.
    pub hunks: Vec<DiffHunk>,
    /// Whether the result was truncated due to a line limit.
    #[serde(default)]
    pub truncated: bool,
}
