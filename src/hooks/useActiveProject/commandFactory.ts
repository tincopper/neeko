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

/** Build the `transport` argument for unified_* commands */
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

/** Old-style args for non-git commands (file/AI) that still need per-type dispatch */
function fileArgs(t: GitTransportKind): Record<string, unknown> {
  switch (t.type) {
    case "Local":
      return { projectId: t.projectId };
    case "Wsl":
      return { distro: t.distro, projectPath: t.projectPath };
    case "Remote":
      return { host: t.host, port: t.port, username: t.username, auth: t.auth as AuthMethod, projectPath: t.projectPath };
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
      return invoke<GitInfo>("unified_get_git_info", tp());
    },
    getAheadBehind(): Promise<AheadBehind> {
      return invoke<AheadBehind>("unified_get_ahead_behind", tp());
    },

    stageFiles(filePaths: string[]): Promise<void> {
      return invoke<void>("unified_stage_files", { ...tp(), filePaths });
    },
    unstageFiles(filePaths: string[]): Promise<void> {
      return invoke<void>("unified_unstage_files", { ...tp(), filePaths });
    },
    discardFile(filePath: string): Promise<void> {
      return invoke<void>("unified_discard_file", { ...tp(), filePath });
    },

    commitFiles(filePaths: string[], message: string): Promise<CommitResult> {
      return invoke<CommitResult>("unified_commit_files", { ...tp(), filePaths, message });
    },

    fetch(): Promise<void> {
      return invoke<void>("unified_fetch", tp());
    },
    pull(): Promise<void> {
      return invoke<void>("unified_pull", tp());
    },
    push(setUpstream?: boolean): Promise<void> {
      return invoke<void>("unified_push", { ...tp(), setUpstream: setUpstream ?? false });
    },

    checkoutBranch(branchName: string): Promise<void> {
      return invoke<void>("unified_checkout_branch", { ...tp(), branchName });
    },
    createBranch(branchName: string, startPoint?: string): Promise<void> {
      return invoke<void>("unified_create_branch", { ...tp(), branchName, startPoint });
    },
    deleteBranch(branchName: string): Promise<void> {
      return invoke<void>("unified_delete_branch", { ...tp(), branchName });
    },

    getCommitLog(count: number, skip?: number): Promise<CommitEntry[]> {
      return invoke<CommitEntry[]>("unified_get_commit_log", { ...tp(), count, skip });
    },
    getCommitDetail(commitHash: string): Promise<CommitDetail> {
      return invoke<CommitDetail>("unified_get_commit_detail", { ...tp(), commitHash });
    },
    getCommitFiles(commitHash: string): Promise<CommitFileChange[]> {
      return invoke<CommitFileChange[]>("unified_get_commit_files", { ...tp(), commitHash });
    },
    getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult> {
      return invoke<DiffResult>("unified_get_commit_file_diff", { ...tp(), commitHash, filePath });
    },

    cherryPick(commitHash: string): Promise<void> {
      return invoke<void>("unified_cherry_pick", { ...tp(), commitHash });
    },
    revert(commitHash: string): Promise<void> {
      return invoke<void>("unified_revert", { ...tp(), commitHash });
    },
    createTag(tagName: string, message?: string): Promise<void> {
      return invoke<void>("unified_create_tag", { ...tp(), tagName, message });
    },

    // Non-git commands — per-type dispatch (different command names per transport type)
    readDirTree(rootPath?: string, subPath?: string, maxDepth?: number): Promise<FileNode[]> {
      const cmd = transport.type === "Wsl" ? "wsl_read_dir_tree"
        : transport.type === "Remote" ? "remote_read_dir_tree"
        : "read_dir_tree";
      return invoke<FileNode[]>(cmd, {
        ...fileArgs(transport),
        rootPath: rootPath ?? null,
        subPath: subPath ?? null,
        maxDepth: maxDepth ?? 4,
      });
    },
    readFileContent(filePath: string, rootPath?: string): Promise<FileContent> {
      const cmd = transport.type === "Wsl" ? "wsl_read_file_content"
        : transport.type === "Remote" ? "remote_read_file_content"
        : "read_file_content";
      return invoke<FileContent>(cmd, { ...fileArgs(transport), filePath, rootPath });
    },
    writeFileContent(filePath: string, content: string, rootPath?: string): Promise<void> {
      const cmd = transport.type === "Wsl" ? "wsl_write_file_content"
        : transport.type === "Remote" ? "remote_write_file_content"
        : "write_file_content";
      return invoke<void>(cmd, { ...fileArgs(transport), filePath, content, rootPath });
    },

    generateCommitMessage(
      agentId: string,
      filePaths: string[],
      agentCommandOverride?: string | null,
    ): Promise<string> {
      const cmd = transport.type === "Wsl" ? "wsl_generate_commit_message"
        : transport.type === "Remote" ? "remote_generate_commit_message"
        : "generate_commit_message_command";
      return invoke<string>(cmd, {
        ...fileArgs(transport),
        agentId,
        agentCommandOverride: agentCommandOverride ?? null,
        filePaths,
      });
    },
  };
}
