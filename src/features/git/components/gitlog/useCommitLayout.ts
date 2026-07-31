import { useMemo } from 'react';

import type { CommitEntry } from '@/shared/types';

import { computeLayout, type CommitNode, type BranchSegment } from './CommitGraph';

export interface LayoutState {
  nodes: CommitNode[];
  segments: BranchSegment[];
  totalCols: number;
  maxColUsed: number;
  truncatedRows: number[];
}

export function useCommitLayout(commits: CommitEntry[]): LayoutState {
  return useMemo(() => computeLayout(commits), [commits]);
}
