/**
 * Tauri Event 名称统一模块（前端侧单一事实源）。
 *
 * 与 `src-tauri/src/common/file/watcher.rs` 顶部的事件常量保持同步：
 * FILE_CHANGED_EVENT / FILE_TREE_CHANGED_EVENT / GIT_STATUS_DIFF_EVENT / GIT_CHANGED_EVENT。
 * 禁止在业务代码中硬编码事件字符串。
 */

/** 文件内容变更事件：`file-changed` */
export const FILE_CHANGED_EVENT = 'file-changed';
/** 文件树结构变更事件：`file-tree-changed` */
export const FILE_TREE_CHANGED_EVENT = 'file-tree-changed';
/** Git 增量 diff 事件：`git-status-diff` */
export const GIT_STATUS_DIFF_EVENT = 'git-status-diff';
/** Git 状态变更事件（兼容旧监听的全量刷新 fallback）：`git-changed` */
export const GIT_CHANGED_EVENT = 'git-changed';
