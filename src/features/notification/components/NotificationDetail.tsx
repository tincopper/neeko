import * as Dialog from '@radix-ui/react-dialog';
import { Info, CheckCircle, AlertTriangle, AlertCircle, Copy, Check } from 'lucide-react';
import { useState, useCallback } from 'react';

import type { Notification, NotificationType } from '../notificationTypes';

interface NotificationDetailProps {
  notification: Notification | null;
  onClose: () => void;
}

const typeIcons: Record<NotificationType, React.FC<{ size?: number; className?: string }>> = {
  info: (props) => <Info {...props} />,
  success: (props) => <CheckCircle {...props} />,
  warning: (props) => <AlertTriangle {...props} />,
  error: (props) => <AlertCircle {...props} />,
};

const typeColors: Record<NotificationType, string> = {
  info: 'text-accent',
  success: 'text-status-idle',
  warning: 'text-yellow-500',
  error: 'text-status-error',
};

function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function NotificationDetail({ notification, onClose }: NotificationDetailProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!notification) return;
    try {
      await navigator.clipboard.writeText(
        `[${notification.title}]\n${notification.message}\n\n${formatDateTime(notification.timestamp)}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  }, [notification]);

  if (!notification) return null;

  return (
    <Dialog.Root
      open={!!notification}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[9998]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-popover border border-border rounded-lg shadow-xl z-[9999] w-[400px] max-w-[90vw]">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <span className={typeColors[notification.type]}>
              {typeIcons[notification.type]({ size: 16 })}
            </span>
            <Dialog.Title className="text-sm font-medium text-text-primary flex-1">
              {notification.title}
            </Dialog.Title>
            <Dialog.Close className="text-text-muted hover:text-text-primary transition-colors">
              <span className="sr-only">Close</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="M3 3l8 8M11 3l-8 8" />
              </svg>
            </Dialog.Close>
          </div>

          <div className="px-4 py-3">
            <p className="text-xs text-text-primary whitespace-pre-wrap break-words leading-relaxed">
              {notification.message}
            </p>
            <p className="text-[11px] text-text-muted mt-3">
              {formatDateTime(notification.timestamp)}
            </p>
          </div>

          <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md bg-popover border border-border text-text-primary hover:bg-hover transition-colors"
            >
              {copied ? (
                <>
                  <Check size={12} />
                  Copied
                </>
              ) : (
                <>
                  <Copy size={12} />
                  Copy
                </>
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
