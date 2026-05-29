import type { CommitDetail, CommitFileChange } from "../../../../types";

/** Data returned by useGitLog hook */
export interface GitLogData {
  commits: import("../../../../types").CommitEntry[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
  loadingMore: boolean;
}

/** Data returned by useCommitDetail hook */
export interface CommitDetailData {
  detail: CommitDetail | null;
  files: CommitFileChange[];
  loading: boolean;
  error: string | null;
}

/** Action types for commit context menu */
export type CommitMenuAction =
  | "cherry-pick"
  | "revert"
  | "checkout-detached"
  | "create-branch"
  | "create-tag";
