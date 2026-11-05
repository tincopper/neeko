import type { WorkspaceSession } from '@/shared/utils/workspaceRef';

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
  git_provider: string;
  /**
   * 注意：**没有** changed_files / is_clean。未提交变更属于「每个工作树」
   * （HEAD / index / workdir 三者独立），经 `GitStatusSnapshot` 按 `workspace_key` 投递，
   * 存于 `projectStore.statuses`。放进这份 per-project 结构正是 worktree 视图
   * 串主仓内容的结构成因。
   */
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

/** 与 Rust `common::git::perf::GitPerfSuggestion` 保持 IPC 契约同步 */
export interface GitPerfSuggestion {
  kind: string;
  command: string;
  label: string;
}

/** 与 Rust watcher `GitPerfSuggestionEvent` 保持 IPC 契约同步 */
export interface GitPerfSuggestionEvent {
  project_id: string;
  suggestions: GitPerfSuggestion[];
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

/** 行级变更种类（IDEA 语义：added=绿、modified=蓝；口径=相对 HEAD 单档）。 */
export type LineChangeKind = 'added' | 'modified';

/** 编辑器行级变更条目（deriveFileLineChanges 输出；仅含存在编辑器行位的变更）。 */
export interface FileLineChange {
  /** 1-based，diff new 侧 = 编辑器行号 */
  line: number;
  kind: LineChangeKind;
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
/**
 * 一个Workspace的权威 status（与 Rust `GitStatusSnapshot` 同形，字段名 snake_case）。
 *
 * `workspace_key` 由后端产出（`WorkspaceRef::key()`），前端只透传 + 作 map 键，
 * 见 `src/shared/utils/workspaceRef.ts`。`version` 在该单元内单调递增，**恒 > 0**。
 */
export interface GitStatusSnapshot {
  workspace_key: string;
  version: number;
  project_id: string;
  /** linked worktree 的 canonical 路径；主仓为 null */
  worktree_path: string | null;
  branch: string;
  entries: FileChange[];
  truncated: boolean;
  /**
   * 相对 `@{upstream}` 的领先/落后提交数（无 upstream / detached / 非 git → 0）。
   * 与 entries/branch 由同一个生产者同批产出 —— 是 ahead/behind 的唯一权威通道
   * （`git-status-snapshot`），前端不再各自触发独立的 getAheadBehind 拉取。
   */
  ahead: number;
  behind: number;
}

/**
 * `set_visible_workspaces` 的**逐单元**结局（与 Rust `WorkspaceActivationEntry` 同形，
 * serde tag = `state`）。
 *
 * 三态都是**数据**：一个坏项目只让自己那项 `failed`，不得拖死同批其它单元（整批 `Err`
 * 会让前端只能整体渲染一次错误）。
 *
 * `pending` = 挂载已成立、首个快照尚未算出（push 生产者的冷窗口）—— **不是错误**。
 * 消费侧对它的正确反应是**什么都不做**：读路径（C1 起读永远给得出答案）与
 * `git-status-snapshot` 推送会收敛，前端不维护重试环（C4 / 红线 17）。
 */
export type WorkspaceActivationEntry =
  | { state: 'ready'; workspace_key: string; snapshot: GitStatusSnapshot }
  | { state: 'pending'; workspace_key: string }
  | { state: 'failed'; workspace_key: string; error: string };

/** `git-changed` 事件载荷：某单元的 git 元数据（HEAD 等）变了 → 「该重查了」的提示。
 * 事实本身由 `git-status-snapshot` 携带；旧形态是裸 project_id 字符串（缺单元维度）。 */
export interface GitChangedEvent {
  workspace_key: string;
  project_id: string;
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

/**
 * diff 的修订维度：对**工作区**（未提交）/ 某个 commit / 某个 stash 做 diff。
 *
 * 环境（local / WSL / SSH）**不在这里** —— 它由 `ProjectCommands`（按Workspace构造）
 * 携带；把环境塞进数据源是「同一份身份两种表示」，且会让远端 worktree 缺维度。
 */
export type DiffRevision =
  | { type: 'worktree' }
  | { type: 'commit'; commitHash: string }
  | { type: 'stash'; selector: string }
  // 修订维度天然容纳「index 的 unmerged 状态」——冲突是「对 index 做 diff」，
  // 故落在 DiffRevision 而非新增 tab 类型（R7：不新增 TabData.kind / 地址类型）。
  | { type: 'conflict' };

/** diff 的完整地址：Workspace（`projectId` + `worktreePath`）+ 修订维度。 */
export interface DiffSource {
  workspace: WorkspaceSession;
  revision: DiffRevision;
}

// ─── Git 冲突三态（index unmerged stages）─────────────────────────────────────

/**
 * 冲突类型（与 Rust `ConflictKind` 的 serde `snake_case` 逐字对齐）。
 *
 * 不含 `both_deleted`：双方都删（DD）不产生 unmerged 条目，永远不进入本读路径。
 */
export type ConflictKind =
  | 'both_modified'
  | 'both_added'
  | 'modify_delete'
  | 'rename_rename'
  | 'binary';

/**
 * 冲突的一个阶段侧。**`content === null` = 该 stage 不存在**（DU 的 ours、UD 的 theirs、
 * AA 的 base、binary 的任意侧）——与「文件确实是空的」（`content === ''`）是两种语义，
 * 渲染上必须区分（R3：缺失 stage 绝不被归一为空串）。
 */
export interface ConflictSide {
  /** 该侧路径（rename/rename 下三侧可不同）。 */
  path: string | null;
  /** 该侧内容；`null` = stage 缺失或 binary 不解码。 */
  content: string | null;
  /** 该侧内容原始字节数（内容被载荷预算截断时仍报截断前大小）。 */
  size: number;
  /** 是否二进制（前 8KB 含 `0x00`）。 */
  is_binary: boolean;
  /** 内容是否因载荷预算被截断。 */
  truncated: boolean;
}

/** 合并输出中的单个冲突区域（行区间 + 三侧候选）。 */
export interface MergeRegion {
  /** 区域 id（自 0 递增）。 */
  id: number;
  /** 合并输出中的起始行（0-based）。 */
  merged_start: number;
  /** 合并输出中的结束行（0-based 半开）。 */
  merged_end: number;
  /** base 侧候选行。 */
  base_lines: string[];
  /** ours 侧候选行。 */
  our_lines: string[];
  /** theirs 侧候选行。 */
  their_lines: string[];
  /** base 侧原文起始行号（三栏对齐用）。 */
  base_start: number;
  /** ours 侧原文起始行号（三栏对齐用）。 */
  our_start: number;
  /** theirs 侧原文起始行号（三栏对齐用）。 */
  their_start: number;
}

/** 一个冲突文件的完整三态视图（`get_conflict_stages` 的返回值）。 */
export interface ConflictStages {
  /** 冲突文件路径（仓库相对）。 */
  path: string;
  kind: ConflictKind;
  ancestor: ConflictSide | null;
  ours: ConflictSide | null;
  theirs: ConflictSide | null;
  /** 合并文本（仅可区域合并且非 binary 时存在）。 */
  merged: string | null;
  /** 冲突区域列表（可区域合并时非空）。 */
  regions: MergeRegion[];
  /** 任一侧 / merged / regions 是否被载荷预算截断。 */
  truncated: boolean;
  /**
   * 是否可做区域级合并（后端 `ConflictKind::is_region_mergeable` 的权威结论）。
   *
   * **前端不得按 `kind` 重算**这条语义（那是同一条领域判据的第二份实现，改一处必漏
   * 另一处）；也**不得**用 `merged !== null` 反推 —— `merged` 是派生展示数据，它的存在与否
   * 由载荷预算支配（`cap_conflict_payload`）而不是由语义支配，两者同进退只是巧合。
   */
  region_mergeable: boolean;
}

/** 整文件决议采用哪一侧（与 Rust `TakeSide` 的 serde `snake_case` 逐字对齐）。 */
export type TakeSide = 'ours' | 'theirs';

/** 区域决议采用方式（比 `TakeSide` 多 `both` = 我方行 + 对方行按序拼接）。 */
export type RegionTake = 'ours' | 'theirs' | 'both';

/**
 * 一处冲突决议（与 Rust `ConflictResolution` 的 serde 形态逐字对齐）。
 *
 * - `{ kind: 'whole_file', take }`
 * - `{ kind: 'regions', decisions }`（元组序列化为 `[regionId, take]` 数组）
 */
export type ConflictResolution =
  | { kind: 'whole_file'; take: TakeSide }
  | { kind: 'regions'; decisions: Array<[number, RegionTake]> };

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

// ─── Git 长操作输出事件 ───────────────────────────────────────────────────

/** Git 长操作（push/fetch/pull/commit）输出块来自哪条标准流。 */
export type GitOutputStream = 'stdout' | 'stderr';

/** `git-operation-output` 事件载荷（camelCase，镜像 Rust `Serialize` 形态）。 */
export interface GitOperationOutputPayload {
  /** Console run id（后端 `console_run_id` 原样回传）。 */
  runId: string;
  /** 输出块来自哪条标准流。 */
  stream: GitOutputStream;
  /** UTF-8 文本块（跨读边界的多字节字符已由采集层合流补齐）。 */
  chunk: string;
}
