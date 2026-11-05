import { invoke } from '@tauri-apps/api/core';

import type { ProjectId, WorkspaceSession } from '@/shared/utils/workspaceRef';

import type {
  GitInfo,
  GitBranchInfo,
  FileDiffStats,
  DiffResult,
  CommitEntry,
  CommitDetail,
  CommitFileChange,
  CommitResult,
  AheadBehind,
  PushOutcome,
  StashActionResult,
  StashEntry,
  GitStatusSnapshot,
  WorkspaceActivationEntry,
  ConflictStages,
  ConflictResolution,
} from '../types';
export type { PushOutcome };

// ─── Staging ─────────────────────────────────────────────────────────────────

export function stageFiles(workspace: WorkspaceSession, filePaths: string[]): Promise<void> {
  return invoke<void>('stage_files', { workspace, filePaths });
}

export function unstageFiles(workspace: WorkspaceSession, filePaths: string[]): Promise<void> {
  return invoke<void>('unstage_files', { workspace, filePaths });
}

export function stageAll(workspace: WorkspaceSession): Promise<void> {
  return invoke<void>('stage_all', { workspace });
}

export function unstageAll(workspace: WorkspaceSession): Promise<void> {
  return invoke<void>('unstage_all', { workspace });
}

export function discardFiles(workspace: WorkspaceSession, filePaths: string[]): Promise<void> {
  return invoke<void>('discard_files', { workspace, filePaths });
}

// ─── Remote operations ───────────────────────────────────────────────────────

export function fetch(
  workspace: WorkspaceSession,
  consoleRunId?: string | null,
): Promise<PushOutcome> {
  return invoke<PushOutcome>('fetch', {
    workspace,
    consoleRunId: consoleRunId ?? null,
  });
}

export function pull(
  workspace: WorkspaceSession,
  consoleRunId?: string | null,
): Promise<PushOutcome> {
  return invoke<PushOutcome>('pull', {
    workspace,
    consoleRunId: consoleRunId ?? null,
  });
}

export function push(
  workspace: WorkspaceSession,
  setUpstream?: boolean,
  consoleRunId?: string | null,
): Promise<PushOutcome> {
  return invoke<PushOutcome>('push', {
    workspace,
    // 默认 false 而非 undefined：后端收 Option<bool>，undefined → None 与 false 语义不同
    setUpstream: setUpstream ?? false,
    consoleRunId: consoleRunId ?? null,
  });
}

export function fetchWithCredentials(
  workspace: WorkspaceSession,
  username: string,
  password: string,
  consoleRunId?: string | null,
): Promise<PushOutcome> {
  return invoke<PushOutcome>('fetch_with_credentials', {
    workspace,
    username,
    password,
    consoleRunId: consoleRunId ?? null,
  });
}

export function pullWithCredentials(
  workspace: WorkspaceSession,
  username: string,
  password: string,
  consoleRunId?: string | null,
): Promise<PushOutcome> {
  return invoke<PushOutcome>('pull_with_credentials', {
    workspace,
    username,
    password,
    consoleRunId: consoleRunId ?? null,
  });
}

export function pushWithCredentials(
  workspace: WorkspaceSession,
  setUpstream: boolean,
  username: string,
  password: string,
  consoleRunId?: string | null,
): Promise<PushOutcome> {
  return invoke<PushOutcome>('push_with_credentials', {
    workspace,
    setUpstream,
    username,
    password,
    consoleRunId: consoleRunId ?? null,
  });
}

export function commitFiles(
  workspace: WorkspaceSession,
  filePaths: string[],
  message: string,
  consoleRunId?: string | null,
): Promise<CommitResult> {
  return invoke<CommitResult>('commit_files', {
    workspace,
    filePaths,
    message,
    consoleRunId: consoleRunId ?? null,
  });
}

/**
 * Cancel the in-flight git sync operation (push / fetch / pull / commit).
 *
 * `consoleRunId` 限定取消目标：与后端单飞槽里的 run id 匹配才生效，避免用陈旧的
 * 仓库 run id 误取消另一个仓库正在跑的操作。幂等：没有在跑的操作时 no-op。
 */
