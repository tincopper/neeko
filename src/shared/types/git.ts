import type { AuthMethod } from './connection';

export interface FileChange {
  path: string;
  status: 'Modified' | 'Added' | 'Deleted' | 'Renamed' | 'Untracked';
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
  git_provider: string;
  /** 被 .gitignore 忽略的相对路径列表（用于文件树灰色显示） */
  ignored_files?: string[];
}

export interface CommitEntry {
  hash: string;
  short_hash: string;
  author: string;
  timestamp: string;
  message: string;
  refs: string;
  parents: string[];
  /** 结构化 refs 分类（仅 branch/remote/tag/stash；tool refs 已由后端过滤） */
  refs_list?: ParsedRef[];
}

export type ParsedRefKind = 'branch' | 'remote' | 'tag' | 'stash';

export interface ParsedRef {
  kind: ParsedRefKind;
  name: string;
}

export interface StashEntry {
  selector: string;
  hash: string;
  message: string;
  branch: string;
  timestamp: string;
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

export interface PrLabel {
  name: string;
  color: string;
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
  commentCount?: number;
  labels: PrLabel[];
  assignees: { login: string }[];
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
  mergedBy?: { login: string; avatarUrl?: string } | null;
  closedBy?: { login: string; avatarUrl?: string } | null;
  mergedAt?: string | null;
  closedAt?: string | null;
}

export interface PRMergeResult {
  success: boolean;
  message: string;
}

export interface PRFileChange {
  path: string;
  status: 'added' | 'removed' | 'modified' | 'renamed';
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
  additions: number;
  deletions: number;
}

export interface GitStatusDiff {
  project_id: string;
  added: GitStatusFile[];
  removed: string[];
  modified: GitStatusFile[];
}

export type PushOutcome =
  | { Success: Record<string, never> }
  | {
      AuthRequired: {
        remote_url: string;
        username_hint: string | null;
        ssh: boolean;
      };
    };

// ─── Diff View Types ────────────────────────────────────────────────────────

export type ViewMode = 'unified' | 'split';

export type DiffSource =
  | { type: 'local'; projectId: string }
  | { type: 'wsl'; distro: string; projectPath: string }
  | {
      type: 'remote';
      entryId: string;
      host: string;
      port: number;
      username: string;
      auth: AuthMethod;
      projectPath: string;
    }
  | { type: 'worktree'; projectId: string; worktreePath: string }
  | { type: 'commit'; projectId: string; commitHash: string }
  | { type: 'wsl-commit'; distro: string; projectPath: string; commitHash: string }
  | {
      type: 'remote-commit';
      host: string;
      port: number;
      username: string;
      auth: AuthMethod;
      projectPath: string;
      commitHash: string;
    };

// ─── PR Comment Types ───────────────────────────────────────────────────────

export interface CommentReaction {
  emoji: string;
  count: number;
  userReacted: boolean;
}

export interface PRComment {
  id: string;
  author: string;
  authorAvatar?: string;
  body: string;
  createdAt: string;
  updatedAt?: string;
  reactions?: CommentReaction[];
}

export interface PRReviewComment {
  id: string;
  author: string;
  authorAvatar?: string;
  body: string;
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  commitId: string;
  createdAt: string;
  updatedAt?: string;
}
