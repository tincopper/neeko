import { useCallback, useEffect } from 'react';

import type { CommitFileChange } from '@/shared/types';

export interface GitHistoryDiffActionsOptions {
  selectedHash: string | null;
  files: CommitFileChange[];
  combined: boolean;
  currentFileIdx: number;
  openFileInDiff: (filePath: string) => void;
  openCombined: (currentFile?: string) => void;
  pinFile: (filePath: string) => void;
  scrollToFile: (filePath: string) => void;
  refreshOpenDiff: (opts: { combined: boolean; preferredPath?: string | null }) => void;
  hasSingleton: () => boolean;
  setCombined: (on: boolean) => void;
  setCurrentFileIdx: (idx: number) => void;
}

export interface GitHistoryDiffActions {
  handleToggleCombined: (on: boolean) => void;
  handleOpenDiff: (filePath: string) => void;
  handlePinFile: (filePath: string) => void;
}

/**
 * Git History 依赖 Diff singleton 的处理器（组合 useSingletonDiff 输出）。
 *
 * 与 useGitHistorySelection 拆分：本 hook 只消费 singleton 操作与外部状态，
 * 依赖链线性（selection state → commit detail → singleton → 本 hook），
 * 避免与 useSingletonDiff 形成循环依赖。
 */
export function useGitHistoryDiffActions({
  selectedHash,
  files,
  combined,
  currentFileIdx,
  openFileInDiff,
  openCombined,
  pinFile,
  scrollToFile,
  refreshOpenDiff,
  hasSingleton,
  setCombined,
  setCurrentFileIdx,
}: GitHistoryDiffActionsOptions): GitHistoryDiffActions {
  // When commit detail files arrive, refresh an already-open Diff singleton.
  useEffect(() => {
    if (!selectedHash || files.length === 0) return;
    if (!hasSingleton()) return;
    const preferred = files[currentFileIdx]?.path ?? files[0]?.path ?? null;
    refreshOpenDiff({ combined, preferredPath: preferred });
    // Only re-run when commit/files identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHash, files]);

  const handleToggleCombined = useCallback(
    (on: boolean) => {
      setCombined(on);
      const preferred =
        files[currentFileIdx]?.path ?? (files.length > 0 ? files[0].path : undefined);
      if (on) {
        if (preferred) openCombined(preferred);
      } else if (preferred) {
        // Closing combined mode: switch the Diff singleton back to single-file view.
        openFileInDiff(preferred);
      }
    },
    [files, currentFileIdx, openCombined, openFileInDiff, setCombined],
  );

  const handleOpenDiff = useCallback(
    (filePath: string) => {
      const idx = files.findIndex((f) => f.path === filePath);
      if (idx >= 0) setCurrentFileIdx(idx);
      if (combined) {
        // Combined mode: keep multi-file view and scroll to the target file.
        if (hasSingleton()) {
          scrollToFile(filePath);
        } else {
          openCombined(filePath);
        }
        return;
      }
      openFileInDiff(filePath);
    },
    [files, combined, hasSingleton, scrollToFile, openCombined, openFileInDiff, setCurrentFileIdx],
  );

  const handlePinFile = useCallback(
    (filePath: string) => {
      pinFile(filePath);
    },
    [pinFile],
  );

  return { handleToggleCombined, handleOpenDiff, handlePinFile };
}
