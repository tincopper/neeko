import { invoke } from '@tauri-apps/api/core';

import type { FileNode, FileContent } from '../../file/types';
import type {
  GitInfo,
  GitBranchInfo,
  FileChange,
  FileDiffStats,
  DiffResult,
  CommitEntry,
  CommitDetail,
  CommitFileChange,
  CommitResult,
  AheadBehind,
  PushOutcome,
} from '../types';
export type { PushOutcome };

// ─── Staging ─────────────────────────────────────────────────────────────────

export function stageFiles(projectId: string, filePaths: string[]): Promise<void> {
  return invoke<void>('stage_files', { projectId, filePaths });
}

export function unstageFiles(projectId: string, filePaths: string[]): Promise<void> {
  return invoke<void>('unstage_files', { projectId, filePaths });
}

export function stageAll(projectId: string): Promise<void> {
  return invoke<void>('stage_all', { projectId });
}

export function unstageAll(projectId: string): Promise<void> {
  return invoke<void>('unstage_all', { projectId });
}

export function discardFile(projectId: string, filePath: string): Promise<void> {
  return invoke<void>('discard_file', { projectId, filePath });
}

export function discardAll(projectId: string): Promise<void> {
  return invoke<void>('discard_all', { projectId });
}

// ─── Remote operations ───────────────────────────────────────────────────────

export function fetch(projectId: string): Promise<PushOutcome> {
  return invoke<PushOutcome>('fetch', { projectId });
}

export function pull(projectId: string): Promise<PushOutcome> {
  return invoke<PushOutcome>('pull', { projectId });
}

export function push(projectId: string, setUpstream?: boolean): Promise<PushOutcome> {
  return invoke<PushOutcome>('push', { projectId, setUpstream });
}

export function fetchWithCredentials(
  projectId: string,
  username: string,
  password: string,
): Promise<PushOutcome> {
  return invoke<PushOutcome>('fetch_with_credentials', { projectId, username, password });
}

export function pullWithCredentials(
  projectId: string,
  username: string,
  password: string,
): Promise<PushOutcome> {
  return invoke<PushOutcome>('pull_with_credentials', { projectId, username, password });
}

export function pushWithCredentials(
  projectId: string,
  setUpstream: boolean,
  username: string,
  password: string,
): Promise<PushOutcome> {
  return invoke<PushOutcome>('push_with_credentials', { projectId, setUpstream, username, password });
}

export function commitFiles(
  projectId: string,
  filePaths: string[],
  message: string,
): Promise<CommitResult> {
  return invoke<CommitResult>('commit_files', { projectId, filePaths, message });
}

// ─── Cherry-pick / Revert / Tag ──────────────────────────────────────────────

export function cherryPick(projectId: string, commitHash: string): Promise<void> {
  return invoke<void>('cherry_pick', { projectId, commitHash });
}

export function revert(projectId: string, commitHash: string): Promise<void> {
  return invoke<void>('revert', { projectId, commitHash });
}

export function createTag(
  projectId: string,
  name: string,
  message: string,
): Promise<void> {
  return invoke<void>('create_tag', { projectId, name, message });
}

// ─── Branching ───────────────────────────────────────────────────────────────

export function checkoutBranch(projectId: string, branchName: string): Promise<void> {
  return invoke<void>('checkout_branch', { projectId, branchName });
}

export function createBranch(
  projectId: string,
  branchName: string,
  startPoint?: string | null,
): Promise<void> {
  return invoke<void>('create_branch', { projectId, branchName, startPoint });
}

export function deleteBranch(
  projectId: string,
  branchName: string,
  force?: boolean,
): Promise<void> {
  return invoke<void>('delete_branch', { projectId, branchName, force });
}

export function renameBranch(
  projectId: string,
  oldName: string,
  newName: string,
): Promise<void> {
  return invoke<void>('rename_branch', { projectId, oldName, newName });
}

export function createAndSwitchBranch(
  projectId: string,
  branchName: string,
): Promise<void> {
  return invoke<void>('create_and_switch_branch', { projectId, branchName });
}

