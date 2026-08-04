import { useCallback } from 'react';

import { useNotificationStore } from '@/shared/store/notificationStore';

/**
 * Shared notification-center wrapper.
 *
 * Pushes a notification into the global notification store, replacing the
 * repeated `useNotificationStore.getState().addNotification(...)` inline
 * patterns scattered across feature components.
 */
export function useNotify() {
  const notify = useCallback((message: string, type: 'info' | 'error' = 'info', title?: string) => {
    useNotificationStore.getState().addNotification({
      type,
      title: title ?? (type === 'error' ? 'Error' : 'Notification'),
      message,
    });
  }, []);

  return { notify };
}
