import React from 'react';
import { cn } from '@/lib/utils';

interface MessageBubbleProps {
  /** Drives the accent color of the left strip and role label. */
  role: 'user' | 'assistant';
  /** Role label text, e.g. "You", an agent name, or "Assistant". */
  label: string;
  /** Optional leading icon (agent logo / project avatar). */
  icon?: React.ReactNode;
  /** Message timestamp (ms epoch). */
  timestamp: number;
  /** Optional model tag shown after the time. */
  model?: string;
  /** Vertical padding preset — blocks use a bit more room than plain text. */
  dense?: boolean;
  children: React.ReactNode;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Shared visual shell for a single role block in the conversation viewer:
 * a left accent strip + role header (icon/label/time/model) wrapping arbitrary
 * body content. User messages get a soft blue wash so turns separate cleanly
 * from the flat assistant blocks.
 */
const MessageBubble: React.FC<MessageBubbleProps> = React.memo(
  ({ role, label, icon, timestamp, model, dense = false, children }) => {
    const isUser = role === 'user';
    return (
      <div className={cn('px-4', dense ? 'py-3' : 'py-4')}>
        <div
          className={cn(
            'border-l-2 pl-3 text-text-primary',
            isUser
              ? 'border-l-accent-blue/70 bg-accent-blue/[0.06] rounded-r-md py-2 pr-3'
              : 'border-l-accent-green/60',
          )}
        >
          <div className="flex items-center gap-1.5 mb-2">
            {icon}
            <span
              className={cn(
                'text-[11px] font-medium',
                isUser ? 'text-accent-blue' : 'text-accent-green',
              )}
            >
              {label}
            </span>
            <span className="text-[11px] text-text-secondary/40 font-normal">
              {formatTime(timestamp)}
            </span>
            {model ? (
              <span className="text-[10px] font-mono text-text-secondary/40">· {model}</span>
            ) : null}
          </div>
          {children}
        </div>
      </div>
    );
  },
);
MessageBubble.displayName = 'MessageBubble';

export default MessageBubble;
