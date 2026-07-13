import { Info, CircleCheckBig, CircleAlert, CircleX, X } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';

import { useNotificationStore } from '../notificationStore';
import type { NotificationType } from '../notificationTypes';

interface NotificationToastProps {
  onOpenList: () => void;
  listOpen: boolean;
}

const TOAST_DURATION = 4000;

const typeIcons: Record<NotificationType, React.FC<{ size?: number; className?: string }>> = {
  info: (props) => <Info strokeWidth={2.5} {...props} />,
  success: (props) => <CircleCheckBig strokeWidth={2.5} {...props} />,
  warning: (props) => <CircleAlert strokeWidth={2.5} {...props} />,
  error: (props) => <CircleX strokeWidth={2.5} {...props} />,
};

const typeStyles: Record<NotificationType, string> = {
  info: 'border-l-blue-400',
  success: 'border-l-status-idle',
  warning: 'border-l-yellow-400',
  error: 'border-l-destructive',
};

export function NotificationToast({ onOpenList, listOpen }: NotificationToastProps) {
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const [visibleId, setVisibleId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleIdRef = useRef<string | null>(null);

  useEffect(() => {
    visibleIdRef.current = visibleId;
  }, [visibleId]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const unsub = useNotificationStore.subscribe((state, prevState) => {
      if (listOpen) return;
      const latest = state.notifications[0];
      const prevLatest = prevState.notifications[0];
      if (!latest) return;
      if (prevLatest && latest.id === prevLatest.id) return;
      clearTimer();
      setVisibleId(latest.id);
      timerRef.current = setTimeout(() => {
        setVisibleId(null);
      }, TOAST_DURATION);
    });
    return () => {
      unsub();
      clearTimer();
    };
  }, [listOpen, clearTimer]);

  const current = useNotificationStore((s) =>
    visibleId ? (s.notifications.find((n) => n.id === visibleId) ?? null) : null,
  );

  const handleClick = useCallback(() => {
    clearTimer();
    setVisibleId(null);
    if (visibleIdRef.current) {
      markAsRead(visibleIdRef.current);
    }
    onOpenList();
  }, [markAsRead, onOpenList, clearTimer]);

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      clearTimer();
      setVisibleId(null);
    },
    [clearTimer],
  );

  if (!current) return null;

  return (
    <div className="fixed bottom-8 right-12 z-[9999] animate-slide-up">
      <button
        type="button"
        onClick={handleClick}
        className={`flex items-start gap-2.5 bg-popover border border-border rounded-lg shadow-lg px-3 py-2.5 text-left max-w-[320px] cursor-pointer hover:bg-hover transition-colors border-l-2 ${typeStyles[current.type]}`}
      >
        <span className="mt-0.5 shrink-0">{typeIcons[current.type]({ size: 14 })}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-text-primary truncate">{current.title}</p>
          <p className="text-[11px] text-text-muted truncate mt-0.5">{current.message}</p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="shrink-0 text-text-muted hover:text-text-primary transition-colors"
        >
          <X size={12} strokeWidth={1.8} />
        </button>
      </button>
    </div>
  );
}
