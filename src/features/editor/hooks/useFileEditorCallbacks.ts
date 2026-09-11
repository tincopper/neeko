import { closeSearchPanel, openSearchPanel, searchPanelOpen } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';
import { useCallback, type RefObject } from 'react';

import { useAppContext } from '@/shared/contexts';
import { useNotificationStore } from '@/shared/store/notificationStore';

import { useFileActionsContext } from '../FileActionsContext';

interface Params {
  /** CodeMirror 视图引用（页内搜索需要它开合查找面板）。 */
  editorViewRef: RefObject<EditorView | null>;
}

/** FileEditor 的视图级交互回调：内部链接跳转 / 页内搜索 / AI 助手占位。 */
export function useFileEditorCallbacks({ editorViewRef }: Params) {
  // Markdown / HTML preview 模式下点击内部链接时打开目标文件
  const { onFileSelect } = useFileActionsContext();
  const handleInternalLinkClick = useCallback(
    async (absPath: string) => {
      if (!onFileSelect) return;
      const ok = await onFileSelect(absPath);
      if (!ok) {
        useNotificationStore
          .getState()
          .addNotification({ type: 'error', title: 'Cannot Open File', message: absPath });
      }
    },
    [onFileSelect],
  );

  // 页内内容搜索：标题栏「搜索」按钮开合 CodeMirror 查找面板（Ctrl+F 由 searchKeymap 承担）
  const handleOpenSearch = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;
    if (searchPanelOpen(view.state)) closeSearchPanel(view);
    else openSearchPanel(view);
  }, [editorViewRef]);

  // AI 助手：占位入口，后续接入 Agent 选择器
  const { showToast } = useAppContext();
  const handleOpenAI = useCallback(() => {
    showToast('AI 助手功能即将接入', 'info');
  }, [showToast]);

  return { handleInternalLinkClick, handleOpenSearch, handleOpenAI };
}
