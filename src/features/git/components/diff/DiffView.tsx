import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useEditorAgentActions } from '@/features/editor/hooks/useEditorAgentActions';
import { useNotificationStore } from '@/features/notification/notificationStore';
import { cn } from '@/lib/utils';
import { ChevronRight, Sparkles, CloseIcon } from '@/shared/components/icons';
import { useEditorStore } from '@/shared/store';
import { buildDiffMessage } from '@/shared/utils/agentPrompt';
import { fileIconSrc } from '@/shared/utils/fileIcons';

import DiffTable from './DiffTable';
import DiffToolbar from './DiffToolbar';
import {
  fileBlockId,
  indexOfPath,
  initialExpandedPaths,
  splitFilePath,
  statusBadgeClass,
  statusLetter,
  sumFileStats,
} from './diffViewUtils';
import { detectLanguage, ensureLanguageRegistered } from './highlight';
import SplitDiffTable from './SplitDiffTable';
import type { DiffViewProps, ViewMode } from './types';
import { useDiffData } from './useDiffData';

function getProjectIdFromTab(): string | null {
  const tabs = useEditorStore.getState().tabs;
  for (const key of Object.keys(tabs)) {
    return key;
  }
  return null;
}

/** Shared chrome for single + combined file blocks (rounded card + optional header). */
interface DiffFileCardProps {
  filePath: string;
  status?: string;
  additions?: number;
  deletions?: number;
  expanded: boolean;
  active?: boolean;
  /**
   * Combined mode shows the file header (name/dir/stats/toggle).
   * Single mode hides it — toolbar already carries that identity (avoids double chrome).
   */
  showHeader?: boolean;
  /** When set, header is a toggle control. */
  onToggle?: () => void;
  children?: React.ReactNode;
  className?: string;
  id?: string;
}

const DiffFileCard: React.FC<DiffFileCardProps> = React.memo(
  ({
    filePath,
    status,
    additions = 0,
    deletions = 0,
    expanded,
    active = false,
    showHeader = true,
    onToggle,
    children,
    className,
    id,
  }) => {
    const { name, dir } = useMemo(() => splitFilePath(filePath), [filePath]);
    const letter = status ? statusLetter(status) : '';
    const interactive = typeof onToggle === 'function';

    const headerClass = cn(
      'sticky top-0 z-10 w-full grid grid-cols-[14px_16px_minmax(0,auto)_minmax(0,1fr)_auto_auto] items-center gap-1.5 px-3 py-1.5 text-left transition-colors',
      'bg-bg-secondary',
      interactive && 'hover:bg-bg-hover/50 cursor-pointer',
      expanded && 'border-b border-border/35',
      active && 'bg-bg-selected/40',
    );

    const headerInner = (
      <>
        <ChevronRight
          size={12}
          className={cn(
            'text-text-secondary shrink-0 transition-transform duration-150',
            expanded && 'rotate-90 text-text-primary',
            !interactive && 'opacity-50',
          )}
        />
        <img
          src={fileIconSrc(name)}
          alt=""
          width={14}
          height={14}
          className="shrink-0 opacity-90"
        />
        <span className="truncate max-w-[12rem] text-[var(--font-size)] font-semibold text-text-primary">
          {name}
        </span>
        <span className="min-w-0 truncate font-mono text-[calc(var(--font-size)-2px)] text-text-secondary">
          {dir}
        </span>
        {letter ? (
          <span
            className={cn(
              'shrink-0 text-[calc(var(--font-size)-3px)] font-semibold px-1.5 py-px rounded-full leading-none',
              statusBadgeClass(letter),
            )}
          >
            {letter}
          </span>
        ) : (
          <span className="shrink-0 w-0 overflow-hidden" />
        )}
        <span className="shrink-0 flex items-center gap-1 text-[calc(var(--font-size)-2px)] tabular-nums font-medium">
          <span className="text-accent-green">+{additions}</span>
          <span className="text-accent-red">−{deletions}</span>
        </span>
      </>
    );

    return (
      <section
        id={id}
        className={cn(
          // Same surface as tab chrome; soft rounded card for single + combined.
          'mx-2 my-1.5 overflow-hidden rounded-lg border bg-bg-secondary',
          active ? 'border-border' : 'border-border/40',
          className,
        )}
      >
        {showHeader ? (
          interactive ? (
            <button
              type="button"
              className={headerClass}
              onClick={onToggle}
              aria-expanded={expanded}
              title={filePath}
            >
              {headerInner}
            </button>
          ) : (
            <div className={headerClass} title={filePath}>
              {headerInner}
            </div>
          )
        ) : null}

        {expanded ? <div className="bg-bg-secondary px-2 py-1.5">{children}</div> : null}
      </section>
    );
  },
);
DiffFileCard.displayName = 'DiffFileCard';

