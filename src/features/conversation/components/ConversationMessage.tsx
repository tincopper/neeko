import React from 'react';
import { cn } from '@/lib/utils';
import { MessageBlockRenderer, TextBlock } from './MessageBlocks';
import type { ConversationMessage as ConversationMessageType } from '../types';

interface ConversationMessageProps {
  message: ConversationMessageType;
}

const ConversationMessage: React.FC<ConversationMessageProps> = React.memo(({ message }) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <span className="text-[11px] text-text-secondary/40 bg-bg-secondary/50 px-3 py-0.5 rounded-full">
          {message.content}
        </span>
      </div>
    );
  }

  // 如果有 blocks，使用块渲染器
  if (message.blocks && message.blocks.length > 0) {
    return (
      <div className={cn('flex gap-3 px-4 py-3', isUser ? 'justify-end' : 'justify-start')}>
        <div
          className={cn(
            'max-w-[85%] rounded-2xl px-4 py-3',
            isUser
              ? 'bg-blue-500/15 text-text-primary rounded-br-md'
              : 'bg-bg-secondary text-text-primary rounded-bl-md border border-border/50',
          )}
        >
          {/* Role label */}
          <div
            className={cn(
              'text-[11px] font-medium mb-2',
              isUser ? 'text-blue-400' : 'text-green-400',
            )}
          >
            {isUser ? 'You' : 'Assistant'}
            <span className="ml-2 text-text-secondary/30 font-normal">{time}</span>
          </div>

          {/* Render all content blocks */}
          <div className="space-y-0.5">
            {message.blocks.map((block, idx) => (
              <MessageBlockRenderer key={idx} block={block} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 向后兼容：如果没有 blocks，使用 TextBlock 渲染 markdown
  return (
    <div className={cn('flex gap-3 px-4 py-2', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-xl px-4 py-3',
          isUser
            ? 'bg-blue-500/15 text-text-primary rounded-br-md'
            : 'bg-bg-secondary text-text-primary rounded-bl-md border border-border/50',
        )}
      >
        {/* Role label */}
        <div
          className={cn(
            'text-[11px] font-medium mb-1',
            isUser ? 'text-blue-400' : 'text-green-400',
          )}
        >
          {isUser ? 'You' : 'Assistant'}
          <span className="ml-2 text-text-secondary/30 font-normal">{time}</span>
        </div>

        {/* Content - 使用 TextBlock 渲染 markdown */}
        <TextBlock text={message.content} />
      </div>
    </div>
  );
});
ConversationMessage.displayName = 'ConversationMessage';

export default ConversationMessage;