export function checkoutDetached(projectId: string, commitHash: string): Promise<void> {
  return invoke<void>('checkout_detached', { projectId, commitHash });
}

// ─── Worktree ────────────────────────────────────────────────────────────────

export function createWorktree(
  projectId: string,
  worktreePath: string,
  branchName: string,
  newBranch: boolean,
): Promise<void> {
  return invoke<void>('create_worktree', { projectId, worktreePath, branchName, newBranch });
}

export function removeWorktree(projectId: string, worktreePath: string): Promise<void> {
  return invoke<void>('remove_worktree', { projectId, worktreePath });
}

export function renameWorktree(
  projectId: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  return invoke<void>('rename_worktree', { projectId, oldPath, newPath });
}

export function isWorktreeDirty(
  projectId: string,
  worktreePath: string,
): Promise<boolean> {
  return invoke<boolean>('is_worktree_dirty', { projectId, worktreePath });
}

// ─── Info / Read operations ──────────────────────────────────────────────────

export function getGitInfo(projectId: string): Promise<GitInfo> {
  return invoke<GitInfo>('get_git_info', { projectId });
}

export function getGitBranchInfo(projectId: string): Promise<GitBranchInfo> {
  return invoke<GitBranchInfo>('get_git_branch_info', { projectId });
}

export function getWorktreeChangedFiles(
  projectId: string,
  worktreePath: string,
): Promise<FileChange[]> {
  return invoke<FileChange[]>('get_worktree_changed_files', { projectId, worktreePath });
}

export function getChangedFilesDiffStats(projectId: string): Promise<FileDiffStats[]> {
  return invoke<FileDiffStats[]>('get_changed_files_diff_stats', { projectId });
}

export function getFileDiff(projectId: string, filePath: string): Promise<DiffResult> {
  const t0 = performance.now();
  return invoke<DiffResult>('get_file_diff', { projectId, filePath }).then((r) => {
    console.debug('[perf] invoke get_file_diff:', filePath, `${(performance.now() - t0).toFixed(0)}ms`);
    return r;
  });
}

export function isGitRepo(projectId: string): Promise<boolean> {
  return invoke<boolean>('is_git_repo', { projectId });
}

// ─── Commit log / history ────────────────────────────────────────────────────

export function getCommitLog(
  projectId: string,
  count: number,
  skip?: number | null,
): Promise<CommitEntry[]> {
  return invoke<CommitEntry[]>('get_commit_log', { projectId, count, skip });
}

export function getCommitDetail(
  projectId: string,
  commitHash: string,
): Promise<CommitDetail> {
  return invoke<CommitDetail>('get_commit_detail', { projectId, commitHash });
}

export function getCommitFiles(
  projectId: string,
  commitHash: string,
): Promise<CommitFileChange[]> {
  return invoke<CommitFileChange[]>('get_commit_files', { projectId, commitHash });
}

export function getCommitFileDiff(
  projectId: string,
  commitHash: string,
  filePath: string,
): Promise<DiffResult> {
  return invoke<DiffResult>('get_commit_file_diff', { projectId, commitHash, filePath });
}

export function getAheadBehind(projectId: string): Promise<AheadBehind> {
  return invoke<AheadBehind>('get_ahead_behind', { projectId });
}

// ─── Default branch ──────────────────────────────────────────────────────────

export function defaultBranch(projectId: string): Promise<string> {
  return invoke<string>('default_branch', { projectId });
}

// ─── File operations ─────────────────────────────────────────────────────────

export function readDirTree(
  projectId: string,
  rootPath?: string | null,
  subPath?: string | null,
  maxDepth?: number | null,
): Promise<FileNode[]> {
  return invoke<FileNode[]>('read_dir_tree', { projectId, rootPath, subPath, maxDepth });
}

export function readFileContent(
  projectId: string,
  filePath: string,
  rootPath?: string | null,
): Promise<FileContent> {
  return invoke<FileContent>('read_file_content', { projectId, filePath, rootPath });
}

export function writeFileContent(
  projectId: string,
  filePath: string,
  content: string,
  rootPath?: string | null,
): Promise<void> {
  return invoke<void>('write_file_content', { projectId, filePath, content, rootPath });
}