export function cancelGitSync(consoleRunId?: string | null): Promise<void> {
  return invoke<void>('cancel_git_sync', { consoleRunId: consoleRunId ?? null });
}

// ─── Cherry-pick / Revert / Tag ──────────────────────────────────────────────

export function cherryPick(workspace: WorkspaceSession, commitHash: string): Promise<void> {
  return invoke<void>('cherry_pick', { workspace, commitHash });
}

export function revert(workspace: WorkspaceSession, commitHash: string): Promise<void> {
  return invoke<void>('revert', { workspace, commitHash });
}

export function createTag(
  workspace: WorkspaceSession,
  name: string,
  message: string,
): Promise<void> {
  return invoke<void>('create_tag', { workspace, name, message });
}

// ─── Branching ───────────────────────────────────────────────────────────────

export function checkoutBranch(workspace: WorkspaceSession, branchName: string): Promise<void> {
  return invoke<void>('checkout_branch', { workspace, branchName });
}

export function createBranch(
  workspace: WorkspaceSession,
  branchName: string,
  startPoint?: string | null,
): Promise<void> {
  return invoke<void>('create_branch', { workspace, branchName, startPoint });
}

export function deleteBranch(
  workspace: WorkspaceSession,
  branchName: string,
  force?: boolean,
): Promise<void> {
  return invoke<void>('delete_branch', { workspace, branchName, force });
}

export function renameBranch(
  workspace: WorkspaceSession,
  oldName: string,
  newName: string,
): Promise<void> {
  return invoke<void>('rename_branch', { workspace, oldName, newName });
}

export function createAndSwitchBranch(
  workspace: WorkspaceSession,
  branchName: string,
): Promise<void> {
  return invoke<void>('create_and_switch_branch', { workspace, branchName });
}

export function checkoutDetached(workspace: WorkspaceSession, commitHash: string): Promise<void> {
  return invoke<void>('checkout_detached', { workspace, commitHash });
}

// ─── Worktree ────────────────────────────────────────────────────────────────

export function createWorktree(
  projectId: ProjectId,
  worktreePath: string,
  branchName: string,
  newBranch: boolean,
): Promise<void> {
  return invoke<void>('create_worktree', { projectId, worktreePath, branchName, newBranch });
}

export function removeWorktree(projectId: ProjectId, worktreePath: string): Promise<void> {
  return invoke<void>('remove_worktree', { projectId, worktreePath });
}

export function renameWorktree(
  projectId: ProjectId,
  oldPath: string,
  newPath: string,
): Promise<void> {
  return invoke<void>('rename_worktree', { projectId, oldPath, newPath });
}

export function isWorktreeDirty(projectId: ProjectId, worktreePath: string): Promise<boolean> {
  return invoke<boolean>('is_worktree_dirty', { projectId, worktreePath });
}

// ─── Info / Read operations ──────────────────────────────────────────────────

export function getGitInfo(workspace: WorkspaceSession): Promise<GitInfo> {
  return invoke<GitInfo>('get_git_info', { workspace });
}

export function getGitBranchInfo(workspace: WorkspaceSession): Promise<GitBranchInfo> {
  return invoke<GitBranchInfo>('get_git_branch_info', { workspace });
}

/**
 * 读取某**Workspace**的权威 status（主仓与 worktree 同一条路径、同一种载荷）。
 *
 * 取代旧的 `get_worktree_changed_files` + `ChangedFilesPayload{version: 0}`：那张无版本
 * 语义的口子使前端 gate 只能恒放行，pull 结果与 push 快照在同一槽后到者胜（串数据）。
 * 命令失败 = 该单元状态**未知**，调用方不得把错误当「无变更」。
 */
export function getWorkspaceStatus(workspace: WorkspaceSession): Promise<GitStatusSnapshot> {
  return invoke<GitStatusSnapshot>('get_workspace_status', { workspace });
}

