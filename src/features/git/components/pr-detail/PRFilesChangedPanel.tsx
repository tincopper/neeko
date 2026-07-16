import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { ChevronRightIcon } from '@/shared/components/icons';
import { fileIconSrc } from '@/shared/utils/fileIcons';

import { readFileContent, listPrReviewComments, addPrReviewComment } from '../../api/gitApi';
import type { PRReviewComment } from '../../types/comment';
import type { PRFileChange } from '../../types';
import DiffTable from '../diff/DiffTable';
import SplitDiffTable from '../diff/SplitDiffTable';
import type { ViewMode } from '../diff/types';
import { useDiffData } from '../diff/useDiffData';
import { detectLanguage } from '../diff/highlight';

interface PRFilesChangedPanelProps {
  projectId: string;
  prNumber: number;
  files: PRFileChange[];
  scrollToFile?: string | null;
}

const FILE_STATUS_BORDER: Record<string, string> = {
  added: 'border-l-accent-green',
  removed: 'border-l-accent-red',
  modified: 'border-l-accent-blue',
  renamed: 'border-l-accent-yellow',
};

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}



// 模块级缓存：避免多个 DiffBody 对同一 PR 重复请求 review comments
const reviewCommentsCache = new Map<string, Promise<PRReviewComment[]>>();
const reviewCommentsResult = new Map<string, PRReviewComment[]>();

function fetchReviewComments(projectId: string, prNumber: number): Promise<PRReviewComment[]> {
  const key = `${projectId}:${prNumber}`;
  const cached = reviewCommentsResult.get(key);
  if (cached) return Promise.resolve(cached);
  const inflight = reviewCommentsCache.get(key);
  if (inflight) return inflight;
  const promise = listPrReviewComments(projectId, prNumber).then((all) => {
    reviewCommentsResult.set(key, all);
    reviewCommentsCache.delete(key);
    return all;
  });
  reviewCommentsCache.set(key, promise);
  return promise;
}

