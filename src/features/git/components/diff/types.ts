import type { ViewMode, DiffSource } from '@/shared/types/git';

export type { ViewMode, DiffSource } from '@/shared/types/git';

export interface DiffLine {
  Context?: string;
  Added?: string;
  Removed?: string;
  Collapsed?: string;
}

export interface DiffHunk {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  lines: DiffLine[];
}

export interface DiffResult {
  hunks: DiffHunk[];
  truncated?: boolean;
}

export interface CommitFileChange {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface DiffViewProps {
  projectId?: string;
  diffSource?: DiffSource;
  filePath: string;
  initialMode?: ViewMode;
  onBack?: () => void;
  combined?: boolean;
  files?: CommitFileChange[];
  scrollToPath?: string;
  onScrollToPathChange?: (path: string) => void;
}

export interface SplitRow {
  type: 'hunk-header' | 'change' | 'context';
  hunkHeader?: string;
  oldLineNum?: number;
  newLineNum?: number;
  oldContent?: string;
  newContent?: string;
  oldType?: 'removed' | 'context' | 'empty';
  newType?: 'added' | 'context' | 'empty';
}
