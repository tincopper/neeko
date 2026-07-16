import { invoke } from "@tauri-apps/api/core";
import type { ProjectCommands } from '@/shared/types/activeProject';
import type {
  GitInfo,
  AheadBehind,
  CommitEntry,
  CommitDetail,
  CommitFileChange,
  CommitResult,
  DiffResult,
  PushOutcome,
} from '@/shared/types/git';
import type { FileNode, FileContent } from '@/shared/types/file';

export function createProjectCommands(projectId: string): ProjectCommands {
  return {
    refreshGitInfo(): Promise<GitInfo> {
      return invoke<GitInfo>("get_git_info", { projectId });
    },
    getAheadBehind(): Promise<AheadBehind> {
      return invoke<AheadBehind>("get_ahead_behind", { projectId });
    },
    getChangedFilesDiffStats(): Promise<Array<{ path: string; additions: number; deletions: number }>> {
      return invoke<Array<{ path: string; additions: number; deletions: number }>>("get_changed_files_diff_stats", { projectId });
    },
    getFileDiff(filePath: string): Promise<DiffResult> {
      return invoke<DiffResult>("get_file_diff", { projectId, filePath });
    },

    stageFiles(filePaths: string[]): Promise<void> {
      return invoke<void>("stage_files", { projectId, filePaths });
    },
    unstageFiles(filePaths: string[]): Promise<void> {
      return invoke<void>("unstage_files", { projectId, filePaths });
    },
    discardFile(filePath: string): Promise<void> {
      return invoke<void>("discard_file", { projectId, filePath });
    },

    commitFiles(filePaths: string[], message: string): Promise<CommitResult> {
      return invoke<CommitResult>("commit_files", { projectId, filePaths, message });
    },

    fetch(): Promise<PushOutcome> {
      return invoke<PushOutcome>("fetch", { projectId });
    },
    pull(): Promise<PushOutcome> {
      return invoke<PushOutcome>("pull", { projectId });
    },
    push(setUpstream?: boolean): Promise<PushOutcome> {
      return invoke<PushOutcome>("push", { projectId, setUpstream: setUpstream ?? false });
    },
    fetchWithCredentials(username: string, password: string): Promise<PushOutcome> {
      return invoke<PushOutcome>("fetch_with_credentials", { projectId, username, password });
    },
    pullWithCredentials(username: string, password: string): Promise<PushOutcome> {
      return invoke<PushOutcome>("pull_with_credentials", { projectId, username, password });
    },
    pushWithCredentials(setUpstream: boolean, username: string, password: string): Promise<PushOutcome> {
      return invoke<PushOutcome>("push_with_credentials", { projectId, setUpstream, username, password });
    },

    checkoutBranch(branchName: string): Promise<void> {
      return invoke<void>("checkout_branch", { projectId, branchName });
    },
    createBranch(branchName: string, startPoint?: string): Promise<void> {
      return invoke<void>("create_branch", { projectId, branchName, startPoint });
    },
    deleteBranch(branchName: string): Promise<void> {
      return invoke<void>("delete_branch", { projectId, branchName });
    },

    getCommitLog(count: number, skip?: number): Promise<CommitEntry[]> {
      return invoke<CommitEntry[]>("get_commit_log", { projectId, count, skip });
    },
    getCommitDetail(commitHash: string): Promise<CommitDetail> {
      return invoke<CommitDetail>("get_commit_detail", { projectId, commitHash });
    },
    getCommitFiles(commitHash: string): Promise<CommitFileChange[]> {
      return invoke<CommitFileChange[]>("get_commit_files", { projectId, commitHash });
    },
    getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult> {
      return invoke<DiffResult>("get_commit_file_diff", { projectId, commitHash, filePath });
    },

    cherryPick(commitHash: string): Promise<void> {
      return invoke<void>("cherry_pick", { projectId, commitHash });
    },
    revert(commitHash: string): Promise<void> {
      return invoke<void>("revert", { projectId, commitHash });
    },
    createTag(tagName: string, message?: string): Promise<void> {
      return invoke<void>("create_tag", { projectId, tagName, message });
    },

    readDirTree(rootPath?: string, subPath?: string, maxDepth?: number): Promise<FileNode[]> {
      return invoke<FileNode[]>("read_dir_tree", {
        projectId,
        rootPath: rootPath ?? null,
        subPath: subPath ?? null,
        maxDepth: maxDepth ?? 4,
      });
    },
    readFileContent(filePath: string, rootPath?: string): Promise<FileContent> {
      return invoke<FileContent>("read_file_content", {
        projectId,
        filePath,
        rootPath,
      });
    },
    writeFileContent(filePath: string, content: string, rootPath?: string): Promise<void> {
      return invoke<void>("write_file_content", {
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
      return invoke<string>("generate_commit_message", {
        projectId,
        agentId,
        agentCommandOverride: agentCommandOverride ?? null,
        filePaths,
      });
    },
  };
}
