import { registerTabCleanup } from '@/shared/store/editorStore';
import type { Tab } from '@/shared/types/tab';

import { useTranslationStore } from './store';

/** 翻译状态的存储键：按文件（而非项目 tab 空间）隔离 */
export function translationKeyFor(projectId: string, filePath: string): string {
  return `${projectId}:${filePath}`;
}

/** 进行中翻译的 AbortController 注册表：关闭 tab 时中止，防止后台空跑 */
const activeControllers = new Map<string, AbortController>();

export function registerAbortController(key: string, controller: AbortController): void {
  // 同一文件重复发起（重译）→ 顶掉旧 controller
  activeControllers.set(key, controller);
}

export function unregisterAbortController(key: string, controller: AbortController): void {
  if (activeControllers.get(key) === controller) activeControllers.delete(key);
}

/** 中止该文件进行中的翻译（若有） */
function abortTranslation(key: string): void {
  const controller = activeControllers.get(key);
  if (controller) {
    controller.abort();
    activeControllers.delete(key);
  }
}

/**
 * File tab 的关闭清理 handler。
 *
 * 通过 `registerTabCleanup('file', ...)` 挂到 editorStore 的按 kind 分发注册表：
 * 关闭文件 tab（含 clearProjectTabs）时中止进行中的翻译并回收
 * translationStore 的 tab 维度状态（临时译文不落盘，共识 Q9）。
 */
export const translationTabCleanupHandler = (_tabKey: string, tab: Tab): void => {
  if (tab.data.kind !== 'file') return;
  const key = translationKeyFor(tab.projectId, tab.data.filePath);
  abortTranslation(key);
  useTranslationStore.getState().clear(key);
};

// 模块加载即注册（幂等）——关闭清理必须始终可用，不依赖某个 hook 是否挂载过。
// 'file' 槽位此前空闲；重复注册同一 handler 无害（Map.set）。
registerTabCleanup('file', translationTabCleanupHandler);

/** 幂等确保注册（供 hook / 视图每次渲染调用，防编辑器 store 热重载丢注册）。 */
export function ensureTranslationTabCleanupRegistered(): void {
  registerTabCleanup('file', translationTabCleanupHandler);
}
