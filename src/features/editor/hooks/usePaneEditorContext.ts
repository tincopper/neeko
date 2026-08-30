import { useMemo } from 'react';

import type { EditorContextValue } from '@/shared/contexts';
import type { EditorGroupId } from '@/shared/types';

/** 当前面板的局部 EditorContext 值：全局上下文 + 面板级 tab 操作 */
export function usePaneEditorContext(
  globalEditorCtx: EditorContextValue,
  activeTabId: string | null,
  onActivateTab: (tabId: string) => void,
  onCloseTab: (tabId: string) => void,
  onAddTab?: (targetGroup?: EditorGroupId | 'pinned') => void,
): EditorContextValue {
  return useMemo(
    () => ({
      ...globalEditorCtx,
      activeTabId,
      onActivateTab,
      onCloseTab,
      onAddTab: onAddTab ?? (() => {}),
    }),
    [globalEditorCtx, activeTabId, onActivateTab, onCloseTab, onAddTab],
  );
}
