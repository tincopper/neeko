import { useCallback, useState } from 'react';

import { confirmAppExit } from '@/features/settings/api/settingsApi';
import { APP_CLOSE_REQUESTED_EVENT } from '@/shared/events';
import { useTauriEvent } from '@/shared/hooks/useTauriEvent';

/**
 * 应用关闭确认：后端在 CloseRequested 时阻止关闭并发送
 * `app-close-requested` 事件，本 hook 收到后弹出确认框；
 * 用户确认后调用 `confirmAppExit` 销毁窗口，取消则仅关闭对话框。
 */
export function useConfirmExit() {
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);

  // 稳定 handler：避免每次渲染触发 useTauriEvent 重复订阅/注销
  const handleCloseRequest = useCallback(() => setConfirmExitOpen(true), []);

  useTauriEvent(APP_CLOSE_REQUESTED_EVENT, handleCloseRequest);

  const closeExitDialog = useCallback(() => setConfirmExitOpen(false), []);
  const confirmExit = useCallback(() => {
    setConfirmExitOpen(false);
    void confirmAppExit();
  }, []);

  return { confirmExitOpen, closeExitDialog, confirmExit };
}
