import { invoke } from "@tauri-apps/api/core";
import type { AuthMethod } from "../../types/connection";
import type { ProjectCommands } from "../../types/activeProject";
import type {
  GitInfo,
  AheadBehind,
  CommitEntry,
  CommitDetail,
  CommitFileChange,
  CommitResult,
  DiffResult,
} from "../../types/git";
import type { FileNode, FileContent } from "../../types/file";

export type GitTransportKind =
  | { type: "Local"; projectId: string; projectPath: string }
  | { type: "Wsl"; distro: string; projectPath: string }
  | { type: "Remote"; host: string; port: number; username: string; auth: AuthMethod; projectPath: string };

/** Build the `transport` argument for git_* commands */
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

/** Old-style args for local file/AI commands that use project_id */
function localFileArgs(t: GitTransportKind): Record<string, unknown> {
  switch (t.type) {
    case "Local":
      return { projectId: t.projectId };
    case "Wsl":
      return { distro: t.distro, projectPath: t.projectPath };
    case "Remote":
      return { host: t.host, port: t.port, username: t.username, auth: t.auth as AuthMethod, projectPath: t.projectPath };
  }
}

/** Build the `transport` argument for file operation commands (Remote + WSL) */
function fileTransportArg(t: GitTransportKind): Record<string, unknown> | null {
  switch (t.type) {
    case "Local":
      return null; // Local uses project_id-based commands
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

/**
 * createUnifiedCommands — 统一项目命令集
 * Git 操作通过 unified_* 路由到后端，后端自动分发到 Local/WSL/Remote。
 * 文件/AI 操作仍使用传统 per-type 命令，不做统一。
 */
export function createUnifiedCommands(transport: GitTransportKind): ProjectCommands {
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

    // Non-git commands — per-type dispatch (different command names per transport type)
    readDirTree(rootPath?: string, subPath?: string, maxDepth?: number): Promise<FileNode[]> {
      const ft = fileTransportArg(transport);
      if (ft) {
        return invoke<FileNode[]>("unified_read_dir_tree", {
          ...ft,
          rootPath: rootPath ?? null,
          subPath: subPath ?? null,
          maxDepth: maxDepth ?? 4,
        });
      }
      return invoke<FileNode[]>("read_dir_tree", {
        ...localFileArgs(transport),
        rootPath: rootPath ?? null,
        subPath: subPath ?? null,
        maxDepth: maxDepth ?? 4,
      });
    },
    readFileContent(filePath: string, rootPath?: string): Promise<FileContent> {
      const ft = fileTransportArg(transport);
      if (ft) {
        return invoke<FileContent>("unified_read_file_content", { ...ft, filePath, rootPath });
      }
      return invoke<FileContent>("read_file_content", { ...localFileArgs(transport), filePath, rootPath });
    },
    writeFileContent(filePath: string, content: string, rootPath?: string): Promise<void> {
      const ft = fileTransportArg(transport);
      if (ft) {
        return invoke<void>("unified_write_file_content", { ...ft, filePath, content, rootPath });
      }
      return invoke<void>("write_file_content", { ...localFileArgs(transport), filePath, content, rootPath });
    },

    generateCommitMessage(
      agentId: string,
      filePaths: string[],
      agentCommandOverride?: string | null,
    ): Promise<string> {
      const ft = fileTransportArg(transport);
      if (ft) {
        return invoke<string>("unified_generate_commit_message", {
          ...ft,
          agentId,
          agentCommandOverride: agentCommandOverride ?? null,
          filePaths,
        });
      }
      return invoke<string>("generate_commit_message_command", {
        ...localFileArgs(transport),
        agentId,
        agentCommandOverride: agentCommandOverride ?? null,
        filePaths,
      });
    },
  };
}
