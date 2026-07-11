import React, { useState, useEffect, useCallback } from 'react';

import { useAppContext } from '@/shared/contexts/AppContext';
import { Badge } from '@/ui/badge';
import { ScrollArea } from '@/ui/ScrollArea';
import { getAvatarStyle } from '@/shared/utils/projectAvatar';

import {
  listPrComments,
  addPrComment,
  editPrComment,
  deletePrComment,
  addCommentReaction,
} from '../../api/gitApi';
import type { PRComment } from '../../types/comment';

import { usePRResource } from './usePRResource';
import PRCommentInput from './PRCommentInput';
import PRCommentList from './PRCommentList';
import PRCommitList from './PRCommitList';
import PRDescription from './PRDescription';
import PRFileTree from './PRFileTree';
import PRDetailSkeleton from './PRDetailSkeleton';
import PRTimeline from './PRTimeline';

interface PRDetailViewProps {
  projectId: string;
  prNumber: number;
  prTitle: string;
  prState: string;
  prBody: string | null;
  prAuthor: string;
  prCreatedAt: string;
  prUrl: string;
  prHeadRef: string;
  prBaseRef: string;
  onClose?: () => void;
  onOpenDiff?: (filePath: string) => void;
}

function getStateBadgeVariant(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (state.toUpperCase()) {
    case 'OPEN': return 'default';
    case 'CLOSED': return 'destructive';
    case 'MERGED': return 'secondary';
    default: return 'outline';
  }
}

function formatTimestamp(timestamp: string | undefined | null): string {
  if (!timestamp) return 'Unknown';
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return timestamp || 'Unknown';
  }
}

const PRDetailView: React.FC<PRDetailViewProps> = ({
  projectId,
  prNumber,
  prTitle,
  prState,
  prAuthor,
  prCreatedAt,
  prBaseRef,
  onOpenDiff,
}) => {
  const { config } = useAppContext();
  const [ready, setReady] = useState(false);
  const resource = usePRResource(projectId, prNumber, ready);
  const [comments, setComments] = useState<PRComment[]>([]);

  useEffect(() => {
    if (resource) setComments(resource.comments);
  }, [resource]);

  const handleFileClick = useCallback((filePath: string) => onOpenDiff?.(filePath), [onOpenDiff]);

  const handleCommitClick = useCallback((hash: string) => {
    console.log('Open commit:', hash);
  }, []);

  const handleAddComment = useCallback(async (body: string) => {
    try {
      const c = await addPrComment(projectId, prNumber, body);
      setComments((prev) => [...prev, c]);
    } catch (err) {
      console.error('[PRDetail] add comment:', err);
    }
  }, [projectId, prNumber]);

  const handleEditComment = useCallback(async (id: string, body: string) => {
    try {
      const c = await editPrComment(projectId, prNumber, id, body);
      setComments((prev) => prev.map((x) => (x.id === id ? c : x)));
    } catch (err) {
      console.error('[PRDetail] edit comment:', err);
    }
  }, [projectId, prNumber]);

  const handleDeleteComment = useCallback(async (id: string) => {
    try {
      await deletePrComment(projectId, prNumber, id);
      setComments((prev) => prev.filter((x) => x.id !== id));
    } catch (err) {
      console.error('[PRDetail] delete comment:', err);
    }
  }, [projectId, prNumber]);

  const handleReaction = useCallback(async (id: string, emoji: string) => {
    try {
      await addCommentReaction(projectId, prNumber, id, emoji);
      const updated = await listPrComments(projectId, prNumber);
      setComments(updated);
    } catch (err) {
      console.error('[PRDetail] reaction:', err);
    }
  }, [projectId, prNumber]);

  if (!resource) {
    return (
      <PRDetailSkeleton
        prTitle={prTitle}
        prState={prState}
        prAuthor={prAuthor}
        prCreatedAt={prCreatedAt}
        prBaseRef={prBaseRef}
        prNumber={prNumber}
        onReady={() => setReady(true)}
      />
    );
  }

  const { info, files, commits } = resource;
  const author = info.author || prAuthor;
  const createdAt = info.createdAt || prCreatedAt || '';

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="w-[35%] min-w-[250px] border-r border-border flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border bg-bg-secondary">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[var(--font-size)] font-semibold text-text-primary truncate flex-1 mr-2">{prTitle}</h3>
            <Badge variant={getStateBadgeVariant(prState)}>{prState.toUpperCase()}</Badge>
          </div>
          <div className="flex items-center gap-2 text-[calc(var(--font-size)-2px)] text-text-muted mb-2">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0"
              style={getAvatarStyle({ name: author })}
            >
              {(author?.charAt(0) || '#').toUpperCase()}
            </div>
            <span>{author}</span><span>·</span><span>{formatTimestamp(createdAt)}</span>
          </div>
          <div className="flex items-center gap-2 text-[calc(var(--font-size)-2px)] text-text-muted">
            <span>Changes from</span>
            <span className="font-semibold text-text-primary">{files.length} files</span>
            <span>into</span>
            <span className="font-mono text-accent-blue">{prBaseRef}</span>
          </div>
        </div>
        <ScrollArea className="flex-1">
          {files.length === 0 ? (
            <div className="flex items-center justify-center p-4 text-[var(--font-size)] text-text-muted">No files changed</div>
          ) : (
            <PRFileTree files={files} onFileClick={handleFileClick} />
          )}
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-border bg-bg-secondary">
          <h2 className="text-lg font-semibold text-text-primary mb-2">{prTitle} #{prNumber}</h2>
          <div className="flex items-center gap-2 text-[var(--font-size)] text-text-muted">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0"
              style={getAvatarStyle({ name: author })}
            >
              {(author?.charAt(0) || '#').toUpperCase()}
            </div>
            <span>{author}</span><span>·</span><span>{formatTimestamp(createdAt)}</span>
          </div>
        </div>
        <ScrollArea className="flex-1">
          {info.body ? (
            <PRDescription body={info.body} theme={config.theme} />
          ) : (
            <div className="flex items-center justify-center p-8 text-[var(--font-size)] text-text-muted">No description provided</div>
          )}
          <div className="px-4 py-2 border-t border-border">
            <h4 className="text-[var(--font-size)] font-semibold text-text-primary mb-2">Commits ({commits.length})</h4>
            {commits.length === 0 ? (
              <div className="flex items-center justify-center p-4 text-[var(--font-size)] text-text-muted">No commits</div>
            ) : (
              <PRCommitList commits={commits} onCommitClick={handleCommitClick} />
            )}
          </div>
          <div className="px-4 py-2 border-t border-border">
            <h4 className="text-[var(--font-size)] font-semibold text-text-primary mb-2">Timeline</h4>
            <PRTimeline
              events={[
                { id: 'merge', type: 'merge', author, timestamp: createdAt, message: 'merged commit', branchName: prBaseRef, commitHash: info.mergeCommit?.oid },
                { id: 'review', type: 'review', author: 'System', timestamp: createdAt, message: 'Pull Request Successfully Merged' },
              ]}
            />
          </div>
          <div className="px-4 py-2 border-t border-border">
            <h4 className="text-[var(--font-size)] font-semibold text-text-primary mb-2">Comments ({comments.length})</h4>
            <PRCommentList comments={comments} onEdit={handleEditComment} onDelete={handleDeleteComment} onReact={handleReaction} />
          </div>
          <div className="px-4 py-2 border-t border-border">
            <PRCommentInput onSubmit={handleAddComment} placeholder="Write a comment..." />
          </div>
        </ScrollArea>
      </div>
    </div>
  );
};

export default React.memo(PRDetailView);
