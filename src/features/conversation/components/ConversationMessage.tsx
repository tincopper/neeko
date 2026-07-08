import React from 'react';
import { cn } from '@/lib/utils';
import type { ConversationMessage as ConversationMessageType } from '../types';

interface ConversationMessageProps {
  message: ConversationMessageType;
}

const ConversationMessage: React.FC<ConversationMessageProps> = React.memo(({ message }) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const time = new Date(message.timestamp).toLocaleTimeString();

  return (
    <div
      className={cn(
        'flex flex-col gap-1 px-4 py-3 border-l-2',
        isUser
          ? 'border-l-accent-blue bg-white/[0.02]'
          : isSystem
            ? 'border-l-accent-yellow bg-white/[0.01]'
            : 'border-l-accent-green bg-white/[0.02]',
      )}
    >
      <div className="flex items-center gap-2 text-xs text-text-secondary">
        <span className={cn(
          'font-medium',
          isUser ? 'text-accent-blue' : isSystem ? 'text-accent-yellow' : 'text-accent-green',
        )}>
          {isUser ? 'User' : isSystem ? 'System' : 'Assistant'}
        </span>
        <span>{time}</span>
      </div>
      <pre className="m-0 whitespace-pre-wrap break-words text-[var(--font-size)] text-text-primary font-mono leading-relaxed">
        {message.content}
      </pre>
    </div>
  );
});
ConversationMessage.displayName = 'ConversationMessage';

export default ConversationMessage;
