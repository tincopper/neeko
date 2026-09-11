/**
 * Tauri Event 名称统一模块（前端侧单一事实源）。
 *
 * 与 `src-tauri/src/common/file/watcher/types.rs` 顶部的事件常量保持同步：
 * FILE_CHANGED_EVENT / FILE_TREE_CHANGED_EVENT / GIT_STATUS_SNAPSHOT_EVENT /
 * GIT_CHANGED_EVENT / GIT_PERF_SUGGESTION_EVENT。
 * 其余分组见各自文件头（LSP → `lsp/types.rs`、DAP → `dap/events.rs`、…）。
 * 禁止在业务代码中硬编码事件字符串。
 */

/** 文件内容变更事件：`file-changed` */
export const FILE_CHANGED_EVENT = 'file-changed';
/** Git 性能建议事件（G7，一次性）：`git-perf-suggestion` */
export const GIT_PERF_SUGGESTION_EVENT = 'git-perf-suggestion';
/** 文件树结构变更事件：`file-tree-changed` */
export const FILE_TREE_CHANGED_EVENT = 'file-tree-changed';
/** G2 事件协议 v2：versioned 全量 git-status 快照（单一权威，整体替换）：`git-status-snapshot` */
export const GIT_STATUS_SNAPSHOT_EVENT = 'git-status-snapshot';
/** Git 状态变更事件（worktree HEAD 外部变化等场景的主动刷新 fallback）：`git-changed` */
export const GIT_CHANGED_EVENT = 'git-changed';

/** 应用关闭请求事件（后端阻止关闭后通知前端弹「确认退出」框）：`app-close-requested` */
export const APP_CLOSE_REQUESTED_EVENT = 'app-close-requested';

// ── LSP 事件（与 src-tauri/src/lsp/types.rs 常量保持同步）──

/** LSP 自动安装进度事件：`lsp-install-progress` */
export const LSP_INSTALL_PROGRESS_EVENT = 'lsp-install-progress';

/** LSP 诊断推送事件前缀（拼接 projectPath）：`lsp-diagnostics-{projectPath}` */
export const LSP_DIAG_EVENT_PREFIX = 'lsp-diagnostics-';
/** LSP work-done 进度事件前缀（拼接 projectPath）：`lsp-progress-{projectPath}` */
export const LSP_PROGRESS_EVENT_PREFIX = 'lsp-progress-';
/** LSP 项目语言 profile 广播事件：`lsp-project-profile` */
export const LSP_PROFILE_EVENT = 'lsp-project-profile';

// ── DAP 事件（与 src-tauri/src/dap/events.rs 常量保持同步）──

/** 调试事件载荷（断点命中 / 输出 / terminated 等）：`dap-event` */
export const DAP_EVENT = 'dap-event';
/** 调试会话状态变更事件：`dap-session-status` */
export const DAP_SESSION_STATUS_EVENT = 'dap-session-status';

/**
 * 插入到 agent 输入框事件（DOM CustomEvent，best-effort 桥接）：`neeko:insert-to-agent-input`
 * ProjectWorkspace dispatch，agent 输入组件可监听。统一此处单一事实源，禁止硬编码。
 */
export const INSERT_TO_AGENT_INPUT_EVENT = 'neeko:insert-to-agent-input';

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

// ── Agent Chat 事件（与 src-tauri/src/agent_chat/events.rs 常量保持同步）──

/** Agent Chat 流式事件通道（StreamEvent 统一协议）：`agent-chat://event` */
export const AGENT_CHAT_EVENT = 'agent-chat://event';
/** 文档翻译流式事件通道（同 StreamEvent 协议，与聊天隔离）：`translation://event` */
export const TRANSLATION_EVENT = 'translation://event';

// ── 菜单/标签页事件（与 src-tauri/src/app_menu.rs 常量保持同步）──

/** 关闭当前标签页事件（Cmd+W / Ctrl+W 菜单触发，前端关闭激活 tab）：`close-tab` */
export const CLOSE_TAB_EVENT = 'close-tab';
