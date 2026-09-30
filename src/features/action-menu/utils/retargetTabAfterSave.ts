import { closeEditorTab } from '@/features/terminal';
import { useEditorStore } from '@/shared/store/editorStore';
import type { FileContent } from '@/shared/types';
import { canonicalFsPath } from '@/shared/utils/fileRef';
import { getTabId } from '@/shared/utils/fileTree';

/** Save As 落盘后 tab 身份迁移所需的最小输入。 */
export interface RetargetTabAfterSaveArgs {
  /** 源 tab 空间（主仓 tab space 或 worktree tab space）。 */
  tabKey: string;
  /** 源 tab id（通常是 untitled tab）。 */
  tabId: string;
  /** 保存目标根目录（worktree 激活时为该工作树根，否则项目根）。 */
  saveRoot: string;
  /** `saveNewFile` 返回的仓库相对路径。 */
  relPath: string;
  /** 保存后的文件名（新的 tab 标题）。 */
  filename: string;
  /** 文件内容：写回 tab 缓存，避免保存后再读一次盘。 */
  content: string;
  /** 关闭确认触发的 Save As：保存成功即关 tab（untitled「保存后关闭」闭环）。 */
  closeAfterSave: boolean | undefined;
}

/**
 * Save As 落盘后，把 tab 身份从「untitled / 旧路径」迁移到新的 canonical 绝对路径。
 *
 * 为什么三步必须在**一处**发生（拆分会产生 id 与 filePath 脱钩的中间态）：
 * 1. 目标 canonical 路径已作为 tab 打开 → 磁盘已被新内容覆盖，而 `renameTab` 会因 id 冲突
 *    拒绝迁移 ⇒ 关源 tab、激活既有目标 tab，不残留重复 tab；
 * 2. 否则 `updateTab` 改 data + `renameTab` 把 id 同步迁移到新身份
 *    （`updateTab` 只改 data 不改 id，少这一步 id 与 filePath 永久不一致）；
 * 3. `closeAfterSave` 时保存成功即关 tab。
 *
 * 只依赖 `useEditorStore` 的命令式读取（`getState()`），不绑 React 生命周期 ——
 * Save As 是一次性动作，没有可订阅的渲染状态。
 */
export function retargetTabAfterSave(args: RetargetTabAfterSaveArgs): void {
  const { tabKey, tabId, saveRoot, relPath, filename, content, closeAfterSave } = args;
  // tab 身份恒为 canonical 绝对路径：Save As 根与 saveNewFile 的 resolve_base 对齐
  const canonicalPath = canonicalFsPath(saveRoot, relPath);
  const newTabId = getTabId(tabKey, canonicalPath);
  const store = useEditorStore.getState();

  const targetOpen = store.tabs[tabKey]?.tabs.some((t) => t.id === newTabId);
  if (targetOpen) {
    closeEditorTab(tabKey, tabId);
    store.activateTab(tabKey, newTabId);
    return;
  }

  store.updateTab(tabKey, tabId, {
    filePath: canonicalPath,
    title: filename,
    isDirty: false,
    isUntitled: false,
    initialPreviewMode: undefined,
    content: {
      path: canonicalPath,
      content,
      size: content.length,
      is_binary: false,
    } satisfies FileContent,
  });
  // 修身份脱钩：updateTab 只改 data 不改 id，Save As 后必须把 tab.id 同步迁移到新身份。
  store.renameTab(tabKey, tabId, newTabId);
  if (closeAfterSave) {
    // 经 terminal 门面关闭，保证 PTY 回收等清理与其它关闭路径一致。
    closeEditorTab(tabKey, newTabId);
  } else {
    store.activateTab(tabKey, newTabId);
  }
}
