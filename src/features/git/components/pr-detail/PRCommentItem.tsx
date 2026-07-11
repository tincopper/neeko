import React, { useState } from 'react';

import { cn } from '@/lib/utils';

import type { PRComment } from '../../types/comment';

interface PRCommentItemProps {
  comment: PRComment;
  isOwnComment?: boolean;
  onEdit?: (commentId: string, newBody: string) => void;
  onDelete?: (commentId: string) => void;
  onReact?: (commentId: string, emoji: string) => void;
}

const REACTION_EMOJIS = ['👍', '👎', '😄', '🎉', '❤️', '🚀', '👀', '😕'];

function formatRelativeTime(timestamp: string): string {
  if (!timestamp) return 'Unknown';

  const date = new Date(timestamp);

  // Check if date is valid
  if (isNaN(date.getTime())) {
    return timestamp || 'Unknown';
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

const PRCommentItem: React.FC<PRCommentItemProps> = ({
  comment,
  isOwnComment = false,
  onEdit,
  onDelete,
  onReact,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [showReactionPicker, setShowReactionPicker] = useState(false);

  const handleSaveEdit = () => {
    if (editBody.trim() && editBody !== comment.body) {
      onEdit?.(comment.id, editBody);
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditBody(comment.body);
    setIsEditing(false);
  };

  const handleReaction = (emoji: string) => {
    onReact?.(comment.id, emoji);
    setShowReactionPicker(false);
  };

  return (
    <div className="flex gap-3 py-4 px-4 border-b border-border hover:bg-bg-hover/50 transition-colors">
      {/* Avatar */}
      <div className="flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-bg-tertiary flex items-center justify-center text-text-muted text-sm font-medium">
          {comment.authorAvatar ? (
            <img
              src={comment.authorAvatar}
              alt={comment.author}
              className="w-full h-full rounded-full"
            />
          ) : (
            comment.author.charAt(0).toUpperCase()
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[var(--font-size)] font-semibold text-text-primary">
            {comment.author}
          </span>
          <span className="text-[calc(var(--font-size)-2px)] text-text-muted">
            commented {formatRelativeTime(comment.createdAt)}
          </span>
          {comment.updatedAt && comment.updatedAt !== comment.createdAt && (
            <span className="text-[calc(var(--font-size)-2px)] text-text-muted italic">
              (edited)
            </span>
          )}
          {isOwnComment && !isEditing && (
            <div className="flex items-center gap-1 ml-auto">
              <button
                className="text-[calc(var(--font-size)-2px)] text-text-muted hover:text-text-primary transition-colors"
                onClick={() => setIsEditing(true)}
              >
                Edit
              </button>
              <span className="text-text-muted">·</span>
              <button
                className="text-[calc(var(--font-size)-2px)] text-text-muted hover:text-accent-red transition-colors"
                onClick={() => onDelete?.(comment.id)}
              >
                Delete
              </button>
            </div>
          )}
        </div>

        {/* Body */}
        {isEditing ? (
          <div className="space-y-2">
            <textarea
              className="w-full min-h-[100px] p-3 bg-bg-primary border border-border rounded-md text-[var(--font-size)] text-text-primary placeholder-text-muted outline-none focus:border-accent-blue resize-y"
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              placeholder="Write a comment..."
            />
            <div className="flex items-center gap-2">
              <button
                className="px-3 py-1.5 text-[calc(var(--font-size)-2px)] bg-accent-blue text-white rounded hover:opacity-90 transition-opacity"
                onClick={handleSaveEdit}
              >
                Save
              </button>
              <button
                className="px-3 py-1.5 text-[calc(var(--font-size)-2px)] bg-bg-tertiary text-text-primary rounded hover:bg-bg-hover transition-colors"
                onClick={handleCancelEdit}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="text-[var(--font-size)] text-text-primary whitespace-pre-wrap">
            {comment.body}
          </div>
        )}

        {/* Reactions */}
        {comment.reactions && comment.reactions.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {comment.reactions.map((reaction) => (
              <button
                key={reaction.emoji}
                className={cn(
                  'flex items-center gap-1 px-2 py-0.5 rounded-full text-[calc(var(--font-size)-2px)] border transition-colors',
                  reaction.userReacted
                    ? 'bg-accent-blue/10 border-accent-blue text-accent-blue'
                    : 'bg-bg-tertiary border-border text-text-secondary hover:border-accent-blue',
                )}
                onClick={() => handleReaction(reaction.emoji)}
              >
                <span>{reaction.emoji}</span>
                <span>{reaction.count}</span>
              </button>
            ))}
            <div className="relative">
              <button
                className="flex items-center justify-center w-6 h-6 rounded-full bg-bg-tertiary border border-border text-text-muted hover:border-accent-blue hover:text-text-primary transition-colors"
                onClick={() => setShowReactionPicker(!showReactionPicker)}
              >
                <span className="text-xs">+</span>
              </button>
              {showReactionPicker && (
                <div className="absolute bottom-full left-0 mb-1 p-1.5 bg-bg-secondary border border-border rounded-lg shadow-lg z-50 flex gap-1">
                  {REACTION_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      className="w-7 h-7 flex items-center justify-center rounded hover:bg-bg-hover transition-colors"
                      onClick={() => handleReaction(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(PRCommentItem);