const PRFilesChangedPanel: React.FC<PRFilesChangedPanelProps> = ({
  projectId,
  prNumber,
  files,
  scrollToFile,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('unified');
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [viewedPaths, setViewedPaths] = useState<Set<string>>(new Set());
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // ── 分页加载状态 ──────────────────────────────────────────────────────
  const PAGE_SIZE = 5;
  const [loadedCount, setLoadedCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 当 sentinel 进入视口时加载更多文件
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || loadedCount >= files.length) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setLoadedCount((prev) => Math.min(prev + PAGE_SIZE, files.length));
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [files.length, loadedCount]);

  // 当从左侧文件树选择文件时，确保该文件已加载并滚动到位置
  useEffect(() => {
    if (!scrollToFile) return;
    const idx = files.findIndex((f) => f.path === scrollToFile);
    if (idx >= 0 && idx >= loadedCount) {
      setLoadedCount(Math.min(idx + PAGE_SIZE, files.length));
    }
    const el = fileRefs.current.get(scrollToFile);
    if (el) {
      el.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }, [scrollToFile, files, loadedCount]);

  const visibleFiles = useMemo(() => files.slice(0, loadedCount), [files, loadedCount]);

  const allPaths = useMemo(() => files.map((f) => f.path), [files]);
  const totalAdditions = useMemo(() => files.reduce((s, f) => s + (f.additions || 0), 0), [files]);
  const totalDeletions = useMemo(() => files.reduce((s, f) => s + (f.deletions || 0), 0), [files]);

  const setFileRef = useCallback((path: string, el: HTMLDivElement | null) => {
    if (el) {
      fileRefs.current.set(path, el);
    } else {
      fileRefs.current.delete(path);
    }
  }, []);

  const toggleCollapse = useCallback((path: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const toggleViewed = useCallback((path: string) => {
    setViewedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsedPaths(new Set(allPaths));
  }, [allPaths]);

  const expandAll = useCallback(() => {
    setCollapsedPaths(new Set());
  }, []);

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--font-size)] text-text-muted">
        No files changed
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-1.5 bg-bg-secondary border-b border-border shrink-0 gap-2">
        <div className="flex items-center gap-1.5 text-[calc(var(--font-size)-1px)] text-text-muted whitespace-nowrap min-w-0">
          <span className="font-medium text-text-primary">{files.length}</span>
          <span>file{files.length !== 1 ? 's' : ''} changed</span>
          {totalAdditions > 0 && (
            <span className="text-accent-green font-medium">+{totalAdditions}</span>
          )}
          {totalDeletions > 0 && (
            <span className="text-accent-red font-medium">-{totalDeletions}</span>
          )}
          <span className="mx-1 text-text-muted/50">|</span>
          <span className="text-text-muted">
            Viewed <span className="font-medium text-text-primary">{viewedPaths.size}</span>/
            {files.length}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            className="bg-transparent border-none text-[calc(var(--font-size)-2px)] text-text-muted hover:text-text-primary cursor-pointer px-1.5 py-0.5 rounded hover:bg-bg-hover transition-colors"
            onClick={collapseAll}
            title="Collapse all file diffs"
          >
            Collapse all
          </button>
          <button
            className="bg-transparent border-none text-[calc(var(--font-size)-2px)] text-text-muted hover:text-text-primary cursor-pointer px-1.5 py-0.5 rounded hover:bg-bg-hover transition-colors"
            onClick={expandAll}
            title="Expand all file diffs"
          >
            Expand all
          </button>
          <div className="flex border border-border rounded overflow-hidden">
            <button
              className={cn(
                'bg-transparent border-none text-text-secondary px-2.5 py-0.5 cursor-pointer text-[calc(var(--font-size)-1px)] transition-all duration-150 hover:bg-bg-hover hover:text-text-primary border-r border-border last:border-r-0',
                viewMode === 'unified' && '!bg-accent-blue !text-white',
              )}
              onClick={() => setViewMode('unified')}
            >
              Unified
            </button>
            <button
              className={cn(
                'bg-transparent border-none text-text-secondary px-2.5 py-0.5 cursor-pointer text-[calc(var(--font-size)-1px)] transition-all duration-150 hover:bg-bg-hover hover:text-text-primary',
                viewMode === 'split' && '!bg-accent-blue !text-white',
              )}
              onClick={() => setViewMode('split')}
            >
              Split
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" ref={scrollContainerRef}>
        {visibleFiles.map((file) => {
          const isCollapsed = collapsedPaths.has(file.path);
          const isViewed = viewedPaths.has(file.path);
          const forceVisible = scrollToFile === file.path;
          return (
            <FileDiffSection
              key={file.path}
              projectId={projectId}
              prNumber={prNumber}
              file={file}
              viewMode={viewMode}
              isCollapsed={isCollapsed}
              isViewed={isViewed}
              forceVisible={forceVisible}
              onToggle={() => toggleCollapse(file.path)}
              onToggleViewed={() => toggleViewed(file.path)}
              refCallback={(el) => setFileRef(file.path, el)}
            />
          );
        })}
        {loadedCount < files.length && (
          <div
            ref={sentinelRef}
            className="flex items-center justify-center py-4 text-[calc(var(--font-size)-1px)] text-text-muted"
          >
            Scroll for more files ({loadedCount}/{files.length} loaded)...
          </div>
        )}
      </div>
    </div>
  );
};

interface FileDiffSectionProps {
  projectId: string;
  prNumber: number;
  file: PRFileChange;
  viewMode: ViewMode;
  isCollapsed: boolean;
  isViewed: boolean;
  forceVisible?: boolean;
  onToggle: () => void;
  onToggleViewed: () => void;
  refCallback: (el: HTMLDivElement | null) => void;
}

