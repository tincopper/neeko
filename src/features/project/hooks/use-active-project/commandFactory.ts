import { invoke } from "@tauri-apps/api/core";
import type { AuthMethod } from '@/shared/types/connection';
import type { ProjectCommands } from '@/shared/types/activeProject';
import type {
  GitInfo,
  AheadBehind,
  CommitEntry,
  CommitDetail,
  CommitFileChange,
  CommitResult,
  DiffResult,
} from '@/shared/types/git';
import type { FileNode, FileContent } from '@/shared/types/file';

export type GitTransportKind =
  | { type: "Local"; projectId: string; projectPath: string }
  | { type: "Wsl"; distro: string; projectPath: string }
  | { type: "Remote"; host: string; port: number; username: string; auth: AuthMethod; projectPath: string };

function transportArg(t: GitTransportKind): Record<string, unknown> {
  switch (t.type) {
    case "Local":
      return { transport: { Local: { project_path: t.projectPath } } };
    case "Wsl":
      return { transport: { Wsl: { distro: t.distro, project_path: t.projectPath } } };
    case "Remote":
      return {
        transport: {
          Remote: {
            host: t.host,
            port: t.port,
            username: t.username,
            auth: t.auth as AuthMethod,
            project_path: t.projectPath,
          },
        },
      };
  }
}

function fileTransportArg(t: GitTransportKind): Record<string, unknown> {
  switch (t.type) {
    case "Local":
      return { transport: { Local: { project_path: t.projectPath } } };
    case "Wsl":
      return { transport: { Wsl: { distro: t.distro, project_path: t.projectPath } } };
    case "Remote":
      return {
        transport: {
          Remote: {
            host: t.host,
            port: t.port,
            username: t.username,
            auth: t.auth as AuthMethod,
            project_path: t.projectPath,
          },
        },
      };
  }
}

export function createProjectCommands(transport: GitTransportKind): ProjectCommands {
  const tp = () => transportArg(transport);

  return {
    refreshGitInfo(): Promise<GitInfo> {
      return invoke<GitInfo>("get_git_info", tp());
    },
    getAheadBehind(): Promise<AheadBehind> {
      return invoke<AheadBehind>("get_ahead_behind", tp());
    },
    getChangedFilesDiffStats(): Promise<Array<{ path: string; additions: number; deletions: number }>> {
      return invoke<Array<{ path: string; additions: number; deletions: number }>>("get_changed_files_diff_stats", tp());
    },
    getFileDiff(filePath: string): Promise<DiffResult> {
      return invoke<DiffResult>("get_file_diff", { ...tp(), filePath });
    },

    stageFiles(filePaths: string[]): Promise<void> {
      return invoke<void>("stage_files", { ...tp(), filePaths });
    },
    unstageFiles(filePaths: string[]): Promise<void> {
      return invoke<void>("unstage_files", { ...tp(), filePaths });
    },
    discardFile(filePath: string): Promise<void> {
      return invoke<void>("discard_file", { ...tp(), filePath });
    },

    commitFiles(filePaths: string[], message: string): Promise<CommitResult> {
      return invoke<CommitResult>("commit_files", { ...tp(), filePaths, message });
    },

    fetch(): Promise<void> {
      return invoke<void>("fetch", tp());
    },
    pull(): Promise<void> {
      return invoke<void>("pull", tp());
    },
    push(setUpstream?: boolean): Promise<void> {
      return invoke<void>("push", { ...tp(), setUpstream: setUpstream ?? false });
    },

    checkoutBranch(branchName: string): Promise<void> {
      return invoke<void>("checkout_branch", { ...tp(), branchName });
    },
    createBranch(branchName: string, startPoint?: string): Promise<void> {
      return invoke<void>("create_branch", { ...tp(), branchName, startPoint });
    },
    deleteBranch(branchName: string): Promise<void> {
      return invoke<void>("delete_branch", { ...tp(), branchName });
    },

    getCommitLog(count: number, skip?: number): Promise<CommitEntry[]> {
      return invoke<CommitEntry[]>("get_commit_log", { ...tp(), count, skip });
    },
    getCommitDetail(commitHash: string): Promise<CommitDetail> {
      return invoke<CommitDetail>("get_commit_detail", { ...tp(), commitHash });
    },
    getCommitFiles(commitHash: string): Promise<CommitFileChange[]> {
      return invoke<CommitFileChange[]>("get_commit_files", { ...tp(), commitHash });
    },
    getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult> {
      return invoke<DiffResult>("get_commit_file_diff", { ...tp(), commitHash, filePath });
    },

    cherryPick(commitHash: string): Promise<void> {
      return invoke<void>("cherry_pick", { ...tp(), commitHash });
    },
    revert(commitHash: string): Promise<void> {
      return invoke<void>("revert", { ...tp(), commitHash });
    },
    createTag(tagName: string, message?: string): Promise<void> {
      return invoke<void>("create_tag", { ...tp(), tagName, message });
    },

    readDirTree(rootPath?: string, subPath?: string, maxDepth?: number): Promise<FileNode[]> {
      return invoke<FileNode[]>("read_dir_tree", {
        ...fileTransportArg(transport),
        rootPath: rootPath ?? null,
        subPath: subPath ?? null,
        maxDepth: maxDepth ?? 4,
      });
    },
    readFileContent(filePath: string, rootPath?: string): Promise<FileContent> {
      return invoke<FileContent>("read_file_content", {
        ...fileTransportArg(transport),
        filePath,
        rootPath,
      });
    },
    writeFileContent(filePath: string, content: string, rootPath?: string): Promise<void> {
      return invoke<void>("write_file_content", {
        ...fileTransportArg(transport),
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
        ...fileTransportArg(transport),
        agentId,
        agentCommandOverride: agentCommandOverride ?? null,
        filePaths,
      });
    },
  };
}
