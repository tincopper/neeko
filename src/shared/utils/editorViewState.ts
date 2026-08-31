/**
 * editorViewState — 文件 tab 视图状态缓存
 *
 * FileViewer 在切换 tab 时会卸载非激活 tab 的 FileEditor / preview 容器，
 * 导致 CodeMirror EditorView、markdown 滚动 div、HTML iframe 的 scrollTop
 * 全部丢失。本模块提供一个 module 级 Map，在卸载前抓快照、挂载后恢复。
 *
 * 故意不放 zustand store：
 * - scrollTop 高频变化，进 store 会引发不必要 re-render；
 * - 这是 UI 瞬态状态，不需要持久化到 sessions.json / config.json。
 */

export type ViewVariant = 'editor' | 'markdown' | 'html' | 'svg' | 'json';

/**
 * CodeMirror 的 EditorSelection.toJSON() 形状。
 * 重新声明而非直接 import 类型，避免在仅做 cache 操作的代码里引入 @codemirror 依赖。
 */
export interface SerializedSelection {
  ranges: Array<{ anchor: number; head: number }>;
  main: number;
}

export interface ViewSnapshot {
  scrollTop: number;
  /** 仅 editor variant 使用 */
  selection?: SerializedSelection;
}

const cache = new Map<string, ViewSnapshot>();

function key(tabKey: string, tabId: string, variant: ViewVariant): string {
  return `${tabKey} ${tabId} ${variant}`;
}

export function getViewSnapshot(
  tabKey: string,
  tabId: string,
  variant: ViewVariant,
): ViewSnapshot | undefined {
  return cache.get(key(tabKey, tabId, variant));
}

export function setViewSnapshot(
  tabKey: string,
  tabId: string,
  variant: ViewVariant,
  snap: ViewSnapshot,
): void {
  cache.set(key(tabKey, tabId, variant), snap);
}

/**
 * 清除某个 tab 的快照。
 * - 指定 variant：仅清该 variant
 * - 不指定 variant：清该 tab 全部 variant
 */
export function clearViewSnapshot(tabKey: string, tabId: string, variant?: ViewVariant): void {
  if (variant) {
    cache.delete(key(tabKey, tabId, variant));
    return;
  }
  const variants: ViewVariant[] = ['editor', 'markdown', 'html', 'svg', 'json'];
  for (const v of variants) {
    cache.delete(key(tabKey, tabId, v));
  }
}

/**
 * 清除某个 tabKey 下所有快照（切项目 / 关项目时调用）。
 */
export function clearAllForTabKey(tabKey: string): void {
  const prefix = `${tabKey} `;
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

/** 仅供测试使用 */
export function __resetForTest(): void {
  cache.clear();
}