const FileDiffSection: React.FC<FileDiffSectionProps> = React.memo(
  ({ projectId, prNumber, file, viewMode, isCollapsed, isViewed, forceVisible, onToggle, onToggleViewed, refCallback }) => {
    const borderColor = FILE_STATUS_BORDER[file.status] || 'border-l-border';
    const [isVisible, setIsVisible] = useState(!!forceVisible);
    const sectionRef = useRef<HTMLDivElement | null>(null);

    const setRefs = useCallback((el: HTMLDivElement | null) => {
      sectionRef.current = el;
      refCallback(el);
    }, [refCallback]);

    useEffect(() => {
      if (forceVisible) return; // 被选中文件无需 observer
      const el = sectionRef.current;
      if (!el) return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
          }
        },
        { rootMargin: '200px' },
      );
      observer.observe(el);
      return () => observer.disconnect();
    }, [forceVisible]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      },
      [onToggle],
    );

    const handleCheckboxChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        e.stopPropagation();
        onToggleViewed();
      },
      [onToggleViewed],
    );

    return (
      <div ref={setRefs} className="border-b border-border">
        <div
          role="button"
          tabIndex={0}
          className={cn(
            'sticky top-0 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary cursor-pointer border-l-[3px] transition-colors duration-100 hover:bg-bg-hover',
            borderColor,
          )}
          onClick={onToggle}
          onKeyDown={handleKeyDown}
          title={file.path}
        >
          <input
            type="checkbox"
            checked={isViewed}
            onChange={handleCheckboxChange}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 w-3.5 h-3.5 rounded border-border accent-accent-blue cursor-pointer"
            title={isViewed ? 'Mark as not viewed' : 'Mark as viewed'}
          />
          <ChevronRightIcon
            size={14}
            className={cn(
              'shrink-0 text-text-muted transition-transform duration-150',
              !isCollapsed && 'rotate-90',
            )}
          />
          <img
            src={fileIconSrc(getFileName(file.path))}
            alt=""
            width={14}
            height={14}
            className="shrink-0"
          />
          <span className="font-medium text-[var(--font-size)] text-text-primary truncate">
            {getFileName(file.path)}
          </span>
          <span className="text-text-muted text-[calc(var(--font-size)-2px)] truncate hidden sm:inline">
            {file.path}
          </span>
          <span className="ml-auto shrink-0 text-[calc(var(--font-size)-2px)] whitespace-nowrap">
            {(file.additions ?? 0) > 0 && (
              <span className="text-accent-green font-medium">+{file.additions}</span>
            )}{' '}
            {(file.deletions ?? 0) > 0 && (
              <span className="text-accent-red font-medium">-{file.deletions}</span>
            )}
          </span>
        </div>

        {!isCollapsed && isVisible && (
          <DiffBody
            projectId={projectId}
            prNumber={prNumber}
            filePath={file.path}
            fileStatus={file.status}
            viewMode={viewMode}
          />
        )}
        {!isCollapsed && !isVisible && <div className="h-2" />}
      </div>
    );
  },
);

FileDiffSection.displayName = 'FileDiffSection';

interface DiffBodyProps {
  projectId: string;
  prNumber: number;
  filePath: string;
  fileStatus: string;
  viewMode: ViewMode;
}

