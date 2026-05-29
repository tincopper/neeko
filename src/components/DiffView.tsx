export { default } from "@/features/git/components/diff";
export type {
  DiffLine,
  DiffHunk,
  DiffResult,
  DiffSource,
  DiffViewProps,
  SplitRow,
  ViewMode,
  WordDiffPart,
} from "@/features/git/components/diff";
export { detectLanguage, escapeHtml, tokenizeForDiff, computeLCS, computeWordDiff, buildSplitRows } from "@/features/git/components/diff";
