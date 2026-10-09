//! 事件名常量与事件 payload 类型（单一事实源，前端经 `shared/events.ts` 同步引用）。
//!
//! **寻址维度**：所有 git / 文件类事件都携带 `workspace_key`（[`crate::common::git::WorkspaceRef::key`]
//! 的字符串形态）。一个 project 承载 `1 + N` 个Workspace（主仓 + linked worktree），
//! 只有 project_id 的事件无法表达「哪个工作树变了」，消费端就只能靠「当前激活 worktree」
//! 这类全局可变状态去猜 —— 猜错的两种结果就是本次修掉的缺陷：列表不更新、串主仓数据。

// ── Event 名称常量（单一事实源，前端经 shared/events.ts 同步引用）───────────

/// 文件内容变更事件：`file-changed`
pub const FILE_CHANGED_EVENT: &str = "file-changed";
/// 文件树结构变更事件：`file-tree-changed`
pub const FILE_TREE_CHANGED_EVENT: &str = "file-tree-changed";
/// G2 事件协议 v2：versioned 全量 git-status 快照（单一权威，替代增量 diff 事件）。
pub const GIT_STATUS_SNAPSHOT_EVENT: &str = "git-status-snapshot";
/// Git 状态变更事件（外部/元数据变化的刷新提示）：`git-changed`
pub const GIT_CHANGED_EVENT: &str = "git-changed";
/// Git 性能建议事件（G7，一次性）：`git-perf-suggestion`
pub const GIT_PERF_SUGGESTION_EVENT: &str = "git-perf-suggestion";

/// Git 性能建议事件 payload（大仓库 + 未启用原生缓存的引导）
#[derive(Debug, Clone, serde::Serialize)]
pub struct GitPerfSuggestionEvent {
    /// 变更事件所属Workspace的寻址 key
    pub workspace_key: String,
    /// 项目 ID
    pub project_id: String,
    /// 建议列表（可能为空集合，调用方保证非空才发）
    pub suggestions: Vec<crate::common::git::perf::GitPerfSuggestion>,
}

// ── 文件变更事件 ──────────────────────────────────────────────────────────────

/// 文件内容变更事件 payload，发送给前端用于刷新已打开的 tab
#[derive(Debug, Clone, serde::Serialize)]
pub struct FileChangedEvent {
    /// 变更事件所属Workspace的寻址 key（前端据此判定是否与当前视图相关）
    pub workspace_key: String,
    /// 项目 ID
    pub project_id: String,
    /// 相对于**该单元工作树根**的变更文件路径列表（使用 `/` 分隔符）
    pub paths: Vec<String>,
}

/// 文件树结构变更事件 payload（文件新增/删除/重命名），前端收到后应刷新目录树
#[derive(Debug, Clone, serde::Serialize)]
pub struct FileTreeChangedEvent {
    /// 变更事件所属Workspace的寻址 key
    pub workspace_key: String,
    /// 项目 ID
    pub project_id: String,
    /// 受影响的目录相对路径集合（以 `/` 分隔，'' 表示该单元的工作树根）。
    /// 前端只需重载这些已展开目录的缓存；**空集合 = 未知范围的变更**，
    /// 应退回全树刷新兜底（watcher overflow / 异常恢复场景）。
    #[serde(default)]
    pub dirs: Vec<String>,
}

/// `git-changed` 事件 payload：某单元的 git 元数据（HEAD 等）发生了变化。
///
/// 语义是**提示**（「该重查了」），不是事实 —— 事实由 `git-status-snapshot` 携带。
/// 旧形态是裸 `project_id` 字符串，收不到「哪个工作树」这一维。
#[derive(Debug, Clone, serde::Serialize)]
pub struct GitChangedEvent {
    /// 变化的Workspace寻址 key
    pub workspace_key: String,
    /// 所属项目 ID
    pub project_id: String,
}

impl GitChangedEvent {
    #[must_use]
    pub fn new(repo: &crate::common::git::WorkspaceRef) -> Self {
        Self {
            workspace_key: repo.key(),
            project_id: repo.project_id().to_string(),
        }
    }
}