const DiffBody: React.FC<DiffBodyProps> = ({ projectId, prNumber, filePath, fileStatus, viewMode }) => {
  const { diffResult, loading, error } = useDiffData({ projectId, filePath });
  const language = detectLanguage(filePath);
  const [commentLine, setCommentLine] = useState<number | null>(null);
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState<PRReviewComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const commentsLoaded = useRef(false);

  useEffect(() => {
    commentsLoaded.current = false;
    setCommentLine(null);
    setCommentText('');
    setComments([]);
  }, [filePath]);

  useEffect(() => {
    if (!prNumber || commentsLoaded.current) return;
    setCommentsLoading(true);
    fetchReviewComments(projectId, prNumber)
      .then((all) => {
        setComments(all.filter((c) => c.path === filePath));
        commentsLoaded.current = true;
      })
      .catch(() => {})
      .finally(() => setCommentsLoading(false));
  }, [projectId, prNumber, filePath]);

  const commentCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const c of comments) {
      map.set(c.line, (map.get(c.line) || 0) + 1);
    }
    return map;
  }, [comments]);

  const handleSubmitComment = useCallback(async () => {
    if (!commentText.trim() || commentLine === null) return;
    setSubmitting(true);
    try {
      const created = await addPrReviewComment(
        projectId, prNumber, commentText.trim(), filePath, commentLine, 'RIGHT',
      );
      setComments((prev) => [...prev, created]);
      setCommentLine(null);
      setCommentText('');
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  }, [commentText, commentLine, projectId, prNumber, filePath]);

  const renderCommentArea = useCallback((lineNum: number): React.ReactNode => {
    const lineComments = comments.filter((c) => c.line === lineNum);
    const isActive = commentLine === lineNum;

    if (lineComments.length === 0 && !isActive) return null;

    return (
      <div className="flex flex-col gap-2">
        {lineComments.map((c) => (
          <div key={c.id} className="flex gap-2 text-[calc(var(--font-size)-1px)]">
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-text-primary">{c.author}</span>
                <span className="text-text-muted text-[11px]">
                  {new Date(c.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="text-text-secondary whitespace-pre-wrap">{c.body}</div>
            </div>
          </div>
        ))}
        {isActive && (
          <div className="flex flex-col gap-1.5">
            <textarea
              className="w-full min-h-[60px] bg-bg-primary border border-border rounded p-2 text-[var(--font-size)] text-text-primary resize-none outline-none focus:border-accent-blue"
              placeholder="Leave a comment on this line..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                className="bg-transparent border border-border text-text-secondary px-2.5 py-1 rounded text-[calc(var(--font-size)-1px)] cursor-pointer hover:bg-bg-hover"
                onClick={() => { setCommentLine(null); setCommentText(''); }}
              >
                Cancel
              </button>
              <button
                className="bg-accent-blue border-none text-white px-2.5 py-1 rounded text-[calc(var(--font-size)-1px)] cursor-pointer disabled:opacity-50"
                onClick={handleSubmitComment}
                disabled={submitting || !commentText.trim()}
              >
                {submitting ? 'Submitting...' : 'Comment'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }, [comments, commentLine, commentText, submitting, handleSubmitComment]);

  const sharedProps = {
    onCommentLine: setCommentLine,
    renderCommentArea,
    commentCounts,
  };

  if (loading || commentsLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-[var(--font-size)] text-text-muted">
        Loading diff...
      </div>
    );
  }

  const hasNoDiff = !diffResult || diffResult.hunks.length === 0;

  if (error || hasNoDiff) {
    if (fileStatus === 'added') {
      return <AddedFileContent projectId={projectId} filePath={filePath} />;
    }
    return (
      <div className="flex items-center justify-center py-8 text-[var(--font-size)] text-text-muted">
        {error ? 'Failed to load diff' : 'No changes to display'}
      </div>
    );
  }

  if (viewMode === 'unified') {
    return (
      <DiffTable
        diffResult={diffResult}
        language={language}
        selectedLines={new Set()}
        onToggleLine={() => {}}
        {...sharedProps}
      />
    );
  }

  return (
    <SplitDiffTable
      diffResult={diffResult}
      language={language}
      selectedLines={new Set()}
      onToggleLine={() => {}}
      {...sharedProps}
    />
  );
};

interface AddedFileContentProps {
  projectId: string;
  filePath: string;
}

const AddedFileContent: React.FC<AddedFileContentProps> = ({ projectId, filePath }) => {
  const [content, setContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(true);
  const [contentError, setContentError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    readFileContent(projectId, filePath)
      .then((result) => {
        if (!cancelled) {
          setContent(result.content);
          setLoadingContent(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setContentError(String(err));
          setLoadingContent(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, filePath]);

  if (loadingContent) {
    return (
      <div className="flex items-center justify-center py-8 text-[var(--font-size)] text-text-muted">
        Loading file content...
      </div>
    );
  }

  if (contentError || !content) {
    return (
      <div className="flex items-center justify-center py-8 text-[var(--font-size)] text-text-muted">
        {contentError
          ? 'File is not available locally. Check out the PR branch to view content.'
          : 'No content available'}
      </div>
    );
  }

  const lines = content.split('\n');

  return (
    <table className="w-full border-collapse font-mono" style={{ fontSize: 'var(--font-size)' }}>
      <tbody>
        {lines.map((line, i) => (
          <tr key={i} className="bg-diff-added">
            <td className="w-[50px] text-right text-text-muted select-none px-1">{i + 1}</td>
            <td className="w-5 text-center select-none text-accent-green">+</td>
            <td className="whitespace-pre-wrap break-all text-text-primary px-2">{line || ' '}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default React.memo(PRFilesChangedPanel);