/**
 * 声明**可见集合**（= 热集合）：这些Workspace应当拥有 push 生产者，集合外的已挂载单元
 * 由后端释放（声明式 reconcile，不是「挂一个踢一个」）。
 *
 * 释放**不作废登记表数据**（C1）：切回该单元读到的是旧值 + 脏位/陈旧窗口触发的重算。
 * 返回值是**逐单元**结局：`ready` 带快照、`pending` = 冷窗口（不是错误）、`failed` =
 * 该单元自己失败（不影响同批其它单元）。
 *
 * 唯一调用方是 `useVisibleWorkspaces`（app 层「当前视图是谁」的唯一发送端）。
 */
export function setVisibleWorkspaces(
  workspaces: WorkspaceSession[],
): Promise<WorkspaceActivationEntry[]> {
  return invoke<WorkspaceActivationEntry[]>('set_visible_workspaces', { workspaces });
}

/**
 * 让后端把一个 worktree 路径归一成 canonical 形态。
 *
 * 路径身份的唯一归一点在后端（红线 8/12），前端不得自己 `realpath`/剥尾分隔符。
 * 用在「从 session 恢复激活单元」：旧 session 里的形态可能与 `git worktree list`
 * 回传的不是同一个字符串而指的却是同一个目录，不归一就会被存活校验误判为已消失。
 */
export function canonicalWorktreePath(projectId: ProjectId, path: string): Promise<string> {
  return invoke<string>('canonical_worktree_path', { projectId, path });
}

export function getUntrackedFiles(workspace: WorkspaceSession, dirPath: string): Promise<string[]> {
  return invoke<string[]>('get_untracked_files', { workspace, dirPath });
}

export function getChangedFilesDiffStats(workspace: WorkspaceSession): Promise<FileDiffStats[]> {
  return invoke<FileDiffStats[]>('get_changed_files_diff_stats', {
    workspace,
  });
}

export function getFileDiff(
  workspace: WorkspaceSession,
  filePath: string,
  collapse?: boolean,
): Promise<DiffResult> {
  const t0 = performance.now();
  return invoke<DiffResult>('get_file_diff', {
    workspace,
    filePath,
    collapse: collapse ?? true,
  }).then((r) => {
    console.debug(
      '[perf] invoke get_file_diff:',
      filePath,
      `${(performance.now() - t0).toFixed(0)}ms`,
    );
    return r;
  });
}

/**
 * 读一个冲突文件的 index unmerged stages（三侧 + 区域）——Diff 面板的冲突视图数据源。
 *
 * **契约（与单文件 diff 三态契约同族）**：该 path 无 unmerged 条目时命令 `Err` ——
 * 语义是「caller 应回退普通 diff」（已解决 / 非冲突路径），**不是错误**（R10）。
 * 消费者 `useConflictStages` 负责把 `Err` 映射为 `notConflicted` 正常收敛态。
 */
export function getConflictStages(
  workspace: WorkspaceSession,
  filePath: string,
): Promise<ConflictStages> {
  return invoke<ConflictStages>('get_conflict_stages', { workspace, filePath });
}

/**
 * 应用一处冲突决议（区域级 / 整文件级）—— 写回工作区并 `git add` 清除 unmerged 标记。
 *
 * 成功后该 path 退出 unmerged set；前端由 `git-status-snapshot` 事件驱动
 * `useConflictStages` 重拉 → 读命令 `Err` → `notConflicted` → 回退普通 diff（正常收敛）。
 */
export function resolveConflict(
  workspace: WorkspaceSession,
  filePath: string,
  resolution: ConflictResolution,
): Promise<void> {
  return invoke<void>('resolve_conflict', { workspace, filePath, resolution });
}

export function isGitRepo(projectId: ProjectId): Promise<boolean> {
  return invoke<boolean>('is_git_repo', { projectId });
}

// ─── Commit log / history ────────────────────────────────────────────────────

