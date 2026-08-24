import React, { useCallback, useState } from 'react';

import ProjectAvatar from '@/shared/components/ProjectAvatar';
import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard';

import type { ConversationMessage as ConversationMessageType } from '../types';
import { messageToText } from '../utils/messageToText';

import { MessageBlockList, TextBlock } from './MessageBlocks';
import MessageBubble from './MessageBubble';

interface ConversationMessageProps {
  message: ConversationMessageType;
  /** Project display name for the user avatar. */
  projectName?: string | null;
  /** Project avatar_color override. */
  projectColor?: string | null;
  /** Search query; matching text is highlighted. */
  highlightQuery?: string;
}

const ConversationMessage: React.FC<ConversationMessageProps> = React.memo(
  ({ message, projectName, projectColor, highlightQuery }) => {
    const isUser = message.role === 'user';
    const isSystem = message.role === 'system';
    const copyToClipboard = useCopyToClipboard();
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
      const text = messageToText(message);
      if (!text) return;
      const ok = await copyToClipboard(text, 'message');
      if (ok) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }
    }, [message, copyToClipboard]);

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
        kind={isUser ? 'user' : 'assistant'}
        label={isUser ? 'You' : 'Assistant'}
        icon={
          isUser ? <ProjectAvatar name={projectName} color={projectColor} size={16} /> : undefined
        }
        timestamp={message.timestamp}
        dense={!hasBlocks}
        onCopy={handleCopy}
        copied={copied}
      >
        {hasBlocks ? (
          <MessageBlockList blocks={message.blocks} highlightQuery={highlightQuery} />
        ) : (
          <TextBlock text={message.content} highlightQuery={highlightQuery} />
        )}
      </MessageBubble>
    );
  },
);
ConversationMessage.displayName = 'ConversationMessage';

export default ConversationMessage;
