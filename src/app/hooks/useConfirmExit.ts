import { useCallback, useState } from 'react';

import { confirmAppExit } from '@/features/settings/api/settingsApi';
import { APP_CLOSE_REQUESTED_EVENT } from '@/shared/events';
import { useTauriEvent } from '@/shared/hooks/useTauriEvent';
import { useEditorStore } from '@/shared/store/editorStore';
import { getTabDisplayName, isDirtyFileTab } from '@/shared/utils/fileTree';

/**
 * 应用关闭确认：后端在 CloseRequested 时阻止关闭并发送
 * `app-close-requested` 事件，本 hook 收到后收集所有未保存文件并弹出确认框；
 * 用户确认后调用 `confirmAppExit` 销毁窗口，取消则仅关闭对话框。
 */
export function useConfirmExit() {
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  const [unsavedFileNames, setUnsavedFileNames] = useState<string[]>([]);

  // 稳定 handler：避免每次渲染触发 useTauriEvent 重复订阅/注销
  const handleCloseRequest = useCallback(() => {
    // 汇总所有项目 tab 空间中带未保存修改（isDirty）的文件 tab
    const tabs = useEditorStore.getState().tabs;
    const dirty: string[] = [];
    for (const key of Object.keys(tabs)) {
      for (const tab of tabs[key].tabs) {
        if (isDirtyFileTab(tab)) {
          dirty.push(getTabDisplayName(tab));
        }
      }
    }
    setUnsavedFileNames(dirty);
    setConfirmExitOpen(true);
  }, []);

  useTauriEvent(APP_CLOSE_REQUESTED_EVENT, handleCloseRequest);

  const closeExitDialog = useCallback(() => setConfirmExitOpen(false), []);
  const confirmExit = useCallback(() => {
    setConfirmExitOpen(false);
    void confirmAppExit();
  }, []);

  return { confirmExitOpen, unsavedFileNames, closeExitDialog, confirmExit };
}
