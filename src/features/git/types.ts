export interface FileChange {
  path: string;
  status: "Modified" | "Added" | "Deleted" | "Renamed" | "Untracked";
  additions: number;
  deletions: number;
}

export interface FileDiffStats {
  path: string;
  additions: number;
  deletions: number;
}

export interface Worktree {
  path: string;
  branch: string;
  head: string;
}

export interface GitBranchInfo {
  current_branch: string;
  branches: string[];
  worktrees: Worktree[];
}

export interface GitInfo {
  current_branch: string;
  branches: string[];
  worktrees: Worktree[];
  changed_files: FileChange[];
  is_clean: boolean;
}

export interface CommitEntry {
  hash: string;
  short_hash: string;
  author: string;
  timestamp: string;
  message: string;
  refs: string;
  parents: string[];
}

export interface CommitDetail {
  hash: string;
  short_hash: string;
  author: string;
  email: string;
  timestamp: string;
  message: string;
  parents: string[];
  refs: string;
}

export interface CommitFileChange {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface CommitResult {
  success: boolean;
  hash: string;
  message: string;
}

export interface AheadBehind {
  ahead: number;
  behind: number;
}

export type DiffLine =
  | { Context: string }
  | { Added: string }
  | { Removed: string }
  | { Collapsed: string };

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

export interface PRListItem {
  number: number;
  title: string;
  state: string;
  author: string;
  headRefName: string;
  baseRefName: string;
  createdAt: string;
  isCrossRepository: boolean;
  headRepositoryOwner: string;
  comment_count?: number;
}

export interface PRStatusCheck {
  __typename: string;
  name?: string;
  status?: string;
  conclusion?: string;
  detailsUrl?: string;
}

export interface PRInfo {
  number: number;
  title: string;
  state: string;
  body: string | null;
  author: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  createdAt: string;
  mergeable: string | null;
  mergeStateStatus: string | null;
  isDraft: boolean;
  isCrossRepository: boolean;
  statusCheckRollup: PRStatusCheck[] | null;
  mergeCommit?: {
    oid: string;
  } | null;
}

export interface PRMergeResult {
  success: boolean;
  message: string;
}

export interface PRFileChange {
  path: string;
  status: "added" | "removed" | "modified" | "renamed";
  additions: number;
  deletions: number;
}

export interface PRCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  timestamp: string;
}

export interface GitStatusFile {
  path: string;
  status: string;
}

export interface GitStatusDiff {
  project_id: string;
  added: GitStatusFile[];
  removed: string[];
  modified: GitStatusFile[];
}
