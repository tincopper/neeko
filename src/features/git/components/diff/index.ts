export { default } from './DiffView';
export { default as DiffView } from './DiffView';

export type {
  DiffLine,
  DiffHunk,
  DiffResult,
  DiffSource,
  DiffViewProps,
  SplitRow,
  ViewMode,
} from './types';

export { buildSplitRows } from './diffAlgorithm';

export { detectLanguage, escapeHtml } from './highlight';

export {
  splitFilePath,
  fileBlockId,
  statusLetter,
  initialExpandedPaths,
  sumFileStats,
} from './diffFileDisplay';
