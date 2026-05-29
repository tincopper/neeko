// Re-export stub — barrel moved to @/features/git/components/diff
export { default } from "@/features/git/components/diff";
export { default as DiffView } from "@/features/git/components/diff";

export type {
  DiffLine,
  DiffHunk,
  DiffResult,
  DiffSource,
  DiffViewProps,
  SplitRow,
  ViewMode,
} from "@/features/git/components/diff";

export {
  tokenizeForDiff,
  computeLCS,
  computeWordDiff,
  buildSplitRows,
} from "@/features/git/components/diff";
export type { WordDiffPart } from "@/features/git/components/diff";

export { detectLanguage, escapeHtml } from "@/features/git/components/diff";
