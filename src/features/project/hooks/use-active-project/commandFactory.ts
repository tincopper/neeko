// eslint-disable-next-line no-restricted-imports -- invoke is the foundational IPC primitive for project commands
import { invoke } from '@tauri-apps/api/core';

import type { ProjectCommands } from '@/shared/types/activeProject';
import { DEFAULT_TREE_DEPTH, type FileNode, type FileContent } from '@/shared/types/file';
import type {
  GitInfo,
  AheadBehind,
  CommitEntry,
  CommitDetail,
  CommitFileChange,
  CommitResult,
  DiffResult,
  PushOutcome,
  StashActionResult,
  StashEntry,
} from '@/shared/types/git';

export function createProjectCommands(
  projectId: string,
  worktreePath?: string | null,
): ProjectCommands {
  return {
    refreshGitInfo(): Promise<GitInfo> {
      return invoke<GitInfo>('get_git_info', { projectId, worktreePath });
    },
    getAheadBehind(): Promise<AheadBehind> {
      return invoke<AheadBehind>('get_ahead_behind', { projectId, worktreePath });
    },
    getChangedFilesDiffStats(): Promise<
      Array<{ path: string; additions: number; deletions: number }>
    > {
      return invoke<Array<{ path: string; additions: number; deletions: number }>>(
        'get_changed_files_diff_stats',
        { projectId, worktreePath },
      );
    },
    getFileDiff(filePath: string, collapse?: boolean): Promise<DiffResult> {
      return invoke<DiffResult>('get_file_diff', {
        projectId,
        filePath,
        worktreePath,
        collapse: collapse ?? true,
      });
    },

    stageFiles(filePaths: string[]): Promise<void> {
      return invoke<void>('stage_files', { projectId, filePaths, worktreePath });
    },
    unstageFiles(filePaths: string[]): Promise<void> {
      return invoke<void>('unstage_files', { projectId, filePaths, worktreePath });
    },
    discardFile(filePath: string): Promise<void> {
      return invoke<void>('discard_file', { projectId, filePath, worktreePath });
    },
    discardAll(): Promise<void> {
      return invoke<void>('discard_all', { projectId, worktreePath });
    },

    commitFiles(filePaths: string[], message: string): Promise<CommitResult> {
      return invoke<CommitResult>('commit_files', { projectId, filePaths, message, worktreePath });
    },

    fetch(): Promise<PushOutcome> {
      return invoke<PushOutcome>('fetch', { projectId, worktreePath });
    },
    pull(): Promise<PushOutcome> {
      return invoke<PushOutcome>('pull', { projectId, worktreePath });
    },
    push(setUpstream?: boolean): Promise<PushOutcome> {
      return invoke<PushOutcome>('push', {
        projectId,
        setUpstream: setUpstream ?? false,
        worktreePath,
      });
    },
    fetchWithCredentials(username: string, password: string): Promise<PushOutcome> {
      return invoke<PushOutcome>('fetch_with_credentials', {
        projectId,
        username,
        password,
        worktreePath,
      });
    },
    pullWithCredentials(username: string, password: string): Promise<PushOutcome> {
      return invoke<PushOutcome>('pull_with_credentials', {
        projectId,
        username,
        password,
        worktreePath,
      });
    },
    pushWithCredentials(
      setUpstream: boolean,
      username: string,
      password: string,
    ): Promise<PushOutcome> {
      return invoke<PushOutcome>('push_with_credentials', {
        projectId,
        setUpstream,
        username,
        password,
        worktreePath,
      });
    },

    checkoutBranch(branchName: string): Promise<void> {
      return invoke<void>('checkout_branch', { projectId, branchName });
    },
    createBranch(branchName: string, startPoint?: string): Promise<void> {
      return invoke<void>('create_branch', { projectId, branchName, startPoint });
    },
    deleteBranch(branchName: string): Promise<void> {
      return invoke<void>('delete_branch', { projectId, branchName });
    },

    getCommitLog(count: number, skip?: number): Promise<CommitEntry[]> {
      return invoke<CommitEntry[]>('get_commit_log', { projectId, count, skip });
    },
    getCommitDetail(commitHash: string): Promise<CommitDetail> {
      return invoke<CommitDetail>('get_commit_detail', { projectId, commitHash });
    },
    getCommitFiles(commitHash: string): Promise<CommitFileChange[]> {
      return invoke<CommitFileChange[]>('get_commit_files', { projectId, commitHash });
    },
    getStashList(): Promise<StashEntry[]> {
      return invoke<StashEntry[]>('get_stash_list', { projectId, worktreePath });
    },
    getStashFiles(selector: string): Promise<CommitFileChange[]> {
      return invoke<CommitFileChange[]>('get_stash_files', { projectId, selector, worktreePath });
    },
    getStashFileDiff(selector: string, filePath: string, collapse?: boolean): Promise<DiffResult> {
      return invoke<DiffResult>('get_stash_file_diff', {
        projectId,
        selector,
        filePath,
        collapse: collapse ?? true,
        worktreePath,
      });
    },
    stashApply(selector: string): Promise<StashActionResult> {
      return invoke<StashActionResult>('stash_apply', { projectId, selector, worktreePath });
    },
    stashPop(selector: string): Promise<StashActionResult> {
      return invoke<StashActionResult>('stash_pop', { projectId, selector, worktreePath });
    },
    getCommitFileDiff(
      commitHash: string,
      filePath: string,
      collapse?: boolean,
    ): Promise<DiffResult> {
      return invoke<DiffResult>('get_commit_file_diff', {
        projectId,
        commitHash,
        filePath,
        collapse: collapse ?? true,
      });
    },

    cherryPick(commitHash: string): Promise<void> {
      return invoke<void>('cherry_pick', { projectId, commitHash });
    },
    revert(commitHash: string): Promise<void> {
      return invoke<void>('revert', { projectId, commitHash });
    },
    createTag(tagName: string, message?: string): Promise<void> {
      return invoke<void>('create_tag', { projectId, tagName, message });
    },

    readDirTree(
      rootPath?: string,
      subPath?: string,
      maxDepth?: number,
      ignoredFiles?: string[],
    ): Promise<FileNode[]> {
      return invoke<FileNode[]>('read_dir_tree', {
        projectId,
        rootPath: rootPath ?? null,
        subPath: subPath ?? null,
        maxDepth: maxDepth ?? DEFAULT_TREE_DEPTH,
        ignored: ignoredFiles ?? null,
      });
    },
    readFileContent(filePath: string, rootPath?: string): Promise<FileContent> {
      return invoke<FileContent>('read_file_content', {
        projectId,
        filePath,
        rootPath,
      });
    },
    writeFileContent(filePath: string, content: string, rootPath?: string): Promise<void> {
      return invoke<void>('write_file_content', {
        projectId,
        filePath,
        content,
        rootPath,
      });
    },

    generateCommitMessage(
      agentId: string,
      filePaths: string[],
      agentCommandOverride?: string | null,
    ): Promise<string> {
      return invoke<string>('generate_commit_message', {
        projectId,
        agentId,
        agentCommandOverride: agentCommandOverride ?? null,
        filePaths,
        worktreePath,
      });
    },
  };
}
