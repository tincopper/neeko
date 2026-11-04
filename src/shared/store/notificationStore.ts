import { create } from 'zustand';

import type { Notification, NotificationStore } from './notificationTypes';

const MAX_NOTIFICATIONS = 100;

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],
  unreadCount: 0,

  addNotification: (data) => {
    const id = crypto.randomUUID();
    const notification: Notification = {
      ...data,
      id,
      timestamp: Date.now(),
      read: false,
    };
    set((state) => {
      const next = [notification, ...state.notifications].slice(0, MAX_NOTIFICATIONS);
      return {
        notifications: next,
        unreadCount: state.unreadCount + 1,
      };
    });
    return id;
  },

  markAsRead: (id) => {
    set((state) => {
      const target = state.notifications.find((n) => n.id === id);
      if (!target || target.read) return state;
      return {
        notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        unreadCount: Math.max(0, state.unreadCount - 1),
      };
    });
  },

  markAllAsRead: () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }));
  },

  removeNotification: (id) => {
    set((state) => {
      const target = state.notifications.find((n) => n.id === id);
      return {
        notifications: state.notifications.filter((n) => n.id !== id),
        unreadCount: Math.max(0, state.unreadCount - (target && !target.read ? 1 : 0)),
      };
    });
  },

  clearAll: () => {
    set({ notifications: [], unreadCount: 0 });
  },
}));

/**
 * 命令式 in-app 提示出口（= `useAppContext().showToast` 的同一事实，不依赖 Provider）。
 *
 * 存在的理由：`showToast` 经 Context 分发，而**应用级 handler**（组合根 `App.tsx`
 * 在 Provider 之外装配的 dock 栏入口）拿不到 Context。store 侧直写是同一实现，
 * 不是第二份表示 —— 因此 `useAppShellData` 的 `showToast` 也委托到这里（单一映射）。
 *
 * 标题映射：error → `Error`，其余 → `Info`。
 */
export function notify(message: string, type: 'info' | 'error' = 'info'): void {
  useNotificationStore.getState().addNotification({
    type: type === 'error' ? 'error' : 'info',
    title: type === 'error' ? 'Error' : 'Info',
    message,
  });
}
