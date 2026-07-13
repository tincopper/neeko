import React, { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

import { SplitPane } from '@/shared/components';
import { FileDiff, GitCommitHorizontal, MessageSquare } from '@/shared/components/icons';
import { useAppContext } from '@/shared/contexts/AppContext';

import { ScrollArea } from '@/ui/ScrollArea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs';

import {
  listPrComments,
  addPrComment,
  editPrComment,
  deletePrComment,
  addCommentReaction,
} from '../../api/gitApi';
import type { PRComment } from '../../types/comment';

import FileStatsBar from './FileStatsBar';
import PRCommentInput from './PRCommentInput';
import PRCommentList from './PRCommentList';
import PRCommitList from './PRCommitList';
import PRDescription from './PRDescription';
import PRDetailSkeleton from './PRDetailSkeleton';
import PRFileTree from './PRFileTree';
import PRFilesChangedPanel from './PRFilesChangedPanel';
import PRTimeline from './PRTimeline';
import { usePRResource } from './usePRResource';

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

function getStateBadgeClass(state: string): string {
  switch (state.toUpperCase()) {
    case 'OPEN':
      return 'bg-accent-green/15 text-accent-green';
    case 'CLOSED':
      return 'bg-accent-red/15 text-accent-red';
    case 'MERGED':
      return 'bg-[#a371f7]/20 text-[#a371f7]';
    default:
      return 'bg-bg-tertiary text-text-muted';
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
  prHeadRef,
  prBaseRef,
}) => {
  const { config } = useAppContext();
  const [ready, setReady] = useState(false);
  const resource = usePRResource(projectId, prNumber, ready);
  const [comments, setComments] = useState<PRComment[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  useEffect(() => {
    if (resource) setComments(resource.comments);
  }, [resource]);

  const handleFileClick = useCallback((filePath: string) => {
    setSelectedFile(filePath);
  }, []);

  const handleCommitClick = useCallback((hash: string) => {
    console.log('Open commit:', hash);
  }, []);

  const handleAddComment = useCallback(
    async (body: string) => {
      try {
        const c = await addPrComment(projectId, prNumber, body);
        setComments((prev) => [...prev, c]);
      } catch (err) {
        console.error('[PRDetail] add comment:', err);
      }
    },
    [projectId, prNumber],
  );

  const handleEditComment = useCallback(
    async (id: string, body: string) => {
      try {
        const c = await editPrComment(projectId, prNumber, id, body);
        setComments((prev) => prev.map((x) => (x.id === id ? c : x)));
      } catch (err) {
        console.error('[PRDetail] edit comment:', err);
      }
    },
    [projectId, prNumber],
  );

  const handleDeleteComment = useCallback(
    async (id: string) => {
      try {
        await deletePrComment(projectId, prNumber, id);
        setComments((prev) => prev.filter((x) => x.id !== id));
      } catch (err) {
        console.error('[PRDetail] delete comment:', err);
      }
    },
    [projectId, prNumber],
  );

  const handleReaction = useCallback(
    async (id: string, emoji: string) => {
      try {
        await addCommentReaction(projectId, prNumber, id, emoji);
        const updated = await listPrComments(projectId, prNumber);
        setComments(updated);
      } catch (err) {
        console.error('[PRDetail] reaction:', err);
      }
    },
    [projectId, prNumber],
  );

  if (!resource) {
    return (
      <PRDetailSkeleton
        prTitle={prTitle}
        prState={prState}
        prAuthor={prAuthor}
        prCreatedAt={prCreatedAt}
        prNumber={prNumber}
        onReady={() => setReady(true)}
      />
    );
  }

  const { info, files, commits } = resource;
  const author = info.author || prAuthor;
  const createdAt = info.createdAt || prCreatedAt || '';
  const totalCommits = commits.length;
  const totalFiles = files.length;
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-bg-secondary">
        <div className="title-row">
          <h1 className="inline text-[var(--font-size)] font-semibold text-text-primary leading-relaxed break-words">
            {prTitle}
          </h1>
          <span className="text-text-muted text-[calc(var(--font-size)-1px)] ml-1">
            #{prNumber}
          </span>
          <span className={cn('inline-block align-middle ml-1.5 px-1.5 py-[1px] rounded text-[8px] font-semibold uppercase tracking-wide', getStateBadgeClass(prState))}>
            {prState.toUpperCase()}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1.5 text-[calc(var(--font-size)-1px)] text-text-muted">
          <span className="inline-flex w-[18px] h-[18px] rounded-full overflow-hidden bg-bg-tertiary items-center justify-center text-[9px] font-semibold text-text-muted shrink-0">
            <img
              src={`https://avatars.githubusercontent.com/${author}?s=18`}
              alt={author}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                (e.target as HTMLImageElement).parentElement!.innerText = (
                  author?.charAt(0) || '#'
                ).toUpperCase();
              }}
            />
          </span>
          <strong className="font-medium text-text-secondary">{author}</strong>

          <span className="text-border">|</span>

          <span className="inline-flex items-center px-[5px] h-[18px] rounded text-[10px] font-mono bg-accent-blue/15 text-accent-blue">
            {prHeadRef}
          </span>
          <span className="text-text-muted text-[11px]">→</span>
          <span className="inline-flex items-center px-[5px] h-[18px] rounded text-[10px] font-mono bg-accent-blue/15 text-accent-blue">
            {prBaseRef}
          </span>

          <span className="text-border">·</span>
          <span>opened {formatTimestamp(createdAt)}</span>

          {info.mergedBy && info.mergedAt && (
            <>
              <span className="text-border">·</span>
              <span>merged by <strong className="font-medium text-text-secondary">{info.mergedBy.login}</strong> {formatTimestamp(info.mergedAt)}</span>
            </>
          )}

          {info.closedBy && info.closedAt && !info.mergedBy && (
            <>
              <span className="text-border">·</span>
              <span>closed by <strong className="font-medium text-text-secondary">{info.closedBy.login}</strong> {formatTimestamp(info.closedAt)}</span>
            </>
          )}

          <span className="text-border">·</span>

          <span className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded text-[10px] font-medium bg-[#a371f7]/15 text-[#a371f7]">
            <GitCommitHorizontal size={11} />
            {totalCommits} {totalCommits === 1 ? 'commit' : 'commits'}
          </span>
          <span className="inline-flex items-center gap-0.5 px-1.5 py-[1px] rounded text-[10px] font-medium bg-accent-blue/15 text-accent-blue">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
            {totalFiles} {totalFiles === 1 ? 'file' : 'files'}
          </span>
          {totalAdditions > 0 && (
            <span className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-medium bg-accent-green/10 text-accent-green">
              +{totalAdditions.toLocaleString()}
            </span>
          )}
          {totalDeletions > 0 && (
            <span className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-medium bg-accent-red/10 text-accent-red">
              -{totalDeletions.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      <Tabs defaultValue="conversation" className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 pt-0 border-b border-border bg-bg-secondary">
          <TabsList className="bg-transparent h-auto gap-0">
            <TabsTrigger
              value="conversation"
              className="data-[state=active]:border-b-2 data-[state=active]:border-accent-blue data-[state=active]:text-text-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent rounded-none bg-transparent border-b-2 border-transparent text-text-muted hover:text-text-primary hover:border-b-accent-blue/30 px-0 pb-2 pt-2 mr-5 text-[var(--font-size)] transition-colors"
            >
              <MessageSquare size={14} className="shrink-0 -ml-0.5" />
              Conversation
            </TabsTrigger>
            <TabsTrigger
              value="commits"
              className="data-[state=active]:border-b-2 data-[state=active]:border-accent-blue data-[state=active]:text-text-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent rounded-none bg-transparent border-b-2 border-transparent text-text-muted hover:text-text-primary hover:border-b-accent-blue/30 px-0 pb-2 pt-2 mr-5 text-[var(--font-size)] transition-colors"
            >
              <GitCommitHorizontal size={14} className="shrink-0 -ml-0.5" />
              Commits
            </TabsTrigger>
            <TabsTrigger
              value="files-changed"
              className="data-[state=active]:border-b-2 data-[state=active]:border-accent-blue data-[state=active]:text-text-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent rounded-none bg-transparent border-b-2 border-transparent text-text-muted hover:text-text-primary hover:border-b-accent-blue/30 px-0 pb-2 pt-2 text-[var(--font-size)] transition-colors"
            >
              <FileDiff size={14} className="shrink-0 -ml-0.5" />
              Files Changed
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="conversation"
          className="flex-1 flex flex-col overflow-hidden mt-0 data-[state=active]:flex-1"
        >
          <FileStatsBar files={files} />
          <ScrollArea className="flex-1">
            {info.body ? (
              <PRDescription body={info.body} theme={config.theme} />
            ) : (
              <div className="flex items-center justify-center p-8 text-[var(--font-size)] text-text-muted">
                No description provided
              </div>
            )}
            <div className="px-4 py-2 border-t border-border">
              <h4 className="text-[var(--font-size)] font-semibold text-text-primary mb-2">
                Commits ({commits.length})
              </h4>
              {commits.length === 0 ? (
                <div className="flex items-center justify-center p-4 text-[var(--font-size)] text-text-muted">
                  No commits
                </div>
              ) : (
                <PRCommitList commits={commits} onCommitClick={handleCommitClick} />
              )}
            </div>
            <div className="px-4 py-2 border-t border-border">
              <h4 className="text-[var(--font-size)] font-semibold text-text-primary mb-2">
                Timeline
              </h4>
              <PRTimeline
                events={(() => {
                  const isMerged = !!info.mergeCommit?.oid;
                  const state = (info.state || prState).toUpperCase();
                  const events: Array<{
                    id: string;
                    type: 'opened' | 'merge' | 'closed';
                    author: string;
                    timestamp: string;
                    message: string;
                    branchName?: string;
                    commitHash?: string;
                  }> = [];
                  events.push({
                    id: 'opened',
                    type: 'opened' as const,
                    author,
                    timestamp: createdAt,
                    message: 'opened this pull request',
                  });
                  if (isMerged) {
                    events.push({
                      id: 'merged',
                      type: 'merge' as const,
                      author: info.mergedBy?.login || author,
                      timestamp: info.mergedAt || createdAt,
                      message: 'merged commit',
                      branchName: info.baseRefName || prBaseRef,
                      commitHash: info.mergeCommit!.oid,
                    });
                  } else if (state === 'CLOSED') {
                    events.push({
                      id: 'closed',
                      type: 'closed' as const,
                      author: info.closedBy?.login || author,
                      timestamp: info.closedAt || createdAt,
                      message: 'closed this pull request',
                    });
                  }
                  return events;
                })()}
              />
            </div>
            <div className="px-4 py-2 border-t border-border">
              <h4 className="text-[var(--font-size)] font-semibold text-text-primary mb-2">
                Comments ({comments.length})
              </h4>
              <PRCommentList
                comments={comments}
                onEdit={handleEditComment}
                onDelete={handleDeleteComment}
                onReact={handleReaction}
              />
            </div>
            <div className="px-4 py-2 border-t border-border">
              <PRCommentInput onSubmit={handleAddComment} placeholder="Write a comment..." />
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent
          value="commits"
          className="flex-1 flex flex-col overflow-hidden mt-0 data-[state=active]:flex-1"
        >
          <ScrollArea className="flex-1">
            <div className="px-4 py-2">
              {commits.length === 0 ? (
                <div className="flex items-center justify-center p-4 text-[var(--font-size)] text-text-muted">
                  No commits
                </div>
              ) : (
                <PRCommitList commits={commits} onCommitClick={handleCommitClick} />
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent
          value="files-changed"
          className="flex-1 flex flex-col overflow-hidden mt-0 data-[state=active]:flex-1"
        >
          <SplitPane
            left={
              files.length === 0 ? (
                <div className="flex items-center justify-center p-4 text-[var(--font-size)] text-text-muted">
                  No files changed
                </div>
              ) : (
                <PRFileTree
                  files={files}
                  onFileClick={handleFileClick}
                  selectedPath={selectedFile}
                />
              )
            }
            right={
              <PRFilesChangedPanel
                projectId={projectId}
                prNumber={prNumber}
                files={files}
                scrollToFile={selectedFile}
              />
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default React.memo(PRDetailView);
