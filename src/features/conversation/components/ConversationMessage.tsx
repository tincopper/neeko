import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { cn } from '@/lib/utils';
import 'highlight.js/styles/github-dark.min.css';
import type { ConversationMessage as ConversationMessageType } from '../types';

interface ConversationMessageProps {
  message: ConversationMessageType;
}

const ConversationMessage: React.FC<ConversationMessageProps> = React.memo(({ message }) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const time = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <span className="text-[11px] text-text-secondary/40 bg-bg-secondary/50 px-3 py-0.5 rounded-full">
          {message.content}
        </span>
      </div>
    );
  }

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
        <div className={cn('text-[11px] font-medium mb-1', isUser ? 'text-blue-400' : 'text-green-400')}>
          {isUser ? 'You' : 'Assistant'}
          <span className="ml-2 text-text-secondary/30 font-normal">{time}</span>
        </div>

        {/* Markdown body */}
        <div className="prose prose-sm max-w-none prose-invert prose-p:my-1 prose-headings:text-text-primary prose-headings:my-2 prose-code:before:content-none prose-code:after:content-none prose-code:text-accent-blue prose-code:bg-bg-tertiary/50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-pre:bg-[#0d1117] prose-pre:border prose-pre:border-border prose-pre:rounded-lg prose-a:text-accent-blue prose-li:text-text-primary prose-li:my-0.5 prose-strong:text-text-primary">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
});
ConversationMessage.displayName = 'ConversationMessage';

export default ConversationMessage;
