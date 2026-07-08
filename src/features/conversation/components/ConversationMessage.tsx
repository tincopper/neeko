import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
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
        'flex flex-col gap-2 px-4 py-3',
        isUser
          ? 'bg-blue-500/5 border-l-2 border-l-blue-400'
          : isSystem
            ? 'bg-yellow-500/5 border-l-2 border-l-yellow-400'
            : 'bg-green-500/5 border-l-2 border-l-green-400',
      )}
    >
      {/* Role + Timestamp header */}
      <div className="flex items-center gap-2 text-xs select-none">
        <span
          className={cn(
            'font-semibold px-1.5 py-0.5 rounded text-[11px]',
            isUser
              ? 'bg-blue-500/15 text-blue-400'
              : isSystem
                ? 'bg-yellow-500/15 text-yellow-400'
                : 'bg-green-500/15 text-green-400',
          )}
        >
          {isUser ? 'You' : isSystem ? 'System' : 'Assistant'}
        </span>
        <span className="text-text-secondary/40">{time}</span>
      </div>

      {/* Markdown content */}
      <div className="prose prose-sm max-w-none prose-invert prose-headings:text-text-primary prose-p:text-text-primary prose-code:text-accent-blue prose-code:bg-bg-tertiary prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-pre:bg-bg-tertiary prose-pre:border prose-pre:border-border prose-a:text-accent-blue prose-strong:text-text-primary prose-li:text-text-primary">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
        >
          {message.content}
        </ReactMarkdown>
      </div>
    </div>
  );
});
ConversationMessage.displayName = 'ConversationMessage';

export default ConversationMessage;
