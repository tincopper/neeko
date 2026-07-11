import React from 'react';

import type { PRComment } from '../../types/comment';

import PRCommentItem from './PRCommentItem';

interface PRCommentListProps {
  comments: PRComment[];
  currentUserId?: string;
  onEdit?: (commentId: string, newBody: string) => void;
  onDelete?: (commentId: string) => void;
  onReact?: (commentId: string, emoji: string) => void;
  loading?: boolean;
}

const PRCommentList: React.FC<PRCommentListProps> = ({
  comments,
  currentUserId,
  onEdit,
  onDelete,
  onReact,
  loading = false,
}) => {
  if (loading) {
    return (
      <div className="py-8 text-center text-[var(--font-size)] text-text-muted">
        Loading comments...
      </div>
    );
  }

  if (comments.length === 0) {
    return (
      <div className="py-8 text-center text-[var(--font-size)] text-text-muted">
        No comments yet
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {comments.map((comment) => (
        <PRCommentItem
          key={comment.id}
          comment={comment}
          isOwnComment={currentUserId === comment.author}
          onEdit={onEdit}
          onDelete={onDelete}
          onReact={onReact}
        />
      ))}
    </div>
  );
};

export default React.memo(PRCommentList);
