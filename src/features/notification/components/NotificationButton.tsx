import { Bell } from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';

import { useNotificationStore } from '../notificationStore';

import { NotificationList } from './NotificationList';
import { NotificationToast } from './NotificationToast';

export function NotificationButton() {
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const [listOpen, setListOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleList = useCallback(() => {
    setListOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!listOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !(target as Element).closest?.('[data-notification-list]') &&
        !(target as Element).closest?.('[data-notification-detail]')
      ) {
        setListOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [listOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleList}
        className="relative flex items-center justify-center w-5 h-5 hover:text-text-primary transition-colors"
        title="Notifications"
      >
        <Bell size={14} strokeWidth={1.8} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-destructive text-[10px] font-medium text-white leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {listOpen && <NotificationList buttonRef={buttonRef} />}
      <NotificationToast listOpen={listOpen} />
    </div>
  );
}
