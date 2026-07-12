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
} from '@/shared/types';

// The transport types used by git commands
export interface LocalTransport {
  Local: { project_path: string };
}

export interface WslTransport {
  Wsl: { distro: string; project_path: string };
}

export interface RemoteTransport {
  Remote: {
    host: string;
    port: number;
    username: string;
    auth:
      | { Password: string }
      | { KeyFile: string }
      | { KeyFileWithPassphrase: { key_path: string; passphrase: string } };
    project_path: string;
  };
}

export interface FileTransportLocal {
  Local: { project_path: string };
}

export interface FileTransportWsl {
  Wsl: { distro: string; project_path: string };
}

export interface FileTransportRemote {
  Remote: {
    host: string;
    port: number;
    username: string;
    auth:
      | { Password: string }
      | { KeyFile: string }
      | { KeyFileWithPassphrase: { key_path: string; passphrase: string } };
    project_path: string;
  };
}

export type GitTransportKind = LocalTransport | WslTransport | RemoteTransport;
export type FileTransportKind = FileTransportLocal | FileTransportWsl | FileTransportRemote;

// ─── Staging ─────────────────────────────────────────────────────────────────

export function stageFiles(transport: GitTransportKind, filePaths: string[]): Promise<void> {
  return invoke<void>('stage_files', { transport, filePaths });
}

export function unstageFiles(transport: GitTransportKind, filePaths: string[]): Promise<void> {
  return invoke<void>('unstage_files', { transport, filePaths });
}

export function stageAll(transport: GitTransportKind): Promise<void> {
  return invoke<void>('stage_all', { transport });
}

export function unstageAll(transport: GitTransportKind): Promise<void> {
  return invoke<void>('unstage_all', { transport });
}

export function discardFile(transport: GitTransportKind, filePath: string): Promise<void> {
  return invoke<void>('discard_file', { transport, filePath });
}

export function discardAll(transport: GitTransportKind): Promise<void> {
  return invoke<void>('discard_all', { transport });
}

// ─── Remote operations ───────────────────────────────────────────────────────

export function fetch(transport: GitTransportKind): Promise<void> {
  return invoke<void>('fetch', { transport });
}

export function pull(transport: GitTransportKind): Promise<void> {
  return invoke<void>('pull', { transport });
}

export function push(transport: GitTransportKind, setUpstream?: boolean): Promise<void> {
  return invoke<void>('push', { transport, setUpstream });
}

export function commitFiles(
  transport: GitTransportKind,
  filePaths: string[],
  message: string,
): Promise<CommitResult> {
  return invoke<CommitResult>('commit_files', { transport, filePaths, message });
}

// ─── Cherry-pick / Revert / Tag ──────────────────────────────────────────────

export function cherryPick(transport: GitTransportKind, commitHash: string): Promise<void> {
  return invoke<void>('cherry_pick', { transport, commitHash });
}

export function revert(transport: GitTransportKind, commitHash: string): Promise<void> {
  return invoke<void>('revert', { transport, commitHash });
}

export function createTag(
  transport: GitTransportKind,
  name: string,
  message: string,
): Promise<void> {
  return invoke<void>('create_tag', { transport, name, message });
}

// ─── Branching ───────────────────────────────────────────────────────────────

export function checkoutBranch(transport: GitTransportKind, branchName: string): Promise<void> {
  return invoke<void>('checkout_branch', { transport, branchName });
}

export function createBranch(
  transport: GitTransportKind,
  branchName: string,
  startPoint?: string | null,
): Promise<void> {
  return invoke<void>('create_branch', { transport, branchName, startPoint });
}

export function deleteBranch(
  transport: GitTransportKind,
  branchName: string,
  force?: boolean,
): Promise<void> {
  return invoke<void>('delete_branch', { transport, branchName, force });
}

export function renameBranch(
  transport: GitTransportKind,
  oldName: string,
  newName: string,
): Promise<void> {
  return invoke<void>('rename_branch', { transport, oldName, newName });
}

export function createAndSwitchBranch(
  transport: GitTransportKind,
  branchName: string,
): Promise<void> {
  return invoke<void>('create_and_switch_branch', { transport, branchName });
}

export function checkoutDetached(transport: GitTransportKind, commitHash: string): Promise<void> {
  return invoke<void>('checkout_detached', { transport, commitHash });
}

// ─── Worktree ────────────────────────────────────────────────────────────────

