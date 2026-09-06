import type { AuthMethod } from './connection';

export interface FileChange {
  path: string;
  status: 'Modified' | 'Added' | 'Deleted' | 'Renamed' | 'Untracked';
  additions: number;
  deletions: number;
  /**
   * porcelain X（staged 侧）状态字符（G6 契约，' '/A/M/D/R/T/U）。
   * 旧 payload / 未产出 XY 时缺省——消费端须走单 status 回退分组。
   */
  index_status?: string;
  /** porcelain Y（unstaged 侧）状态字符（' '?/M/D/R/T/U） */
  worktree_status?: string;
  /** rename 原路径（X 或 Y 含 'R' 时存在；UI 显示 old → new） */
  renamed_from?: string;
  /**
   * 折叠的 untracked 目录条目（G1 契约）。path 一律不带尾斜杠，目录性由本字段
   * 显式表达 —— 不再用 `path.endsWith('/')` 隐式判定（曾因 A=CLI 带斜杠 /
   * B=libgit2 不带斜杠 而分裂，untracked 目录在兜底路径下永远无法展开 —— P0）。
   *
   * 过渡期可选：消费端判定统一用 `is_dir ?? path.endsWith('/')`（兜底旧 payload）。
   */
  is_dir?: boolean;
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

export interface StashActionResult {
  success: boolean;
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
  /** 折叠 untracked 目录条目（G1 契约；后端 A 路径自 G1 起保证发送） */
  is_dir?: boolean;
}

/**
 * G2 事件协议 v2：versioned 全量 git-status 快照（单一权威）。
 * worker 每次实质变化产出完整快照整体替换 —— 前端按 `version` 单调递增门控消费，
 * 乱序/回退覆盖从结构上消除（P1）。entries 直接复用 FileChange（含 is_dir）。
 */
export interface GitStatusSnapshot {
  version: number;
  project_id: string;
  branch: string;
  entries: FileChange[];
  truncated: boolean;
}

/** `get_worktree_changed_files` 读接口返回（G2 D2 收编）：`version=0` 表示无
 * versioned 快照语义（WSL/SSH / worktree 兜底），前端只在 version>0 时 gate。 */
export interface ChangedFilesPayload {
  files: FileChange[];
  version: number;
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
    }
  | { type: 'stash'; projectId: string; selector: string };

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
