import { useCallback, useState } from 'react';

export interface GitHistorySelection {
  selectedHash: string | null;
  selectedExpanded: boolean;
  searchQuery: string;
  combined: boolean;
  currentFileIdx: number;
  handleSelectCommit: (hash: string) => void;
  setSearchQuery: (query: string) => void;
  setCombined: (on: boolean) => void;
  setCurrentFileIdx: (idx: number) => void;
}

/**
 * Git History 选区本地状态（feature 容器内部状态）。
 *
 * 内聚 commit 选择 / expanded / combined / 文件索引 / 搜索词的本地 state
 * 与纯状态回调，使 GitControlPanel 保持薄壳。依赖 Diff singleton 操作的
 * 处理器（handleOpenDiff / handleToggleCombined / handlePinFile）留在面板内，
 * 因其需要 useSingletonDiff 输出，避免 hook 与 singleton 形成循环依赖。
 */
export function useGitHistorySelection(): GitHistorySelection {
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [selectedExpanded, setSelectedExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [combined, setCombined] = useState(true);
  const [currentFileIdx, setCurrentFileIdx] = useState(0);

  const handleSelectCommit = useCallback(
    (hash: string) => {
      if (selectedHash === hash) {
        setSelectedExpanded((prev) => !prev);
      } else {
        setSelectedHash(hash);
        setSelectedExpanded(true);
        setCurrentFileIdx(0);
      }
    },
    [selectedHash],
  );

  return {
    selectedHash,
    selectedExpanded,
    searchQuery,
    combined,
    currentFileIdx,
    handleSelectCommit,
    setSearchQuery,
    setCombined,
    setCurrentFileIdx,
  };
}
