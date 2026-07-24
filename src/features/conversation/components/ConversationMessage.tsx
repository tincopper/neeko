import React from 'react';
import { MessageBlockRenderer, TextBlock } from './MessageBlocks';
import MessageBubble from './MessageBubble';
import ProjectAvatar from '@/shared/components/ProjectAvatar';
import type { ConversationMessage as ConversationMessageType } from '../types';

interface ConversationMessageProps {
  message: ConversationMessageType;
  /** Project display name for the user avatar. */
  projectName?: string | null;
  /** Project avatar_color override. */
  projectColor?: string | null;
}

const ConversationMessage: React.FC<ConversationMessageProps> = React.memo(
  ({ message, projectName, projectColor }) => {
    const isUser = message.role === 'user';
    const isSystem = message.role === 'system';

    if (isSystem) {
      return (
        <div className="flex justify-center py-1">
          <span className="text-[11px] text-text-secondary/40 bg-bg-secondary/50 px-3 py-0.5 rounded-full">
            {message.content}
          </span>
        </div>
      );
    }

    const hasBlocks = message.blocks && message.blocks.length > 0;

    return (
      <MessageBubble
        role={isUser ? 'user' : 'assistant'}
        label={isUser ? 'You' : 'Assistant'}
        icon={
          isUser ? (
            <ProjectAvatar name={projectName} color={projectColor} size={16} />
          ) : undefined
        }
        timestamp={message.timestamp}
        dense={!hasBlocks}
      >
        {hasBlocks ? (
          <div className="space-y-0.5">
            {message.blocks.map((block, idx) => (
              <MessageBlockRenderer key={idx} block={block} />
            ))}
          </div>
        ) : (
          <TextBlock text={message.content} />
        )}
      </MessageBubble>
    );
  },
);
ConversationMessage.displayName = 'ConversationMessage';

export default ConversationMessage;
