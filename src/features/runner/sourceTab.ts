/**
 * 打开请求 → **tab 存在并激活**（机制层）。
 *
 * 只负责 tab 生命周期：复用 / 新建 / 激活 + 导航历史 + 失败上报。
 * **不决定「要不要跳转」**：用户意图的一次性跳转目标由 `navigate.ts` 写；
 * 停点跟随由编辑器从 `location` 派生 —— 本模块对两者一无所知。
 */
import { useEditorStore } from '@/shared/store/editorStore';
import {
  captureCurrentNavLocation,
  recordNavigationJump,
} from '@/shared/store/navigationHistoryStore';
import type { Tab } from '@/shared/types';
import { preloadLanguageExtension } from '@/shared/utils/codemirror';
import { sameIdentity } from '@/shared/utils/fileRef';
import { getTabId, isFileTab } from '@/shared/utils/fileTree';

import type { SourceOpenRequest } from './sourceOpen';

function describeError(error: unknown): string {
  return String(error).replace(/^Error:\s*/, '');
}

/** 打开结果：已激活的 tab 与**已钳制**的行列。 */
export interface EnsureSourceTabResult {
  tabId: string;
  line: number;
  col: number;
}

export interface EnsureSourceTabRequest {
  tabKey: string;
  projectId: string;
  request: SourceOpenRequest;
  line: number;
  column: number;
  /** 失败上报（如 Debug Console）；本模块不 import 任何 store 之外的错误通道。 */
  onError?: (message: string) => void;
  /**
   * 落地许可。**两处校验**，缺一不可：
   * 1. 入口处（做任何事之前）：许可已失效则连 `preload` / 内容读取都不发生；
   * 2. `await load()` 之后、`addTab` / `activateTab` 之前：内容加载期间被取代则放弃建 tab。
   */
  canCommit?: () => boolean;
}

/**
 * 打开（或复用）源码 tab 并激活。
 *
 * @returns 已激活的 tab 与钳制后的行列；被落地许可拦下 / 加载失败时返回 null
 */
export async function ensureSourceTab(
  req: EnsureSourceTabRequest,
): Promise<EnsureSourceTabResult | null> {
  const { tabKey, projectId, request, line, column, onError, canCommit } = req;
  const { identity, tabTitle, load } = request;

  if (canCommit && !canCommit()) return null;

  // Warm the language pack before the tab mounts so CodeMirror configures once.
  preloadLanguageExtension(identity);

  const store = useEditorStore.getState();
  // 复用查找走**身份比较**：tab 存的形态可能与本次身份不完全同形（历史 / 会话恢复的 tab），
  // 字符串等值会漏判并再开一个 tab（同文件两份 tab → 断点/黄线/跳转各认一个）。
  const existing = (store.tabs[tabKey]?.tabs ?? [])
    .filter(isFileTab)
    .find((t) => sameIdentity(identity, t.data.filePath));

  const line1 = Math.max(1, line);
  const col = Math.max(0, column);
  // Captured before opening so "back" returns to where the jump started; only
  // recorded once the file actually opens (a failed load must not pollute the
  // navigation history).
  const from = captureCurrentNavLocation();
  const to = { projectId, tabKey, filePath: identity, line: line1, column: col };

  if (existing) {
    recordNavigationJump(from, to);
    store.activateTab(tabKey, existing.id);
    return { tabId: existing.id, line: line1, col };
  }

  const loaded = await load();
  // ★ 迟到许可：内容加载到这里才算完成，此时这次打开可能已被取代。
  if (canCommit && !canCommit()) return null;

  if (loaded.kind === 'failed') {
    console.error('[DAP] Failed to open source:', identity, loaded.error);
    onError?.(`Failed to open source: ${identity} (${describeError(loaded.error)})`);
    return null;
  }

  const fresh = useEditorStore.getState();
  const tabId = getTabId(tabKey, identity);
  const newTab: Tab = {
    id: tabId,
    projectId,
    title: tabTitle,
    order: fresh.tabs[tabKey]?.tabs.length ?? 0,
    data: {
      kind: 'file',
      filePath: identity,
      fileName: tabTitle,
      content: loaded.content,
      isDirty: false,
      // External / virtual sources are read-only: no save path, no dirty tracking.
      readOnly: loaded.kind === 'project' ? undefined : true,
    },
  };
  recordNavigationJump(from, to);
  fresh.addTab(tabKey, newTab);
  return { tabId, line: line1, col };
}