export function getCommitLog(
  workspace: WorkspaceSession,
  count: number,
  skip?: number | null,
): Promise<CommitEntry[]> {
  return invoke<CommitEntry[]>('get_commit_log', { workspace, count, skip });
}

export function getCommitDetail(
  workspace: WorkspaceSession,
  commitHash: string,
): Promise<CommitDetail> {
  return invoke<CommitDetail>('get_commit_detail', { workspace, commitHash });
}

export function getCommitFiles(
  workspace: WorkspaceSession,
  commitHash: string,
): Promise<CommitFileChange[]> {
  return invoke<CommitFileChange[]>('get_commit_files', { workspace, commitHash });
}

export function getCommitFileDiff(
  workspace: WorkspaceSession,
  commitHash: string,
  filePath: string,
  collapse?: boolean,
): Promise<DiffResult> {
  return invoke<DiffResult>('get_commit_file_diff', {
    workspace,
    commitHash,
    filePath,
    collapse: collapse ?? true,
  });
}

export function getAheadBehind(workspace: WorkspaceSession): Promise<AheadBehind> {
  return invoke<AheadBehind>('get_ahead_behind', { workspace });
}

export function getStashList(workspace: WorkspaceSession): Promise<StashEntry[]> {
  return invoke<StashEntry[]>('get_stash_list', { workspace });
}

export function getStashFiles(
  workspace: WorkspaceSession,
  selector: string,
): Promise<CommitFileChange[]> {
  return invoke<CommitFileChange[]>('get_stash_files', { workspace, selector });
}

export function getStashFileDiff(
  workspace: WorkspaceSession,
  selector: string,
  filePath: string,
  collapse?: boolean,
): Promise<DiffResult> {
  return invoke<DiffResult>('get_stash_file_diff', {
    workspace,
    selector,
    filePath,
    collapse: collapse ?? true,
  });
}

export function stashApply(
  workspace: WorkspaceSession,
  selector: string,
): Promise<StashActionResult> {
  return invoke<StashActionResult>('stash_apply', { workspace, selector });
}

export function stashPop(
  workspace: WorkspaceSession,
  selector: string,
): Promise<StashActionResult> {
  return invoke<StashActionResult>('stash_pop', { workspace, selector });
}

// ─── Default branch ──────────────────────────────────────────────────────────

export function defaultBranch(workspace: WorkspaceSession): Promise<string> {
  return invoke<string>('default_branch', { workspace });
}

// ─── Commit message generation ───────────────────────────────────────────────

export function generateCommitMessage(
  workspace: WorkspaceSession,
  agentId: string,
  filePaths: string[],
): Promise<string> {
  // 命令由后端 `AgentManager` 的生效配置决定（已合并内置覆盖层），
  // 前端不再传覆盖值 —— 那份副本是「设置页改了终端不生效」的根源之一。
  return invoke<string>('generate_commit_message', {
    workspace,
    agentId,
    filePaths,
  });
}

// ─── Remote utilities ────────────────────────────────────────────────────────

export function getRemoteHomeDir(
  host: string,
  port: number,
  username: string,
  auth:
    | { Password: string }
    | { KeyFile: string }
    | { KeyFileWithPassphrase: { key_path: string; passphrase: string } },
): Promise<string> {
  return invoke<string>('get_remote_home_dir', { host, port, username, auth });
}

// ─── PR Commands ─────────────────────────────────────────────────────────────

export function isGhInstalled(): Promise<boolean> {
  return invoke<boolean>('is_gh_installed_command');
}

export function isGhAuthenticated(): Promise<boolean> {
  return invoke<boolean>('is_gh_authenticated_command');
}

export function listPrs(
  workspace: WorkspaceSession,
  state: string,
  limit: number,
): Promise<import('../types').PRListItem[]> {
  console.log('[gitApi] listPrs called with:', { workspace, state, limit });
  return invoke<import('../types').PRListItem[]>('list_prs_command', { workspace, state, limit });
}

export function listRepoLabels(workspace: WorkspaceSession): Promise<import('../types').PrLabel[]> {
  return invoke<import('../types').PrLabel[]>('list_repo_labels_command', { workspace });
}