export function createWorktree(
  transport: GitTransportKind,
  worktreePath: string,
  branchName: string,
  newBranch: boolean,
): Promise<void> {
  return invoke<void>('create_worktree', { transport, worktreePath, branchName, newBranch });
}

export function removeWorktree(transport: GitTransportKind, worktreePath: string): Promise<void> {
  return invoke<void>('remove_worktree', { transport, worktreePath });
}

export function renameWorktree(
  transport: GitTransportKind,
  oldPath: string,
  newPath: string,
): Promise<void> {
  return invoke<void>('rename_worktree', { transport, oldPath, newPath });
}

export function isWorktreeDirty(
  transport: GitTransportKind,
  worktreePath: string,
): Promise<boolean> {
  return invoke<boolean>('is_worktree_dirty', { transport, worktreePath });
}

// ─── Info / Read operations ──────────────────────────────────────────────────

export function getGitInfo(transport: GitTransportKind): Promise<GitInfo> {
  return invoke<GitInfo>('get_git_info', { transport });
}

export function getGitBranchInfo(transport: GitTransportKind): Promise<GitBranchInfo> {
  return invoke<GitBranchInfo>('get_git_branch_info', { transport });
}

export function getWorktreeChangedFiles(
  transport: GitTransportKind,
  worktreePath: string,
): Promise<FileChange[]> {
  return invoke<FileChange[]>('get_worktree_changed_files', { transport, worktreePath });
}

export function getChangedFilesDiffStats(transport: GitTransportKind): Promise<FileDiffStats[]> {
  return invoke<FileDiffStats[]>('get_changed_files_diff_stats', { transport });
}

export function getFileDiff(transport: GitTransportKind, filePath: string): Promise<DiffResult> {
  const t0 = performance.now();
  return invoke<DiffResult>('get_file_diff', { transport, filePath }).then((r) => {
    console.debug('[perf] invoke get_file_diff:', filePath, `${(performance.now() - t0).toFixed(0)}ms`);
    return r;
  });
}

export function isGitRepo(transport: GitTransportKind): Promise<boolean> {
  return invoke<boolean>('is_git_repo', { transport });
}

// ─── Commit log / history ────────────────────────────────────────────────────

export function getCommitLog(
  transport: GitTransportKind,
  count: number,
  skip?: number | null,
): Promise<CommitEntry[]> {
  return invoke<CommitEntry[]>('get_commit_log', { transport, count, skip });
}

export function getCommitDetail(
  transport: GitTransportKind,
  commitHash: string,
): Promise<CommitDetail> {
  return invoke<CommitDetail>('get_commit_detail', { transport, commitHash });
}

export function getCommitFiles(
  transport: GitTransportKind,
  commitHash: string,
): Promise<CommitFileChange[]> {
  return invoke<CommitFileChange[]>('get_commit_files', { transport, commitHash });
}

export function getCommitFileDiff(
  transport: GitTransportKind,
  commitHash: string,
  filePath: string,
): Promise<DiffResult> {
  return invoke<DiffResult>('get_commit_file_diff', { transport, commitHash, filePath });
}

export function getAheadBehind(transport: GitTransportKind): Promise<AheadBehind> {
  return invoke<AheadBehind>('get_ahead_behind', { transport });
}

// ─── Default branch ──────────────────────────────────────────────────────────

export function defaultBranch(transport: GitTransportKind): Promise<string> {
  return invoke<string>('default_branch', { transport });
}

// ─── File operations ─────────────────────────────────────────────────────────

export function readDirTree(
  transport: FileTransportKind,
  rootPath?: string | null,
  subPath?: string | null,
  maxDepth?: number | null,
): Promise<FileNode[]> {
  return invoke<FileNode[]>('read_dir_tree', { transport, rootPath, subPath, maxDepth });
}

export function readFileContent(
  transport: FileTransportKind,
  filePath: string,
  rootPath?: string | null,
): Promise<FileContent> {
  return invoke<FileContent>('read_file_content', { transport, filePath, rootPath });
}

export function writeFileContent(
  transport: FileTransportKind,
  filePath: string,
  content: string,
  rootPath?: string | null,
): Promise<void> {
  return invoke<void>('write_file_content', { transport, filePath, content, rootPath });
}

// ─── Commit message generation ───────────────────────────────────────────────

export function generateCommitMessage(
  transport: FileTransportKind,
  agentId: string,
  agentCommandOverride: string | null,
  filePaths: string[],
): Promise<string> {
  return invoke<string>('generate_commit_message', {
    transport,
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
