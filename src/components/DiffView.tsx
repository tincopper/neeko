export { default } from "./diff";
export type {
  DiffLine,
  DiffHunk,
  DiffResult,
  DiffSource,
  DiffViewProps,
  SplitRow,
  ViewMode,
  WordDiffPart,
} from "./diff";
export { detectLanguage, escapeHtml, tokenizeForDiff, computeLCS, computeWordDiff, buildSplitRows } from "./diff";
