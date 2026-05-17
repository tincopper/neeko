export interface FileChange {
  path: string;
  status: "Modified" | "Added" | "Deleted" | "Renamed" | "Untracked";
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
  head_ref_name: string;
  base_ref_name: string;
  created_at: string;
  is_cross_repository: boolean;
  head_repository_owner: string;
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
  head_ref_name: string;
  base_ref_name: string;
  url: string;
  created_at: string;
  mergeable: string | null;
  merge_state_status: string | null;
  is_draft: boolean;
  is_cross_repository: boolean;
  status_check_rollup: PRStatusCheck[] | null;
}

export interface PRMergeResult {
  success: boolean;
  message: string;
}

/** 后端 git-status-diff 事件 payload（增量更新） */
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
