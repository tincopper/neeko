import { useEffect } from 'react';

import type { CommitEntry, CommitFileChange } from '@/shared/types';

export interface GitLogKeyboardNavOptions {
  /** 仅当 enabled（如 History tab 激活）时注册全局键盘监听 */
  enabled: boolean;
  commits: CommitEntry[];
  selectedHash: string | null;
  files: CommitFileChange[];
  currentFileIdx: number;
  combined: boolean;
  onSelectCommit: (hash: string) => void;
  onOpenFileDiff: (filePath: string) => void;
  onToggleCombined: (on: boolean) => void;
}

/**
 * Git 历史面板键盘导航：J/K 切换 commit，j/k 切换文件，c 切换 combined diff。
 * 输入控件聚焦时跳过；enabled=false 时不监听（非 History tab / 面板不可见）。
 */
export function useGitLogKeyboardNav({
  enabled,
  commits,
  selectedHash,
  files,
  currentFileIdx,
  combined,
  onSelectCommit,
  onOpenFileDiff,
  onToggleCombined,
}: GitLogKeyboardNavOptions): void {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }

      switch (e.key) {
        case 'J': {
          e.preventDefault();
          const ci = commits.findIndex((c) => c.hash === selectedHash);
          if (ci >= 0 && ci < commits.length - 1) {
            onSelectCommit(commits[ci + 1].hash);
          } else if (ci < 0 && commits.length > 0) {
            onSelectCommit(commits[0].hash);
          }
          break;
        }
        case 'K': {
          e.preventDefault();
          const ci = commits.findIndex((c) => c.hash === selectedHash);
          if (ci > 0) {
            onSelectCommit(commits[ci - 1].hash);
          }
          break;
        }
        case 'j': {
          if (files.length === 0) break;
          e.preventDefault();
          const nextIdx = Math.min(currentFileIdx + 1, files.length - 1);
          if (nextIdx !== currentFileIdx) {
            onOpenFileDiff(files[nextIdx].path);
          }
          break;
        }
        case 'k': {
          if (files.length === 0) break;
          e.preventDefault();
          const nextIdx = Math.max(currentFileIdx - 1, 0);
          if (nextIdx !== currentFileIdx) {
            onOpenFileDiff(files[nextIdx].path);
          }
          break;
        }
        case 'c': {
          e.preventDefault();
          onToggleCombined(!combined);
          break;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    enabled,
    commits,
    selectedHash,
    files,
    currentFileIdx,
    combined,
    onSelectCommit,
    onOpenFileDiff,
    onToggleCombined,
  ]);
}