interface FileDiffSectionProps {
  projectId: string;
  diffSource: NonNullable<DiffViewProps['diffSource']>;
  filePath: string;
  status: string;
  additions: number;
  deletions: number;
  viewMode: ViewMode;
  expanded: boolean;
  active: boolean;
  onToggle: () => void;
  selectedLines: Set<string>;
  onToggleLine: (hunkIdx: number, lineIdx: number) => void;
}

const FileDiffSection: React.FC<FileDiffSectionProps> = React.memo(
  ({
    projectId,
    diffSource,
    filePath,
    status,
    additions,
    deletions,
    viewMode,
    expanded,
    active,
    onToggle,
    selectedLines,
    onToggleLine,
  }) => {
    // Gate data loading until expanded (D2 performance).
    const { diffResult, loading, error, loadDiff } = useDiffData({
      projectId,
      diffSource,
      filePath: expanded ? filePath : '',
    });

    const language = useMemo(() => detectLanguage(filePath), [filePath]);
    const blockId = fileBlockId(filePath);

    useEffect(() => {
      if (!expanded) return;
      void ensureLanguageRegistered(language);
    }, [expanded, language]);

    return (
      <DiffFileCard
        id={blockId}
        filePath={filePath}
        status={status}
        additions={additions}
        deletions={deletions}
        expanded={expanded}
        active={active}
        onToggle={onToggle}
      >
        {loading ? (
          <div className="text-text-muted text-[var(--font-size)] py-4 text-center">Loading…</div>
        ) : error ? (
          <div className="text-accent-red text-[var(--font-size)] py-4 text-center">
            {error}
            <button
              type="button"
              className="ml-2 text-accent-blue underline bg-transparent border-none cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                void loadDiff();
              }}
            >
              Retry
            </button>
          </div>
        ) : diffResult && diffResult.hunks.length > 0 ? (
          viewMode === 'unified' ? (
            <DiffTable
              diffResult={diffResult}
              language={language}
              selectedLines={selectedLines}
              onToggleLine={onToggleLine}
              blockIdPrefix={`cb-${blockId}`}
            />
          ) : (
            <SplitDiffTable
              diffResult={diffResult}
              language={language}
              selectedLines={selectedLines}
              onToggleLine={onToggleLine}
              blockIdPrefix={`cb-${blockId}`}
            />
          )
        ) : (
          <div className="text-text-muted text-[var(--font-size)] py-4 text-center">No changes</div>
        )}
      </DiffFileCard>
    );
  },
);
FileDiffSection.displayName = 'FileDiffSection';

