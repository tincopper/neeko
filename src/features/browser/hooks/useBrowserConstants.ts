/**
 * 派生指定项目的浏览器 webview label。
 * 与后端约定格式一致。
 */
export const getProjectBrowserLabel = (projectId: string): string => `neeko-browser-${projectId}`;

/**
 * 派生编辑器 Browser tab 的 webview label（每 tab 独立 webview）。
 * 与后端约定格式一致：tabId 作为唯一键，事件路由按此 label 过滤。
 */
export const getBrowserTabLabel = (tabId: string): string => `neeko-browser-tab-${tabId}`;