export function listRepoAuthors(workspace: WorkspaceSession): Promise<string[]> {
  return invoke<string[]>('list_repo_authors_command', { workspace });
}

export function viewPr(
  workspace: WorkspaceSession,
  prNumber: number,
): Promise<import('../types').PRInfo> {
  return invoke<import('../types').PRInfo>('view_pr_command', { workspace, prNumber });
}

export function createPr(
  workspace: WorkspaceSession,
  title: string,
  body: string,
  base?: string | null,
  draft?: boolean,
): Promise<number> {
  return invoke<number>('create_pr_command', { workspace, title, body, base, draft });
}

export function mergePr(
  workspace: WorkspaceSession,
  prNumber: number,
  method: string,
): Promise<import('../types').PRMergeResult> {
  return invoke<import('../types').PRMergeResult>('merge_pr_command', {
    workspace,
    prNumber,
    method,
  });
}

export function closePr(workspace: WorkspaceSession, prNumber: number): Promise<void> {
  return invoke<void>('close_pr_command', { workspace, prNumber });
}

export function listPrFiles(
  workspace: WorkspaceSession,
  prNumber: number,
): Promise<import('../types').PRFileChange[]> {
  return invoke<import('../types').PRFileChange[]>('list_pr_files_command', {
    workspace,
    prNumber,
  });
}

export function listPrCommits(
  workspace: WorkspaceSession,
  prNumber: number,
): Promise<import('../types').PRCommit[]> {
  return invoke<import('../types').PRCommit[]>('list_pr_commits_command', { workspace, prNumber });
}

// ─── PR Comments ─────────────────────────────────────────────────────────────

export interface PRComment {
  id: string;
  author: string;
  authorAvatar?: string;
  body: string;
  createdAt: string;
  updatedAt?: string;
  reactions?: Array<{
    emoji: string;
    count: number;
    userReacted: boolean;
  }>;
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

export function listPrComments(
  workspace: WorkspaceSession,
  prNumber: number,
): Promise<PRComment[]> {
  return invoke<PRComment[]>('list_pr_comments_command', { workspace, prNumber });
}

export function addPrComment(
  workspace: WorkspaceSession,
  prNumber: number,
  body: string,
): Promise<PRComment> {
  return invoke<PRComment>('add_pr_comment_command', { workspace, prNumber, body });
}

export function editPrComment(
  workspace: WorkspaceSession,
  prNumber: number,
  commentId: string,
  body: string,
): Promise<PRComment> {
  return invoke<PRComment>('edit_pr_comment_command', { workspace, prNumber, commentId, body });
}

export function deletePrComment(
  workspace: WorkspaceSession,
  prNumber: number,
  commentId: string,
): Promise<void> {
  return invoke<void>('delete_pr_comment_command', { workspace, prNumber, commentId });
}

export function addCommentReaction(
  workspace: WorkspaceSession,
  prNumber: number,
  commentId: string,
  emoji: string,
): Promise<void> {
  return invoke<void>('add_comment_reaction_command', { workspace, prNumber, commentId, emoji });
}

export function addPrReviewComment(
  workspace: WorkspaceSession,
  prNumber: number,
  body: string,
  filePath: string,
  line: number,
  side: string,
): Promise<PRReviewComment> {
  return invoke<PRReviewComment>('add_pr_review_comment_command', {
    workspace,
    prNumber,
    body,
    filePath,
    line,
    side,
  });
}

export function listPrReviewComments(
  workspace: WorkspaceSession,
  prNumber: number,
): Promise<PRReviewComment[]> {
  const t0 = performance.now();
  return invoke<PRReviewComment[]>('list_pr_review_comments_command', {
    workspace,
    prNumber,
  }).then((r) => {
    console.debug(
      '[perf] invoke list_pr_review_comments:',
      prNumber,
      `${(performance.now() - t0).toFixed(0)}ms`,
      'count:',
      r.length,
    );
    return r;
  });
}
