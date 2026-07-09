import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useEditorAgentActions } from '@/features/editor/hooks/useEditorAgentActions';
import { cn } from '@/lib/utils';
import { ChevronRightIcon, Sparkles, TerminalIcon, CloseIcon } from '@/shared/components/icons';
import { useEditorStore } from '@/shared/store';
import { buildDiffMessage } from '@/shared/utils/agentPrompt';
import { fileIconSrc } from '@/shared/utils/fileIcons';

import DiffTable from './DiffTable';
import { detectLanguage, ensureLanguageRegistered } from './highlight';
import SplitDiffTable from './SplitDiffTable';
import type { DiffViewProps, ViewMode } from './types';
import { useDiffData } from './useDiffData';

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function getProjectIdFromTab(): string | null {
  const tabs = useEditorStore.getState().tabs;
  for (const key of Object.keys(tabs)) {
    return key;
  }
  return null;
}

const DiffView: React.FC<DiffViewProps> = React.memo(
  ({ projectId, diffSource, filePath, initialMode }) => {
    const [viewMode, setViewMode] = useState<ViewMode>(initialMode ?? 'unified');
    const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
    const { sendToAgent, pending, clearPending } = useEditorAgentActions();

    const {
      diffResult,
      loading,
      error,
      loadDiff,
      currentBlockIndex,
      setCurrentBlockIndex,
      changeStats,
      totalChangeBlocks,
    } = useDiffData({ projectId, diffSource, filePath });

    const language = useMemo(() => detectLanguage(filePath), [filePath]);

    useEffect(() => {
      void ensureLanguageRegistered(language);
    }, [language]);

    const currentProjectId = projectId || getProjectIdFromTab() || '';

    const navigateBlock = (direction: 'prev' | 'next') => {
      if (totalChangeBlocks === 0) {
        return;
      }
      let newIndex = currentBlockIndex;
      if (direction === 'prev' && currentBlockIndex > 0) {
        newIndex = currentBlockIndex - 1;
      } else if (direction === 'next' && currentBlockIndex < totalChangeBlocks - 1) {
        newIndex = currentBlockIndex + 1;
      }
      setCurrentBlockIndex(newIndex);
      requestAnimationFrame(() => {
        const el = document.getElementById(`cb-${newIndex}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    };

    const toggleLine = useCallback(
      (hunkIdx: number, lineIdx: number) => {
        setSelectedLines((prev) => {
          const next = new Set(prev);
          if (lineIdx === -1) {
            // Toggle entire hunk
            const allLines = diffResult?.hunks[hunkIdx]?.lines;
            if (!allLines) return prev;
            const allIn = allLines.every((_, i) => next.has(`${hunkIdx}:${i}`));
            if (allIn) {
              allLines.forEach((_, i) => next.delete(`${hunkIdx}:${i}`));
            } else {
              allLines.forEach((_, i) => next.add(`${hunkIdx}:${i}`));
            }
          } else {
            const key = `${hunkIdx}:${lineIdx}`;
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

    const handleReviewFull = useCallback(() => {
      const message = buildDiffMessage('review', { filePath, isFullDiff: true });
      sendToAgent(currentProjectId, message);
    }, [filePath, currentProjectId, sendToAgent]);

    const handleReviewSelection = useCallback(() => {
      const message = buildDiffMessage('review', { filePath, lineCount: selectedCount });
      sendToAgent(currentProjectId, message);
      clearSelection();
    }, [filePath, selectedCount, currentProjectId, sendToAgent, clearSelection]);

    if (loading) {
      return (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-center h-full text-text-muted text-[var(--font-size)]">
            Loading diff...
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-center h-full text-text-muted text-[var(--font-size)] flex-col gap-3">
            <p>Error: {error}</p>
            <button
              className="py-2 px-4 bg-accent-blue border-none rounded text-white cursor-pointer"
              onClick={() => {
                void loadDiff();
              }}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between py-2 px-4 bg-bg-secondary border-b border-border">
          <div className="flex items-center gap-2">
            <img
              src={fileIconSrc(getFileName(filePath))}
              alt=""
              width={16}
              height={16}
              className="shrink-0"
            />
            <span className="font-semibold text-[var(--font-size)]">{getFileName(filePath)}</span>
            <span className="text-text-muted text-[var(--font-size)]">{filePath}</span>
            {diffResult && (changeStats.additions > 0 || changeStats.deletions > 0) && (
              <span className="bg-bg-tertiary py-0.5 px-2 rounded-full text-[var(--font-size)] text-text-secondary flex gap-1">
                <span className="text-[#3fb950] font-semibold">+{changeStats.additions}</span>{' '}
                <span className="text-[#f85149] font-semibold">-{changeStats.deletions}</span>
              </span>
            )}
            {pending ? (
              <span className="text-xs text-text-muted ml-2">No agent terminal open</span>
            ) : (
              <button
                className="ml-2 p-1 rounded bg-accent-blue text-white hover:opacity-90 transition"
                onClick={handleReviewFull}
                title="Review this change"
              >
                <Sparkles size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex border border-border rounded overflow-hidden">
              <button
                className={cn(
                  'bg-transparent border-none text-text-secondary px-2.5 py-1 cursor-pointer text-[var(--font-size)] transition-all duration-150 hover:bg-bg-hover hover:text-text-primary border-r border-border [&:last-child]:border-r-0',
                  viewMode === 'unified' && '!bg-accent-blue !text-white',
                )}
                onClick={() => setViewMode('unified')}
                title="Unified view"
              >
                Unified
              </button>
              <button
                className={cn(
                  'bg-transparent border-none text-text-secondary px-2.5 py-1 cursor-pointer text-[var(--font-size)] transition-all duration-150 hover:bg-bg-hover hover:text-text-primary [&:last-child]:border-r-0',
                  viewMode === 'split' && '!bg-accent-blue !text-white',
                )}
                onClick={() => setViewMode('split')}
                title="Split view"
              >
                Split
              </button>
            </div>

            <button
              className="bg-bg-tertiary border border-border text-text-primary px-2.5 py-1 rounded cursor-pointer text-[var(--font-size)] transition-all duration-200 hover:bg-bg-hover hover:border-accent-blue disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => navigateBlock('prev')}
              disabled={totalChangeBlocks === 0 || currentBlockIndex === 0}
              title="Previous Change"
            >
              <ChevronRightIcon size={14} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <span className="text-[var(--font-size)] text-text-secondary min-w-[60px] text-center">
              {totalChangeBlocks > 0 ? `${currentBlockIndex + 1} / ${totalChangeBlocks}` : '0 / 0'}
            </span>
            <button
              className="bg-bg-tertiary border border-border text-text-primary px-2.5 py-1 rounded cursor-pointer text-[var(--font-size)] transition-all duration-200 hover:bg-bg-hover hover:border-accent-blue disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => navigateBlock('next')}
              disabled={totalChangeBlocks === 0 || currentBlockIndex >= totalChangeBlocks - 1}
              title="Next Change"
            >
              <ChevronRightIcon size={14} />
            </button>
          </div>
        </div>

        {selectedCount > 0 && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-bg-secondary border-b border-border">
            <span className="text-xs text-text-muted">
              {selectedCount} line{selectedCount > 1 ? 's' : ''} selected
            </span>
            {pending ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">No agent terminal open</span>
                <button
                  className="p-1 rounded bg-accent-blue text-white text-xs font-medium hover:opacity-90 transition"
                  onClick={() => {
                    import('@/features/terminal/hooks/useTerminalTabs').then(
                      ({ useTerminalTabs }) => {
                        import('@/features/project/store').then(({ useProjectStore }) => {
                          const { addTab } = useTerminalTabs();
                          const agentId =
                            useProjectStore.getState().activeProject?.selected_agent ?? 'opencode';
                          addTab(currentProjectId, agentId, agentId);
                          if (pending) {
                            setTimeout(() => {
                              const msg = buildDiffMessage('review', {
                                filePath,
                                lineCount: selectedCount,
                              });
                              import('@/features/terminal/components/terminalCommands').then(
                                ({ sendToTerminal }) => {
                                  sendToTerminal(currentProjectId, `${msg}\r`);
                                  clearPending();
                                  clearSelection();
                                },
                              );
                            }, 1500);
                          }
                        });
                      },
                    );
                  }}
                  title="Open Terminal"
                >
                  <TerminalIcon size={14} />
                </button>
              </div>
            ) : (
              <button
                className="p-1 rounded bg-accent-blue text-white hover:opacity-90 transition"
                onClick={handleReviewSelection}
                title={`Ask AI about ${selectedCount} line${selectedCount > 1 ? 's' : ''}`}
              >
                <Sparkles size={14} />
              </button>
            )}
            <button
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition"
              onClick={clearSelection}
              title="Clear selection"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-auto pl-3 pr-2">
          {diffResult && diffResult.hunks.length > 0 ? (
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
            )
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted text-[var(--font-size)]">
              No changes to display
            </div>
          )}
        </div>
      </div>
    );
  },
);

export default DiffView;
