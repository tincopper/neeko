#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use crate::common::git::parsers::parse_status_line;
use crate::common::git::WorkspaceRef;
use crate::project::types::FileChange;

/// 全链路 status 条目上限（公理：随输入规模增长的结构必须有界；对齐 orca 1000 条截断）。
///
/// 单一实现点：worker 与 pull 生产者都经 [`GitStatusSnapshot::enforce_entry_cap`] 施加上限，
/// 不再各自复制常量（复制必然漂移，且「上限」是恰好一个不变量）。
pub const MAX_STATUS_ENTRIES: usize = 1000;

/// Versioned, authoritative git-status snapshot for **one workspace**.
///
/// G2 单一权威化（D1/D3）+ 本次身份补全：worker 每次检测到实质变化就产出**完整**快照
/// 并整体替换 —— 事件不再携带增量 patch，前端按 `version` 单调递增门控消费
/// （P1：乱序/回退覆盖从结构上消灭）。entries 直接复用 `FileChange`
/// （含 G1 `is_dir` 字段，path 无尾斜杠），前端 `changed_files` 零转换整体替换。
///
/// **身份**：`workspace_key` 是 [`WorkspaceRef::key`] 的字符串形态，双端共用的唯一寻址单位。
/// 一个 project 承载 `1 + N` 个工作树（主仓 + linked worktree），它们的 HEAD / index /
/// workdir 全部独立 —— 缺这一维时，worktree 视图与主仓视图会共用同一个槽，
/// 于是「串 main 内容」与「没有权威生产者」两类症状同时出现。
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct GitStatusSnapshot {
    /// 该快照所属Workspace的寻址 key（前端只透传 + 作 map 键）。
    pub workspace_key: String,
    /// Monotonically increasing version (per workspace, increments on every emitted snapshot).
    pub version: u64,
    /// 所属项目 ID（冗余保留：事件消费者按项目分组渲染）
    pub project_id: String,
    /// linked worktree 的 canonical 路径；主仓为 `None`。
    pub worktree_path: Option<String>,
    /// Current branch (detached HEAD → "HEAD"; empty on error).
    pub branch: String,
    /// Full changed-file list.
    pub entries: Vec<FileChange>,
    /// True when entries were capped at MAX_STATUS_ENTRIES (UI shows a banner, G4).
    pub truncated: bool,
    /// 相对 `@{upstream}` 的领先提交数（无 upstream / detached / 非 git → 0）。
    /// 由**同一个生产者**与 entries/branch 在同一次重算内产出（见 git-domain §12）。
    #[serde(default)]
    pub ahead: u32,
    /// 相对 `@{upstream}` 的落后提交数（无 upstream / detached / 非 git → 0）。
    #[serde(default)]
    pub behind: u32,
}

impl GitStatusSnapshot {
    /// 由Workspace构造快照骨架（worker 与 pull 计算两条生产者共用，避免字段各写一份）。
    #[must_use]
    pub fn for_unit(repo: &WorkspaceRef, version: u64) -> Self {
        Self {
            workspace_key: repo.key(),
            version,
            project_id: repo.project_id().to_string(),
            worktree_path: repo.worktree_path().map(str::to_string),
            branch: String::new(),
            entries: Vec::new(),
            truncated: false,
            ahead: 0,
            behind: 0,
        }
    }

    /// 施加全链路条目上限：截断 `entries` 并置 `truncated`，返回**是否发生了截断**
    /// （调用方据此决定是否打告警；`truncated` 字段本身供 UI 显示横幅）。
    ///
    /// `enforce_entry_cap` 是上限的**唯一实现**：worker 与 pull 生产者都必须调用它，
    /// 不得各自 `truncate`（重复实现 = 两处上限可漂移，且 pull 生产者容易漏掉 `truncated`）。
    pub fn enforce_entry_cap(&mut self) -> bool {
        if self.entries.len() > MAX_STATUS_ENTRIES {
            self.entries.truncate(MAX_STATUS_ENTRIES);
            self.truncated = true;
            return true;
        }
        false
    }
}

/// Parse `git status --porcelain` output into a `FileChange` list.
///
/// 唯一解析入口仍是 `parsers::status::parse_status_line`（DRY：status_worker /
/// operations / remote 共用）；此处仅做过滤收集，条目已携带 G1 `is_dir`。
#[must_use]
pub fn parse_porcelain(output: &str) -> Vec<FileChange> {
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
            .find(|f| f.path == std::path::Path::new("new_dir"))
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
        let repo = WorkspaceRef::main("p1", "/repo");
        let mut snap = GitStatusSnapshot::for_unit(&repo, 3);
        snap.branch = "main".into();
        snap.entries = parse_porcelain(" M a.txt\n?? dir/\n");
        let json = serde_json::to_string(&snap).unwrap();
        assert!(json.contains("\"version\":3"));
        assert!(json.contains("\"project_id\":\"p1\""));
        assert!(json.contains("\"is_dir\":true"));
        // FileChange 序列化为字符串状态 + 归一化路径（无尾斜杠）
        assert!(json.contains("\"status\":\"Modified\""));
        assert!(!json.contains("dir/\""));
    }

    /// 身份维度：主仓与 linked worktree 的快照必须各自带 key / worktree_path，
    /// 否则前端只能共用一个槽（本次重构的根因）。
    #[test]
    fn snapshot_for_unit_carries_repo_identity_for_both_variants() {
        let main = WorkspaceRef::main("p1", "/repo");
        let main_snap = GitStatusSnapshot::for_unit(&main, 1);
        assert_eq!(main_snap.workspace_key, main.key());
        assert_eq!(main_snap.worktree_path, None);
        assert_eq!(main_snap.project_id, "p1");
        assert_eq!(main_snap.branch, "");
        assert!(main_snap.entries.is_empty());
        assert!(!main_snap.truncated);
        assert_eq!(main_snap.ahead, 0);
        assert_eq!(main_snap.behind, 0);

        let linked = WorkspaceRef::resolve(
            "p1",
            "/repo",
            Some("/repo-wt"),
            &crate::common::executor::factory::ExecTarget::Remote {
                host: "h".to_string(),
                port: 22,
                username: "u".to_string(),
                auth: crate::common::connection::types::AuthMethod::Password("x".to_string()),
            },
        )
        .unwrap();
        let linked_snap = GitStatusSnapshot::for_unit(&linked, 7);
        assert_eq!(linked_snap.workspace_key, "p1\0/repo-wt");
        assert_eq!(linked_snap.worktree_path.as_deref(), Some("/repo-wt"));
        assert_ne!(
            linked_snap.workspace_key, main_snap.workspace_key,
            "同一项目的两个工作树不得共用一个快照 key"
        );
        let json = serde_json::to_string(&linked_snap).unwrap();
        assert!(json.contains("\"workspace_key\":\"p1\\u0000/repo-wt\""));
    }
}
