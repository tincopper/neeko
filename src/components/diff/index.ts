export { default } from "./DiffView";
export { default as DiffView } from "./DiffView";

export type {
  DiffLine,
  DiffHunk,
  DiffResult,
  DiffSource,
  DiffViewProps,
  SplitRow,
  ViewMode,
} from "./types";

export {
  tokenizeForDiff,
  computeLCS,
  computeWordDiff,
  buildSplitRows,
} from "./diffAlgorithm";
export type { WordDiffPart } from "./diffAlgorithm";

export { detectLanguage, escapeHtml } from "./highlight";
