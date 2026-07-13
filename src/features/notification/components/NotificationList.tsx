import { Info, CircleCheckBig, CircleAlert, CircleX, BellOff } from 'lucide-react';
import { useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/shallow';

import { useNotificationStore } from '../notificationStore';
import type { NotificationType } from '../notificationTypes';

import { NotificationDetail } from './NotificationDetail';

interface NotificationListProps {
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}

const typeIcons: Record<NotificationType, React.FC<{ size?: number; className?: string }>> = {
  info: (props) => <Info strokeWidth={2.5} {...props} />,
  success: (props) => <CircleCheckBig strokeWidth={2.5} {...props} />,
  warning: (props) => <CircleAlert strokeWidth={2.5} {...props} />,
  error: (props) => <CircleX strokeWidth={2.5} {...props} />,
};

const typeColors: Record<NotificationType, string> = {
  info: 'text-blue-400',
  success: 'text-status-idle',
  warning: 'text-yellow-400',
  error: 'text-destructive',
};

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NotificationList({ buttonRef }: NotificationListProps) {
  const notifications = useNotificationStore(useShallow((s) => s.notifications.slice(0, 10)));
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead);
  const clearAll = useNotificationStore((s) => s.clearAll);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [style, setStyle] = useState<React.CSSProperties | undefined>(undefined);

  useLayoutEffect(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 4,
        right: window.innerWidth - rect.right,
      });
    }
  }, [buttonRef]);

  if (!style) return null;

  const detailNotification = detailId
    ? (notifications.find((n) => n.id === detailId) ?? null)
    : null;

  return (
    <>
      {createPortal(
        <div data-notification-list>
          <div
            className="bg-popover border border-border rounded-md shadow-lg py-1 z-50 w-[320px] max-h-[400px] flex flex-col"
            style={style}
          >
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
              <span className="text-xs font-medium text-text-primary">Notifications</span>
              {notifications.some((n) => !n.read) && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="text-[10px] text-accent-foreground hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-text-muted gap-2">
                  <BellOff size={20} strokeWidth={1.5} />
                  <span className="text-xs">No notifications</span>
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => setDetailId(n.id)}
                    className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-hover transition-colors"
                  >
                    <span className={`mt-0.5 shrink-0 ${typeColors[n.type]}`}>
                      {typeIcons[n.type]({ size: 14 })}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs truncate ${n.read ? 'text-text-muted' : 'text-text-primary font-medium'}`}
                        >
                          {n.title}
                        </span>
                        {!n.read && (
                          <span className="w-1.5 h-1.5 rounded-full bg-accent-foreground shrink-0" />
                        )}
                      </div>
                      <p className="text-[11px] text-text-muted truncate mt-0.5">{n.message}</p>
                    </div>
                    <span className="text-[10px] text-text-muted shrink-0 whitespace-nowrap">
                      {formatRelativeTime(n.timestamp)}
                    </span>
                  </button>
                ))
              )}
            </div>

            {notifications.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="w-full text-[11px] text-text-muted hover:text-text-primary py-1.5 border-t border-border transition-colors"
              >
                Clear all
              </button>
            )}

          </div>
        </div>,
        document.body,
      )}
      <NotificationDetail notification={detailNotification} onClose={() => setDetailId(null)} />
    </>
  );
}