const DiffView: React.FC<DiffViewProps> = React.memo(
  ({
    projectId,
    diffSource,
    filePath,
    initialMode,
    combined,
    files,
    scrollToPath,
    onScrollToPathChange,
  }) => {
    const [viewMode, setViewMode] = useState<ViewMode>(initialMode ?? 'unified');
    const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
    const { sendToAgent, clearPending } = useEditorAgentActions();
    const scrollRef = useRef<HTMLDivElement>(null);

    // Combined-mode structure state
    const fileList = useMemo(() => files ?? [], [files]);
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() =>
      combined ? initialExpandedPaths(fileList, scrollToPath ?? filePath) : new Set(),
    );
    const [currentFileIdx, setCurrentFileIdx] = useState(() => {
      if (!combined || fileList.length === 0) return 0;
      const idx = indexOfPath(fileList, scrollToPath ?? filePath);
      return idx >= 0 ? idx : 0;
    });
    // Combined-mode change (hunk block) cursor across expanded files.
    const [combinedChangeIndex, setCombinedChangeIndex] = useState(0);

    // Reset expand policy when the commit file set identity changes.
    const filesKey = useMemo(
      () => (combined ? fileList.map((f) => f.path).join('\0') : ''),
      [combined, fileList],
    );
    useEffect(() => {
      if (!combined) return;
      setExpandedPaths(initialExpandedPaths(fileList, scrollToPath ?? filePath));
      const idx = indexOfPath(fileList, scrollToPath ?? filePath);
      setCurrentFileIdx(idx >= 0 ? idx : 0);
      setSelectedLines(new Set());
      setCombinedChangeIndex(0);
      // Only when the file set changes — not on every scrollToPath (handled below).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filesKey, combined]);

    const {
      diffResult,
      loading,
      error,
      loadDiff,
      currentBlockIndex,
      setCurrentBlockIndex,
      changeStats,
      totalChangeBlocks,
    } = useDiffData({
      projectId,
      diffSource,
      // Skip single-file fetch noise in combined mode (each section loads itself).
      filePath: combined ? '' : filePath,
    });

    const language = useMemo(() => detectLanguage(filePath), [filePath]);
    const singleParts = useMemo(() => splitFilePath(filePath), [filePath]);

    useEffect(() => {
      if (combined) return;
      void ensureLanguageRegistered(language);
    }, [combined, language]);

    const scrollFileIntoView = useCallback((path: string) => {
      const root = scrollRef.current;
      if (!root) return;
      const el = root.querySelector(`#${CSS.escape(fileBlockId(path))}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, []);

    // Git Log scrollToPath → expand + index + scroll (D3)
    useEffect(() => {
      if (!combined || !scrollToPath || fileList.length === 0) return;
      const idx = indexOfPath(fileList, scrollToPath);
      if (idx < 0) return;
      setCurrentFileIdx(idx);
      setExpandedPaths((prev) => {
        if (prev.has(scrollToPath)) return prev;
        const next = new Set(prev);
        next.add(scrollToPath);
        return next;
      });
      requestAnimationFrame(() => scrollFileIntoView(scrollToPath));
    }, [combined, scrollToPath, fileList, scrollFileIntoView]);

    const currentProjectId = projectId || getProjectIdFromTab() || '';

    const combinedStats = useMemo(
      () => (combined ? sumFileStats(fileList) : { additions: 0, deletions: 0 }),
      [combined, fileList],
    );

    const allCollapsed = combined && expandedPaths.size === 0;

    const toggleFile = useCallback(
      (path: string) => {
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          if (next.has(path)) next.delete(path);
          else next.add(path);
          return next;
        });
        const idx = indexOfPath(fileList, path);
        if (idx >= 0) setCurrentFileIdx(idx);
      },
      [fileList],
    );

    const toggleFoldAll = useCallback(() => {
      setExpandedPaths((prev) => {
        if (prev.size === 0) {
          return new Set(fileList.map((f) => f.path));
        }
        return new Set();
      });
    }, [fileList]);

    const navigateFile = useCallback(
      (direction: 'prev' | 'next') => {
        if (fileList.length === 0) return;
        let nextIdx = currentFileIdx;
        if (direction === 'prev' && currentFileIdx > 0) nextIdx = currentFileIdx - 1;
        else if (direction === 'next' && currentFileIdx < fileList.length - 1) {
          nextIdx = currentFileIdx + 1;
        } else {
          return;
        }
        const path = fileList[nextIdx].path;
        setCurrentFileIdx(nextIdx);
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          next.add(path);
          return next;
        });
        onScrollToPathChange?.(path);
        requestAnimationFrame(() => scrollFileIntoView(path));
      },
      [fileList, currentFileIdx, onScrollToPathChange, scrollFileIntoView],
    );

    const collectChangeBlockIds = useCallback((root: ParentNode | null): string[] => {
      if (!root) return [];
      const nodes = root.querySelectorAll<HTMLElement>('[id^="cb-"]');
      // Prefer only change-block markers (id ends with -<number>), keep DOM order.
      return Array.from(nodes)
        .map((el) => el.id)
        .filter((id) => /-\d+$/.test(id));
    }, []);

    const navigateBlock = useCallback(
      (direction: 'prev' | 'next') => {
        // Single-file: use known total from useDiffData + simple cb-N ids.
        if (!combined) {
          if (totalChangeBlocks === 0) return;
          let newIndex = currentBlockIndex;
          if (direction === 'prev' && currentBlockIndex > 0) {
            newIndex = currentBlockIndex - 1;
          } else if (direction === 'next' && currentBlockIndex < totalChangeBlocks - 1) {
            newIndex = currentBlockIndex + 1;
          } else {
            return;
          }
          setCurrentBlockIndex(newIndex);
          requestAnimationFrame(() => {
            const el = document.getElementById(`cb-${newIndex}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
          return;
        }

        // Combined: scan currently mounted change blocks in visual order.
        const root = scrollRef.current;
        const ids = collectChangeBlockIds(root);
        if (ids.length === 0) {
          // No expanded blocks yet — expand current/first file and retry once data mounts.
          const target = fileList[currentFileIdx]?.path ?? fileList[0]?.path;
          if (!target) return;
          setExpandedPaths((prev) => {
            if (prev.has(target)) return prev;
            const next = new Set(prev);
            next.add(target);
            return next;
          });
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const nextIds = collectChangeBlockIds(scrollRef.current);
              if (nextIds.length === 0) return;
              const targetIdx = direction === 'prev' ? nextIds.length - 1 : 0;
              setCombinedChangeIndex(targetIdx);
              document
                .getElementById(nextIds[targetIdx])
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
          });
          return;
        }

        let newIndex = combinedChangeIndex;
        // Clamp if DOM shrank (collapse/expand).
        if (newIndex >= ids.length) newIndex = ids.length - 1;
        if (direction === 'prev' && newIndex > 0) newIndex -= 1;
        else if (direction === 'next' && newIndex < ids.length - 1) newIndex += 1;
        else if (direction === 'prev' && newIndex <= 0) {
          const prevCollapsed = [...fileList]
            .map((f, i) => ({ f, i }))
            .reverse()
            .find(({ f, i }) => i < currentFileIdx && !expandedPaths.has(f.path));
          if (prevCollapsed) {
            const path = prevCollapsed.f.path;
            setCurrentFileIdx(prevCollapsed.i);
            setExpandedPaths((prev) => {
              const next = new Set(prev);
              next.add(path);
              return next;
            });
            onScrollToPathChange?.(path);
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const nextIds = collectChangeBlockIds(scrollRef.current);
                const prefix = `cb-${fileBlockId(path)}-`;
                let idx = -1;
                for (let i = nextIds.length - 1; i >= 0; i -= 1) {
                  if (nextIds[i].startsWith(prefix)) {
                    idx = i;
                    break;
                  }
                }
                const targetIdx = idx >= 0 ? idx : 0;
                if (nextIds[targetIdx]) {
                  setCombinedChangeIndex(targetIdx);
                  document
                    .getElementById(nextIds[targetIdx])
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              });
            });
          }
          return;
        } else if (direction === 'next' && newIndex >= ids.length - 1) {
          // At end of currently mounted blocks: try expanding next collapsed file.
          const nextCollapsed = fileList.findIndex(
            (f, i) => i > currentFileIdx && !expandedPaths.has(f.path),
          );
          if (nextCollapsed >= 0) {
            const path = fileList[nextCollapsed].path;
            setCurrentFileIdx(nextCollapsed);
            setExpandedPaths((prev) => {
              const next = new Set(prev);
              next.add(path);
              return next;
            });
            onScrollToPathChange?.(path);
            // After expand, jump to first block of that file on next tick.
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const nextIds = collectChangeBlockIds(scrollRef.current);
                // Prefer first block belonging to the newly expanded file.
                const prefix = `cb-${fileBlockId(path)}-`;
                const idx = nextIds.findIndex((id) => id.startsWith(prefix));
                const targetIdx = idx >= 0 ? idx : Math.min(newIndex + 1, nextIds.length - 1);
                if (targetIdx >= 0 && nextIds[targetIdx]) {
                  setCombinedChangeIndex(targetIdx);
                  document
                    .getElementById(nextIds[targetIdx])
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
              });
            });
          }
          return;
        } else {
          return;
        }

        setCombinedChangeIndex(newIndex);
        const id = ids[newIndex];
        requestAnimationFrame(() => {
          const el = document.getElementById(id);
          if (!el) return;
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Keep file index in sync with the block's file section.
          const section = el.closest('section[id^="fileblock-"]');
          if (section?.id) {
            const pathGuess = fileList.find((f) => fileBlockId(f.path) === section.id);
            if (pathGuess) {
              const fi = indexOfPath(fileList, pathGuess.path);
              if (fi >= 0) setCurrentFileIdx(fi);
            }
          }
        });
      },
      [
        combined,
        totalChangeBlocks,
        currentBlockIndex,
        setCurrentBlockIndex,
        collectChangeBlockIds,
        fileList,
        currentFileIdx,
        expandedPaths,
        combinedChangeIndex,
        onScrollToPathChange,
      ],
    );

    const changeNavIndex = combined ? combinedChangeIndex : currentBlockIndex;
    // For combined mode the toolbar count is live from currently mounted change blocks.
    // When nothing is expanded yet, show 0/0 until the user expands or navigates.
    const [combinedMountedTotal, setCombinedMountedTotal] = useState(0);
    useEffect(() => {
      if (!combined) {
        setCombinedMountedTotal(0);
        return;
      }
      const sync = () => {
        const n = collectChangeBlockIds(scrollRef.current).length;
        setCombinedMountedTotal(n);
        setCombinedChangeIndex((idx) => (n === 0 ? 0 : Math.min(idx, n - 1)));
      };
      sync();
      const root = scrollRef.current;
      if (!root) return;
      const mo = new MutationObserver(() => sync());
      mo.observe(root, { childList: true, subtree: true });
      return () => mo.disconnect();
    }, [combined, expandedPaths, viewMode, collectChangeBlockIds, filesKey]);

    const changeNavTotal = combined
      ? combinedMountedTotal
      : !loading && !error
        ? totalChangeBlocks
        : 0;

    /** Single-file keys: `hunk:line`. Combined keys: `path\0hunk:line`. */
    const toggleLine = useCallback(
      (hunkIdx: number, lineIdx: number, path?: string) => {
        const prefix = path ? `${path}\0` : '';
        setSelectedLines((prev) => {
          const next = new Set(prev);
          if (lineIdx === -1) {
            // Hunk toggle only available in single-file mode where diffResult is known.
            const allLines = !path ? diffResult?.hunks[hunkIdx]?.lines : undefined;
            if (!allLines) return prev;
            const allIn = allLines.every((_, i) => next.has(`${prefix}${hunkIdx}:${i}`));
            if (allIn) {
              allLines.forEach((_, i) => next.delete(`${prefix}${hunkIdx}:${i}`));
            } else {
              allLines.forEach((_, i) => next.add(`${prefix}${hunkIdx}:${i}`));
            }
          } else {
            const key = `${prefix}${hunkIdx}:${lineIdx}`;
            if (next.has(key)) next.delete(key);
            else next.add(key);
          }
          return next;
        });
      },
      [diffResult],
    );

    const clearSelection = useCallback(() => {
      setSelectedLines(new Set());
    }, []);

    const selectedCount = selectedLines.size;

    const selectedFilePaths = useMemo(() => {
      if (!combined) return filePath ? [filePath] : [];
      const paths = new Set<string>();
      for (const key of selectedLines) {
        const sep = key.indexOf('\0');
        if (sep > 0) paths.add(key.slice(0, sep));
      }
      return Array.from(paths);
    }, [combined, selectedLines, filePath]);

    const selectedLinesForPath = useCallback(
      (path: string) => {
        const prefix = `${path}\0`;
        const out = new Set<string>();
        for (const key of selectedLines) {
          if (key.startsWith(prefix)) out.add(key.slice(prefix.length));
        }
        return out;
      },
      [selectedLines],
    );

    const notifyNoAgentTerminal = useCallback(() => {
      useNotificationStore.getState().addNotification({
        type: 'warning',
        title: 'No agent terminal open',
        message: 'Open an agent terminal, then try Review again.',
      });
    }, []);

    const sendReview = useCallback(
      (message: string, clearOnSuccess: boolean) => {
        const sent = sendToAgent(currentProjectId, message);
        if (sent) {
          if (clearOnSuccess) clearSelection();
          return;
        }
        notifyNoAgentTerminal();
        clearPending();
      },
      [currentProjectId, sendToAgent, clearSelection, notifyNoAgentTerminal, clearPending],
    );

    const handleReviewFull = useCallback(() => {
      const message = combined
        ? buildDiffMessage('review', {
            filePath: 'combined',
            isFullDiff: true,
            combined: true,
            fileCount: fileList.length,
          })
        : buildDiffMessage('review', { filePath, isFullDiff: true });
      sendReview(message, false);
    }, [combined, fileList.length, filePath, sendReview]);

    const handleReviewSelection = useCallback(() => {
      if (selectedCount === 0) return;
      const message = combined
        ? buildDiffMessage('review', {
            filePath: 'combined',
            lineCount: selectedCount,
            combined: true,
            fileCount: selectedFilePaths.length,
            filePaths: selectedFilePaths,
          })
        : buildDiffMessage('review', { filePath, lineCount: selectedCount });
      sendReview(message, true);
    }, [combined, selectedCount, selectedFilePaths, filePath, sendReview]);

    // ── Combined multi-file view ──────────────────────────────────────────
    if (combined && files && diffSource) {
      const pid = projectId || '';
      const activePath = fileList[currentFileIdx]?.path;
      return (
        <div
          className="flex-1 flex flex-col overflow-hidden min-w-0 bg-bg-secondary"
          ref={scrollRef}
        >
          <DiffToolbar
            title={activePath || `${fileList.length} files`}
            titleTooltip={activePath || `${fileList.length} files`}
            additions={combinedStats.additions}
            deletions={combinedStats.deletions}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            changeIndex={changeNavIndex}
            changeTotal={changeNavTotal}
            onChangePrev={() => navigateBlock('prev')}
            onChangeNext={() => navigateBlock('next')}
            showFileNav
            fileIndex={currentFileIdx}
            fileTotal={fileList.length}
            onFilePrev={() => navigateFile('prev')}
            onFileNext={() => navigateFile('next')}
            showFoldToggle
            allCollapsed={allCollapsed}
            onToggleFoldAll={toggleFoldAll}
            onReview={fileList.length > 0 ? handleReviewFull : undefined}
          />

          {selectedCount > 0 ? (
            <div
              className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-accent-blue/35 bg-accent-blue/12"
              role="status"
              aria-live="polite"
            >
              <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full bg-accent-blue text-[calc(var(--font-size)-2px)] font-bold text-white tabular-nums">
                {selectedCount}
              </span>
              <span className="text-[var(--font-size)] text-text-primary font-medium">
                line{selectedCount > 1 ? 's' : ''} selected
                {selectedFilePaths.length > 1
                  ? ` across ${selectedFilePaths.length} files`
                  : selectedFilePaths.length === 1
                    ? ` in ${selectedFilePaths[0].split('/').pop()}`
                    : ''}{' '}
                for review
              </span>
              <div className="flex-1" />
              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent-blue text-white text-[calc(var(--font-size)-1px)] font-medium hover:opacity-90 transition shadow-sm"
                onClick={handleReviewSelection}
                title={`Review ${selectedCount} selected line${selectedCount > 1 ? 's' : ''} with AI`}
              >
                <Sparkles size={14} />
                Review with AI
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[calc(var(--font-size)-1px)] text-text-secondary hover:text-text-primary hover:bg-bg-hover/80 transition border border-border/50"
                onClick={clearSelection}
                title="Clear selection"
              >
                <CloseIcon size={14} />
                Clear
              </button>
            </div>
          ) : null}

          <div className="flex-1 overflow-auto min-w-0 bg-bg-secondary py-0.5">
            {fileList.map((f, idx) => (
              <FileDiffSection
                key={f.path}
                projectId={pid}
                diffSource={diffSource}
                filePath={f.path}
                status={f.status}
                additions={f.additions}
                deletions={f.deletions}
                viewMode={viewMode}
                expanded={expandedPaths.has(f.path)}
                active={idx === currentFileIdx}
                onToggle={() => toggleFile(f.path)}
                selectedLines={selectedLinesForPath(f.path)}
                onToggleLine={(hunkIdx, lineIdx) => toggleLine(hunkIdx, lineIdx, f.path)}
              />
            ))}
          </div>
        </div>
      );
    }

    // ── Single-file: same card chrome as combined ─────────────────────────
    const singleToolbar = (
      <DiffToolbar
        title={singleParts.name}
        subtitle={singleParts.dir || undefined}
        titleTooltip={filePath}
        iconSrc={fileIconSrc(singleParts.name)}
        additions={loading || error ? 0 : changeStats.additions}
        deletions={loading || error ? 0 : changeStats.deletions}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        changeIndex={!loading && !error && totalChangeBlocks > 0 ? currentBlockIndex : 0}
        changeTotal={!loading && !error ? totalChangeBlocks : 0}
        onChangePrev={() => navigateBlock('prev')}
        onChangeNext={() => navigateBlock('next')}
        onReview={loading || error ? undefined : handleReviewFull}
      />
    );

    let singleBody: React.ReactNode;
    if (loading) {
      singleBody = (
        <div className="space-y-2 py-2" aria-busy="true" aria-label="Loading diff">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-3 rounded bg-bg-tertiary/70 animate-pulse"
              style={{ width: `${70 + (i % 3) * 10}%` }}
            />
          ))}
        </div>
      );
    } else if (error) {
      singleBody = (
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-[var(--font-size)]">
          <p className="text-accent-red">Error: {error}</p>
          <button
            type="button"
            className="py-1.5 px-3 rounded bg-accent-blue/15 text-accent-blue border border-accent-blue/30 cursor-pointer hover:bg-accent-blue/25"
            onClick={() => {
              void loadDiff();
            }}
          >
            Retry
          </button>
        </div>
      );
    } else if (diffResult && diffResult.hunks.length > 0) {
      singleBody =
        viewMode === 'unified' ? (
          <DiffTable
            diffResult={diffResult}
            language={language}
            selectedLines={selectedLines}
            onToggleLine={toggleLine}
          />
        ) : (
          <SplitDiffTable
            diffResult={diffResult}
            language={language}
            selectedLines={selectedLines}
            onToggleLine={toggleLine}
          />
        );
    } else {
      singleBody = (
        <div className="text-text-muted text-[var(--font-size)] py-8 text-center">
          No changes to display
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-bg-secondary">
        {singleToolbar}

        {selectedCount > 0 && !loading && !error ? (
          <div
            className="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-accent-blue/35 bg-accent-blue/12"
            role="status"
            aria-live="polite"
          >
            <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full bg-accent-blue text-[calc(var(--font-size)-2px)] font-bold text-white tabular-nums">
              {selectedCount}
            </span>
            <span className="text-[var(--font-size)] text-text-primary font-medium">
              line{selectedCount > 1 ? 's' : ''} selected for review
            </span>
            <div className="flex-1" />
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent-blue text-white text-[calc(var(--font-size)-1px)] font-medium hover:opacity-90 transition shadow-sm"
              onClick={handleReviewSelection}
              title={`Review ${selectedCount} selected line${selectedCount > 1 ? 's' : ''} with AI`}
            >
              <Sparkles size={14} />
              Review with AI
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[calc(var(--font-size)-1px)] text-text-secondary hover:text-text-primary hover:bg-bg-hover/80 transition border border-border/50"
              onClick={clearSelection}
              title="Clear selection"
            >
              <CloseIcon size={14} />
              Clear
            </button>
          </div>
        ) : null}

        <div className="flex-1 overflow-auto min-w-0 bg-bg-secondary py-0.5">
          {/*
            Single mode: keep the rounded content card for visual parity with
            combined, but hide the file header — toolbar already shows name/dir/stats.
          */}
          <DiffFileCard filePath={filePath} expanded active showHeader={false}>
            {singleBody}
          </DiffFileCard>
        </div>
      </div>
    );
  },
);
DiffView.displayName = 'DiffView';

export default DiffView;
