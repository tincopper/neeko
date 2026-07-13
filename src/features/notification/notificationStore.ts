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
