//! 事件名常量与事件 payload 类型（单一事实源，前端经 `shared/events.ts` 同步引用）。

// ── Event 名称常量（单一事实源，前端经 shared/events.ts 同步引用）───────────

/// 文件内容变更事件：`file-changed`
pub const FILE_CHANGED_EVENT: &str = "file-changed";
/// 文件树结构变更事件：`file-tree-changed`
pub const FILE_TREE_CHANGED_EVENT: &str = "file-tree-changed";
/// Git 增量 diff 事件：`git-status-diff`
pub const GIT_STATUS_DIFF_EVENT: &str = "git-status-diff";
/// Git 状态变更事件（兼容旧监听的全量刷新 fallback）：`git-changed`
pub const GIT_CHANGED_EVENT: &str = "git-changed";

// ── 文件变更事件 ──────────────────────────────────────────────────────────────

/// 文件内容变更事件 payload，发送给前端用于刷新已打开的 tab
#[derive(Debug, Clone, serde::Serialize)]
pub struct FileChangedEvent {
    /// 项目 ID
    pub project_id: String,
    /// 相对于项目根目录的变更文件路径列表（使用 `/` 分隔符）
    pub paths: Vec<String>,
}

/// 文件树结构变更事件 payload（文件新增/删除/重命名），前端收到后应刷新目录树
#[derive(Debug, Clone, serde::Serialize)]
pub struct FileTreeChangedEvent {
    /// 项目 ID
    pub project_id: String,
    /// 受影响的目录相对路径集合（以 `/` 分隔，'' 表示项目根）。
    /// 前端只需重载这些已展开目录的缓存；**空集合 = 未知范围的变更**，
    /// 应退回全树刷新兜底（watcher overflow / 异常恢复场景）。
    #[serde(default)]
    pub dirs: Vec<String>,
}
