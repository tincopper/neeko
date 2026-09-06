#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use crate::common::git::parsers::parse_status_line;
use crate::project::types::FileChange;

/// Versioned, authoritative git-status snapshot for one repository.
///
/// G2 单一权威化（D1/D3）：worker 每次检测到实质变化就产出**完整**快照并整体
/// 替换 —— 事件不再携带增量 patch，前端按 `version` 单调递增门控消费
/// （P1：乱序/回退覆盖从结构上消灭）。entries 直接复用 `FileChange`
/// （含 G1 `is_dir` 字段，path 无尾斜杠），前端 `changed_files` 零转换整体替换。
#[derive(Debug, Clone, serde::Serialize)]
pub struct GitStatusSnapshot {
    /// Monotonically increasing version (per worker, increments on every emitted snapshot).
    pub version: u64,
    /// Project ID this snapshot belongs to (filled by WatcherManager).
    pub project_id: String,
    /// Current branch (detached HEAD → "HEAD"; empty on error).
    pub branch: String,
    /// Full changed-file list.
    pub entries: Vec<FileChange>,
    /// True when entries were capped at MAX_STATUS_ENTRIES (UI shows a banner, G4).
    pub truncated: bool,
}

/// Parse `git status --porcelain` output into a `FileChange` list.
///
/// 唯一解析入口仍是 `parsers::status::parse_status_line`（DRY：status_worker /
/// operations / remote 共用）；此处仅做过滤收集，条目已携带 G1 `is_dir`。
pub(crate) fn parse_porcelain(output: &str) -> Vec<FileChange> {
    output.lines().filter_map(parse_status_line).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::types::FileStatus;

    #[test]
    fn parse_porcelain_single_file() {
        let output = " M src/main.rs\n";
        let files = parse_porcelain(output);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, std::path::PathBuf::from("src/main.rs"));
        assert!(matches!(files[0].status, FileStatus::Modified));
        assert!(!files[0].is_dir);
    }

    #[test]
    fn parse_porcelain_untracked_collapsed_dir_carries_is_dir() {
        let output = "?? new_dir/\n?? file.txt\n";
        let files = parse_porcelain(output);
        assert_eq!(files.len(), 2);
        let dir = files
            .iter()
            .find(|f| f.path == std::path::PathBuf::from("new_dir"))
            .unwrap();
        assert!(dir.is_dir, "collapsed dir entry must carry is_dir (G1)");
        assert!(files
            .iter()
            .all(|f| !f.path.to_string_lossy().ends_with('/')));
    }

    #[test]
    fn parse_porcelain_added_deleted() {
        let files = parse_porcelain("A  staged.txt\n D deleted.txt\n");
        assert!(files
            .iter()
            .any(|f| { f.path.ends_with("staged.txt") && matches!(f.status, FileStatus::Added) }));
        assert!(files.iter().any(|f| {
            f.path.ends_with("deleted.txt") && matches!(f.status, FileStatus::Deleted)
        }));
    }

    #[test]
    fn parse_porcelain_rename_uses_new_path() {
        let files = parse_porcelain("R  old.rs -> new.rs\n");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, std::path::PathBuf::from("new.rs"));
        assert!(matches!(files[0].status, FileStatus::Renamed));
    }

    #[test]
    fn snapshot_serializes_with_version_and_entries() {
        let snap = GitStatusSnapshot {
            version: 3,
            project_id: "p1".into(),
            branch: "main".into(),
            entries: parse_porcelain(" M a.txt\n?? dir/\n"),
            truncated: false,
        };
        let json = serde_json::to_string(&snap).unwrap();
        assert!(json.contains("\"version\":3"));
        assert!(json.contains("\"project_id\":\"p1\""));
        assert!(json.contains("\"is_dir\":true"));
        // FileChange 序列化为字符串状态 + 归一化路径（无尾斜杠）
        assert!(json.contains("\"status\":\"Modified\""));
        assert!(!json.contains("dir/\""));
    }
}
