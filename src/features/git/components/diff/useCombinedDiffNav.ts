import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CommitFileChange } from '@/shared/types';

import { fileBlockId, indexOfPath, initialExpandedPaths, sumFileStats } from './diffViewUtils';
import type { ViewMode } from './types';

interface UseCombinedDiffNavParams {
  fileList: CommitFileChange[];
  /** Git Log 跳转目标路径（触发展开 + 滚动）。 */
  scrollToPath?: string | null;
  /** 初始展开基准（取 scrollToPath ?? filePath）。 */
  initialPath: string;
  onScrollToPathChange?: (path: string) => void;
  /** 视图模式（MutationObserver 依赖，split/unified 切换后重挂）。 */
  viewMode: ViewMode;
}

/**
 * Combined（多文件 commit）视图的导航 state 与逻辑：
 * 展开路径集合、当前文件索引、变更块光标、折叠同步。
 *
 * 仅服务 combined 模式（由 CombinedDiffView 内部调用，state colocation），
 * 使父级 DiffView 不再透传导航 props。独立于 Tauri 运行时，可脱离组件单独测试。
 */
export function useCombinedDiffNav({
  fileList,
  scrollToPath,
  initialPath,
  onScrollToPathChange,
  viewMode,
}: UseCombinedDiffNavParams) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() =>
    initialExpandedPaths(fileList, scrollToPath ?? initialPath),
  );
  const [currentFileIdx, setCurrentFileIdx] = useState(() => {
    if (fileList.length === 0) return 0;
    const idx = indexOfPath(fileList, scrollToPath ?? initialPath);
    return idx >= 0 ? idx : 0;
  });
  // Combined-mode change (hunk block) cursor across expanded files.
  const [combinedChangeIndex, setCombinedChangeIndex] = useState(0);
  const [combinedMountedTotal, setCombinedMountedTotal] = useState(0);

  const filesKey = useMemo(() => fileList.map((f) => f.path).join('\0'), [fileList]);

  const scrollFileIntoView = useCallback((path: string) => {
    const root = scrollRef.current;
    if (!root) return;
    const el = root.querySelector(`#${CSS.escape(fileBlockId(path))}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const collectChangeBlockIds = useCallback((root: ParentNode | null): string[] => {
    if (!root) return [];
    const nodes = root.querySelectorAll<HTMLElement>('[id^="cb-"]');
    // Prefer only change-block markers (id ends with -<number>), keep DOM order.
    return Array.from(nodes)
      .map((el) => el.id)
      .filter((id) => /-\d+$/.test(id));
  }, []);

  // 渲染期调整：文件集（filesKey）变化时重置导航状态。
  // React 官方推荐在渲染期间比较前值并调整 state，避免 effect 内同步 setState 级联渲染。
  const [prevFilesKey, setPrevFilesKey] = useState(filesKey);
  if (filesKey !== prevFilesKey) {
    setPrevFilesKey(filesKey);
    setExpandedPaths(initialExpandedPaths(fileList, scrollToPath ?? initialPath));
    const idx = indexOfPath(fileList, scrollToPath ?? initialPath);
    setCurrentFileIdx(idx >= 0 ? idx : 0);
    setCombinedChangeIndex(0);
  }

  // 渲染期调整：Git Log scrollToPath → 更新索引与展开路径。
  const [prevScrollToPath, setPrevScrollToPath] = useState(scrollToPath ?? null);
  if (scrollToPath && scrollToPath !== prevScrollToPath) {
    setPrevScrollToPath(scrollToPath);
    const idx = indexOfPath(fileList, scrollToPath);
    if (idx >= 0) {
      setCurrentFileIdx(idx);
      setExpandedPaths((prev) => {
        if (prev.has(scrollToPath)) return prev;
        const next = new Set(prev);
        next.add(scrollToPath);
        return next;
      });
    }
  }
  // DOM 滚动副作用只能在 effect 中执行（渲染期不允许操作 DOM）。
  useEffect(() => {
    if (!scrollToPath) return;
    requestAnimationFrame(() => scrollFileIntoView(scrollToPath));
  }, [scrollToPath, scrollFileIntoView]);

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

  /** combined 分支：扫描已挂载变更块并按视觉顺序导航（跨折叠文件）。 */
  const navigateCombinedBlock = useCallback(
    (direction: 'prev' | 'next') => {
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
      collectChangeBlockIds,
      fileList,
      currentFileIdx,
      expandedPaths,
      combinedChangeIndex,
      onScrollToPathChange,
    ],
  );

  const combinedStats = useMemo(() => sumFileStats(fileList), [fileList]);

  const allCollapsed = expandedPaths.size === 0;

  // 折叠/展开或视图切换时同步已挂载变更块数量（DOM 变更驱动）。
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const sync = () => {
      const n = collectChangeBlockIds(scrollRef.current).length;
      setCombinedMountedTotal(n);
      setCombinedChangeIndex((idx) => (n === 0 ? 0 : Math.min(idx, n - 1)));
    };
    const mo = new MutationObserver(() => sync());
    mo.observe(root, { childList: true, subtree: true });
    // 初始同步放到 rAF：effect 内只订阅外部系统，setState 均在异步回调中执行。
    const raf = requestAnimationFrame(() => sync());
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [expandedPaths, viewMode, collectChangeBlockIds, filesKey]);

  return {
    scrollRef,
    filesKey,
    expandedPaths,
    currentFileIdx,
    combinedChangeIndex,
    combinedMountedTotal,
    combinedStats,
    allCollapsed,
    toggleFile,
    toggleFoldAll,
    navigateFile,
    navigateCombinedBlock,
  };
}
