import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useEditorAgentActions } from '@/shared/hooks/useEditorAgentActions';
import { useEditorStore } from '@/shared/store/editorStore';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { buildDiffMessage } from '@/shared/utils/agentPrompt';
import { fileIconSrc } from '@/shared/utils/fileIcons';

import CombinedDiffView from './CombinedDiffView';
import DiffTable from './DiffTable';
import { capDiffText, hunksToDiffText, hunksToSelectedDiffText } from './diffText';
import DiffToolbar from './DiffToolbar';
import {
  fileBlockId,
  indexOfPath,
  initialExpandedPaths,
  mergeSelection,
  splitFilePath,
  sumFileStats,
} from './diffViewUtils';
import type { SelectionMode } from './diffViewUtils';
import { DiffFileCard } from './FileDiffSection';
import { detectLanguage, ensureLanguageRegistered } from './highlight';
import ReviewInstructionPopover from './ReviewInstructionPopover';
import SelectionActionBar from './SelectionActionBar';
import SplitDiffTable from './SplitDiffTable';
import type { DiffHunk, DiffViewProps, ViewMode } from './types';
import { useDiffData } from './useDiffData';

function getProjectIdFromTab(): string | null {
  const tabs = useEditorStore.getState().tabs;
  for (const key of Object.keys(tabs)) {
    return key;
  }
  return null;
}

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
    // 全文模式：collapse=false 拉取未折叠的完整 diff
    const [fullMode, setFullMode] = useState(false);
    // 单段展开：已展开的 Collapsed 占位行（key 与 selectedLines 一致，含 combined 前缀）
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
    const { sendToAgent, clearPending } = useEditorAgentActions();
    const scrollRef = useRef<HTMLDivElement>(null);
    // AI review 自定义指令弹层（全文 review，右上角浮层）。
    const [reviewPopover, setReviewPopover] = useState(false);
    // combined 数据提升：FileDiffSection 经 onDiffResult 上报渲染 hunks，review 拼 diff 文本用。
    const hunksByPathRef = useRef<Record<string, DiffHunk[]>>({});
    const reportDiffResult = useCallback((path: string, hunks: DiffHunk[] | null) => {
      const ref = hunksByPathRef.current;
      if (hunks && hunks.length > 0) ref[path] = hunks;
      else delete ref[path];
    }, []);

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
      // 文件集变更时清空数据提升缓存，防止旧提交的 hunks 残留进 review 消息
      hunksByPathRef.current = {};
      setExpandedPaths(initialExpandedPaths(fileList, scrollToPath ?? filePath));
      const idx = indexOfPath(fileList, scrollToPath ?? filePath);
      setCurrentFileIdx(idx >= 0 ? idx : 0);
      setSelectedLines(new Set());
      setExpandedSections(new Set());
      setFullMode(false);
      setCombinedChangeIndex(0);
      // Only when the file set changes — not on every scrollToPath (handled below).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filesKey, combined]);

    // 单文件模式：切换文件时重置选区与展开状态
    useEffect(() => {
      if (combined) return;
      setSelectedLines(new Set());
      setExpandedSections(new Set());
      setFullMode(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filePath, diffSource, combined]);

    const {
      diffResult,
      fullHunks,
      loadFullHunks,
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
      collapse: !fullMode,
    });

    const language = useMemo(() => detectLanguage(filePath), [filePath]);
    const singleParts = useMemo(() => splitFilePath(filePath), [filePath]);
    const [singleLanguageReady, setSingleLanguageReady] = useState(false);

    useEffect(() => {
      if (combined) return;
      let cancelled = false;
      void ensureLanguageRegistered(language).then(() => {
        if (!cancelled) setSingleLanguageReady(true);
      });
      return () => {
        cancelled = true;
      };
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

    /** 拖拽选区提交：replace=替换、append=追加（Shift）。 */
    const commitDragRange = useCallback((keys: Set<string>, mode: SelectionMode, path?: string) => {
      const prefix = path ? `${path}\0` : '';
      const prefixed = new Set<string>();
      for (const key of keys) {
        prefixed.add(`${prefix}${key}`);
      }
      setSelectedLines((prev) => mergeSelection(prev, prefixed, mode));
    }, []);

    /** 单段展开/收起：仅在真正展开时按需加载全量 hunks（收起无需全量）。 */
    const toggleSection = useCallback(
      (hunkIdx: number, lineIdx: number, path?: string) => {
        const key = path ? `${path}\0${hunkIdx}:${lineIdx}` : `${hunkIdx}:${lineIdx}`;
        const expanding = !expandedSections.has(key);
        setExpandedSections((prev) => {
          const next = new Set(prev);
          if (next.has(key)) {
            next.delete(key);
          } else {
            next.add(key);
          }
          return next;
        });
        if (expanding) void loadFullHunks();
      },
      [expandedSections, loadFullHunks],
    );

    /** 切换全文模式（工具栏「展开全文 / 收起全文」）。 */
    const toggleFullMode = useCallback(() => {
      setFullMode((prev) => !prev);
      setExpandedSections(new Set());
    }, []);

    /** 切换视图模式时清空选区与展开态（unified/split 的 key 语义不同，防错位）。 */
    const handleViewModeChange = useCallback((mode: ViewMode) => {
      setViewMode(mode);
      setSelectedLines(new Set());
      setExpandedSections(new Set());
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

    /** 全局最后一个选中行所属文件（combined 模式按 hunk/行号取最大）。 */
    const lastSelectedPath = useMemo(() => {
      if (selectedLines.size === 0) return null;
      let bestPath: string | null = null;
      let bestHunk = -1;
      let bestLine = -1;
      for (const key of selectedLines) {
        const sep = key.indexOf('\0');
        const local = sep >= 0 ? key.slice(sep + 1) : key;
        const [h, l] = local.split(':').map(Number);
        if (h > bestHunk || (h === bestHunk && l > bestLine)) {
          bestHunk = h;
          bestLine = l;
          bestPath = sep >= 0 ? key.slice(0, sep) : null;
        }
      }
      return bestPath;
    }, [selectedLines]);

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

    /** combined 模式下某文件的已展开折叠段（key 去掉文件前缀）。 */
    const expandedSectionsForPath = useCallback(
      (path: string) => {
        const prefix = `${path}\0`;
        const out = new Set<string>();
        for (const key of expandedSections) {
          if (key.startsWith(prefix)) out.add(key.slice(prefix.length));
        }
        return out;
      },
      [expandedSections],
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
      setReviewPopover(true);
    }, []);

    /** combined 模式：把已展开文件的渲染 hunks 拼成带行号的 diff 文本。 */
    const combinedDiffText = useCallback((paths?: string[]): string => {
      const ref = hunksByPathRef.current;
      const targetPaths = paths && paths.length > 0 ? paths : Object.keys(ref);
      const sections: string[] = [];
      for (const p of targetPaths) {
        const hunks = ref[p];
        if (hunks && hunks.length > 0) {
          sections.push(`## file: ${p}\n${hunksToDiffText(hunks)}`);
        }
      }
      return sections.join('\n\n');
    }, []);

    /** combined 模式：把选中文件的选中行拼成带行号的 diff 文本。 */
    const combinedSelectedDiffText = useCallback((): string => {
      const ref = hunksByPathRef.current;
      const sections: string[] = [];
      for (const p of selectedFilePaths) {
        const hunks = ref[p];
        if (hunks && hunks.length > 0) {
          const text = hunksToSelectedDiffText(hunks, selectedLinesForPath(p));
          if (text) sections.push(`## file: ${p}\n${text}`);
        }
      }
      return sections.join('\n\n');
    }, [selectedFilePaths, selectedLinesForPath]);

    /** 提交选区 review（从 inline 输入条）。 */
    const submitSelectionReview = useCallback(
      (instruction?: string) => {
        const message = combined
          ? buildDiffMessage('review', {
              filePath: 'combined',
              lineCount: selectedCount,
              combined: true,
              fileCount: selectedFilePaths.length,
              filePaths: selectedFilePaths,
              instruction,
              diffText: capDiffText(combinedSelectedDiffText()),
            })
          : buildDiffMessage('review', {
              filePath,
              lineCount: selectedCount,
              instruction,
              diffText: capDiffText(
                hunksToSelectedDiffText(diffResult?.hunks ?? [], selectedLines),
              ),
            });
        sendReview(message, true);
      },
      [
        combined,
        filePath,
        diffResult,
        selectedCount,
        selectedFilePaths,
        combinedSelectedDiffText,
        selectedLines,
        sendReview,
      ],
    );

    /** 选中块末尾的 inline 输入条（VSCode 风格，嵌在 diff 表格里随选中行滚动）。 */
    const selectionActionBar = useCallback(
      () => (
        <SelectionActionBar
          selectedCount={selectedCount}
          onSubmit={submitSelectionReview}
          onClose={clearSelection}
        />
      ),
      [selectedCount, submitSelectionReview, clearSelection],
    );

    /** 提交全文 review：组装消息 → 发送到 agent 终端。 */
    const submitFullReview = useCallback(
      (instruction?: string) => {
        setReviewPopover(false);
        const message = combined
          ? buildDiffMessage('review', {
              filePath: 'combined',
              isFullDiff: true,
              combined: true,
              fileCount: fileList.length,
              instruction,
              diffText: capDiffText(combinedDiffText()),
            })
          : buildDiffMessage('review', {
              filePath,
              isFullDiff: true,
              instruction,
              diffText: capDiffText(hunksToDiffText(diffResult?.hunks ?? [])),
            });
        sendReview(message, false);
      },
      [combined, fileList.length, filePath, diffResult, combinedDiffText, sendReview],
    );

    // 弹层在 combined / single 分支各渲染一次（同一变量，只会有一处返回挂载）。
    const reviewPopoverEl = reviewPopover ? (
      <ReviewInstructionPopover
        open
        onSubmit={submitFullReview}
        onClose={() => setReviewPopover(false)}
      />
    ) : null;

    // ── Combined multi-file view ──────────────────────────────────────────
    if (combined && files && diffSource) {
      return (
        <CombinedDiffView
          projectId={projectId}
          diffSource={diffSource}
          fileList={fileList}
          currentFileIdx={currentFileIdx}
          expandedPaths={expandedPaths}
          combinedStats={combinedStats}
          viewMode={viewMode}
          fullMode={fullMode}
          allCollapsed={allCollapsed}
          changeNavIndex={changeNavIndex}
          changeNavTotal={changeNavTotal}
          scrollRef={scrollRef}
          onNavigateBlock={navigateBlock}
          onNavigateFile={navigateFile}
          onToggleFile={toggleFile}
          onToggleFoldAll={toggleFoldAll}
          onToggleFull={toggleFullMode}
          onViewModeChange={handleViewModeChange}
          onReview={handleReviewFull}
          selectedLinesForPath={selectedLinesForPath}
          onToggleLine={toggleLine}
          onDragCommit={commitDragRange}
          expandedSectionsForPath={expandedSectionsForPath}
          onToggleSection={toggleSection}
          onDiffResult={reportDiffResult}
          lastSelectedPath={lastSelectedPath}
          selectionActionBar={selectionActionBar}
          reviewPopoverEl={reviewPopoverEl}
        />
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
        onViewModeChange={handleViewModeChange}
        changeIndex={!loading && !error && totalChangeBlocks > 0 ? currentBlockIndex : 0}
        changeTotal={!loading && !error ? totalChangeBlocks : 0}
        onChangePrev={() => navigateBlock('prev')}
        onChangeNext={() => navigateBlock('next')}
        fullMode={fullMode}
        onToggleFull={toggleFullMode}
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
            languageReady={singleLanguageReady}
            selectedLines={selectedLines}
            onToggleLine={toggleLine}
            onDragCommit={(keys, mode) => commitDragRange(keys, mode)}
            fullHunks={fullHunks ?? undefined}
            expandedSections={expandedSections}
            onToggleSection={(hunkIdx, lineIdx) => toggleSection(hunkIdx, lineIdx)}
            selectionActionBar={selectionActionBar}
          />
        ) : (
          <SplitDiffTable
            diffResult={diffResult}
            language={language}
            languageReady={singleLanguageReady}
            selectedLines={selectedLines}
            onToggleLine={toggleLine}
            onDragCommit={(keys, mode) => commitDragRange(keys, mode)}
            fullHunks={fullHunks ?? undefined}
            expandedSections={expandedSections}
            onToggleSection={(hunkIdx, lineIdx) => toggleSection(hunkIdx, lineIdx)}
            selectionActionBar={selectionActionBar}
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
      <div className="relative flex-1 flex flex-col overflow-hidden min-w-0 bg-bg-secondary">
        {singleToolbar}

        {reviewPopoverEl}

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