// ─── Commit message generation ───────────────────────────────────────────────

export function generateCommitMessage(
  projectId: string,
  agentId: string,
  agentCommandOverride: string | null,
  filePaths: string[],
): Promise<string> {
  return invoke<string>('generate_commit_message', {
    projectId,
    agentId,
    agentCommandOverride,
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
  projectId: string,
  state: string,
  limit: number,
): Promise<import('../types').PRListItem[]> {
  console.log('[gitApi] listPrs called with:', { projectId, state, limit });
  return invoke<import('../types').PRListItem[]>('list_prs_command', { projectId, state, limit });
}

export function listRepoLabels(
  projectId: string,
): Promise<import('../types').PrLabel[]> {
  return invoke<import('../types').PrLabel[]>('list_repo_labels_command', { projectId });
}

export function listRepoAuthors(
  projectId: string,
): Promise<string[]> {
  return invoke<string[]>('list_repo_authors_command', { projectId });
}

export function viewPr(projectId: string, prNumber: number): Promise<import('../types').PRInfo> {
  return invoke<import('../types').PRInfo>('view_pr_command', { projectId, prNumber });
}

export function createPr(
  projectId: string,
  title: string,
  body: string,
  base?: string | null,
  draft?: boolean,
): Promise<number> {
  return invoke<number>('create_pr_command', { projectId, title, body, base, draft });
}

export function mergePr(
  projectId: string,
  prNumber: number,
  method: string,
): Promise<import('../types').PRMergeResult> {
  return invoke<import('../types').PRMergeResult>('merge_pr_command', {
    projectId,
    prNumber,
    method,
  });
}

export function closePr(projectId: string, prNumber: number): Promise<void> {
  return invoke<void>('close_pr_command', { projectId, prNumber });
}

export function listPrFiles(
  projectId: string,
  prNumber: number,
): Promise<import('../types').PRFileChange[]> {
  return invoke<import('../types').PRFileChange[]>('list_pr_files_command', { projectId, prNumber });
}

export function listPrCommits(
  projectId: string,
  prNumber: number,
): Promise<import('../types').PRCommit[]> {
  return invoke<import('../types').PRCommit[]>('list_pr_commits_command', { projectId, prNumber });
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
  projectId: string,
  prNumber: number,
): Promise<PRComment[]> {
  return invoke<PRComment[]>('list_pr_comments_command', { projectId, prNumber });
}

export function addPrComment(
  projectId: string,
  prNumber: number,
  body: string,
): Promise<PRComment> {
  return invoke<PRComment>('add_pr_comment_command', { projectId, prNumber, body });
}

export function editPrComment(
  projectId: string,
  prNumber: number,
  commentId: string,
  body: string,
): Promise<PRComment> {
  return invoke<PRComment>('edit_pr_comment_command', { projectId, prNumber, commentId, body });
}

export function deletePrComment(
  projectId: string,
  prNumber: number,
  commentId: string,
): Promise<void> {
  return invoke<void>('delete_pr_comment_command', { projectId, prNumber, commentId });
}

export function addCommentReaction(
  projectId: string,
  prNumber: number,
  commentId: string,
  emoji: string,
): Promise<void> {
  return invoke<void>('add_comment_reaction_command', { projectId, prNumber, commentId, emoji });
}

export function addPrReviewComment(
  projectId: string,
  prNumber: number,
  body: string,
  filePath: string,
  line: number,
  side: string,
): Promise<PRReviewComment> {
  return invoke<PRReviewComment>('add_pr_review_comment_command', {
    projectId, prNumber, body, filePath, line, side,
  });
}

export function listPrReviewComments(
  projectId: string,
  prNumber: number,
): Promise<PRReviewComment[]> {
  const t0 = performance.now();
  return invoke<PRReviewComment[]>('list_pr_review_comments_command', {
    projectId, prNumber,
  }).then((r) => {
    console.debug('[perf] invoke list_pr_review_comments:', prNumber, `${(performance.now() - t0).toFixed(0)}ms`, 'count:', r.length);
    return r;
  });
}
