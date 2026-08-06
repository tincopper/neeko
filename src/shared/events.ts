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

// ── Browser 事件（与 src-tauri/src/browser/events.rs 常量保持同步）──

/** 浏览器导航 URL 变化事件：`browser://url-changed` */
export const BROWSER_URL_CHANGED_EVENT = 'browser://url-changed';
/** 浏览器加载状态事件：`browser://loading` */
export const BROWSER_LOADING_EVENT = 'browser://loading';
/** 浏览器页面加载完成事件：`browser://page-loaded` */
export const BROWSER_PAGE_LOADED_EVENT = 'browser://page-loaded';
/** 浏览器新窗口打开事件：`browser://open-url` */
export const BROWSER_OPEN_URL_EVENT = 'browser://open-url';
/** 浏览器元素选择取消事件：`browser://picker-cancelled` */
export const BROWSER_PICKER_CANCELLED_EVENT = 'browser://picker-cancelled';
/** 浏览器元素选择 prompt 提交事件：`browser://prompt-submitted` */
export const BROWSER_PROMPT_SUBMITTED_EVENT = 'browser://prompt-submitted';
/** 浏览器页面元信息事件（标题/favicon）：`browser://page-meta` */
export const BROWSER_PAGE_META_EVENT = 'browser://page-meta';
