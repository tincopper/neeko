/**
 * commandFactory.ts — 三种项目类型的命令工厂
 *
 * Step 2: 所有方法替换为真实 invoke 调用（Local 已有命令）
 *         WSL / Remote 新增命令使用约定命名占位（Step 4 后端实现后生效）
 *
 * 约束 L4：三个工厂函数在同一文件中定义，不得从其他 factory 文件 import。
 * 约束 H1：只负责「将连接参数绑定到 invoke 调用」，不包含 UI 逻辑。
 */

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

// ────────────────────────────────────────────────────────────────────────────
// createLocalCommands
// ────────────────────────────────────────────────────────────────────────────

/**
 * createLocalCommands — 创建本地项目命令集
 * 所有方法绑定到现有 local invoke 命令。
 *
 * @param projectId 本地项目 ID
 */
export function createLocalCommands(projectId: string): ProjectCommands {
  return {
    // ── Git Info ──────────────────────────────────────────────────────────
    refreshGitInfo(): Promise<GitInfo> {
      return invoke<GitInfo>("refresh_git_info", { projectId });
    },
    getAheadBehind(): Promise<AheadBehind> {
      return invoke<AheadBehind>("get_ahead_behind_command", { projectId });
    },

    // ── Staging ───────────────────────────────────────────────────────────
    stageFiles(filePaths: string[]): Promise<void> {
      return invoke<void>("stage_files_command", { projectId, filePaths });
    },
    unstageFiles(filePaths: string[]): Promise<void> {
      return invoke<void>("unstage_files_command", { projectId, filePaths });
    },
    discardFile(filePath: string): Promise<void> {
      return invoke<void>("discard_file_command", { projectId, filePath });
    },

    // ── Commit ────────────────────────────────────────────────────────────
    commitFiles(filePaths: string[], message: string): Promise<CommitResult> {
      return invoke<CommitResult>("commit_files_command", { projectId, filePaths, message });
    },

    // ── Sync ──────────────────────────────────────────────────────────────
    fetch(): Promise<void> {
      return invoke<void>("fetch_command", { projectId });
    },
    pull(): Promise<void> {
      return invoke<void>("pull_command", { projectId });
    },
    push(setUpstream?: boolean): Promise<void> {
      return invoke<void>("push_command", { projectId, setUpstream: setUpstream ?? false });
    },

    // ── Branch ────────────────────────────────────────────────────────────
    checkoutBranch(branchName: string): Promise<void> {
      return invoke<void>("checkout_branch", { projectId, branchName });
    },
    createBranch(branchName: string, startPoint?: string): Promise<void> {
      return invoke<void>("create_branch", { projectId, branchName, startPoint });
    },
    deleteBranch(branchName: string): Promise<void> {
      return invoke<void>("delete_branch", { projectId, branchName });
    },

    // ── Log ───────────────────────────────────────────────────────────────
    getCommitLog(count: number, skip?: number): Promise<CommitEntry[]> {
      return invoke<CommitEntry[]>("get_commit_log_command", { projectId, count, skip });
    },
    getCommitDetail(commitHash: string): Promise<CommitDetail> {
      return invoke<CommitDetail>("get_commit_detail_command", { projectId, commitHash });
    },
    getCommitFiles(commitHash: string): Promise<CommitFileChange[]> {
      return invoke<CommitFileChange[]>("get_commit_files_command", { projectId, commitHash });
    },
    getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult> {
      return invoke<DiffResult>("get_commit_file_diff_command", { projectId, commitHash, filePath });
    },

    // ── Advanced Git ──────────────────────────────────────────────────────
    cherryPick(commitHash: string): Promise<void> {
      return invoke<void>("cherry_pick_command", { projectId, commitHash });
    },
    revert(commitHash: string): Promise<void> {
      return invoke<void>("revert_command", { projectId, commitHash });
    },
    createTag(tagName: string, message?: string): Promise<void> {
      return invoke<void>("create_tag_command", { projectId, tagName, message });
    },

    // ── Files ─────────────────────────────────────────────────────────────
    readDirTree(rootPath?: string, subPath?: string, maxDepth?: number): Promise<FileNode[]> {
      return invoke<FileNode[]>("read_dir_tree", {
        projectId,
        rootPath: rootPath ?? null,
        subPath: subPath ?? null,
        maxDepth: maxDepth ?? 4,
      });
    },
    readFileContent(filePath: string, rootPath?: string): Promise<FileContent> {
      return invoke<FileContent>("read_file_content", { projectId, filePath, rootPath });
    },
    writeFileContent(filePath: string, content: string, rootPath?: string): Promise<void> {
      return invoke<void>("write_file_content", { projectId, filePath, content, rootPath });
    },

    // ── AI ────────────────────────────────────────────────────────────────
    generateCommitMessage(
      agentId: string,
      filePaths: string[],
      agentCommandOverride?: string | null,
    ): Promise<string> {
      return invoke<string>("generate_commit_message_command", {
        projectId,
        agentId,
        agentCommandOverride: agentCommandOverride ?? null,
        filePaths,
      });
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// createWslCommands
// ────────────────────────────────────────────────────────────────────────────

/**
 * createWslCommands — 创建 WSL 项目命令集
 *
 * 已存在的 WSL 命令使用真实命令名。
 * 尚未实现的命令使用约定命名占位（Step 4 后端实现后生效）。
 *
 * @param distro      WSL 发行版名称
 * @param projectPath WSL 内部项目路径
 */
export function createWslCommands(distro: string, projectPath: string): ProjectCommands {
  return {
    // ── Git Info ──────────────────────────────────────────────────────────
    // refresh_wsl_git_info — 已实现
    refreshGitInfo(): Promise<GitInfo> {
      return invoke<GitInfo>("refresh_wsl_git_info", { distro, projectPath });
    },
    // wsl_get_ahead_behind — 占位（Step 4）
    getAheadBehind(): Promise<AheadBehind> {
      return invoke<AheadBehind>("wsl_get_ahead_behind", { distro, projectPath });
    },

    // ── Staging ───────────────────────────────────────────────────────────
    // wsl_stage_files — 占位（Step 4）
    stageFiles(filePaths: string[]): Promise<void> {
      return invoke<void>("wsl_stage_files", { distro, projectPath, filePaths });
    },
    // wsl_unstage_files — 占位（Step 4）
    unstageFiles(filePaths: string[]): Promise<void> {
      return invoke<void>("wsl_unstage_files", { distro, projectPath, filePaths });
    },
    // wsl_discard_file — 占位（Step 4）
    discardFile(filePath: string): Promise<void> {
      return invoke<void>("wsl_discard_file", { distro, projectPath, filePath });
    },

    // ── Commit ────────────────────────────────────────────────────────────
    // wsl_commit_files — 占位（Step 4）
    commitFiles(filePaths: string[], message: string): Promise<CommitResult> {
      return invoke<CommitResult>("wsl_commit_files", { distro, projectPath, filePaths, message });
    },

    // ── Sync ──────────────────────────────────────────────────────────────
    // wsl_fetch — 占位（Step 4）
    fetch(): Promise<void> {
      return invoke<void>("wsl_fetch", { distro, projectPath });
    },
    // wsl_pull — 占位（Step 4）
    pull(): Promise<void> {
      return invoke<void>("wsl_pull", { distro, projectPath });
    },
    // wsl_push — 占位（Step 4）
    push(setUpstream?: boolean): Promise<void> {
      return invoke<void>("wsl_push", { distro, projectPath, setUpstream: setUpstream ?? false });
    },

    // ── Branch ────────────────────────────────────────────────────────────
    // wsl_checkout_branch — 已实现
    checkoutBranch(branchName: string): Promise<void> {
      return invoke<void>("wsl_checkout_branch", { distro, projectPath, branchName });
    },
    // wsl_create_branch — 已实现
    createBranch(branchName: string, _startPoint?: string): Promise<void> {
      return invoke<void>("wsl_create_branch", { distro, projectPath, branchName });
    },
    // wsl_delete_branch — 占位（Step 4）
    deleteBranch(branchName: string): Promise<void> {
      return invoke<void>("wsl_delete_branch", { distro, projectPath, branchName });
    },

    // ── Log ───────────────────────────────────────────────────────────────
    // wsl_get_commit_log — 占位（Step 4）
    getCommitLog(count: number, skip?: number): Promise<CommitEntry[]> {
      return invoke<CommitEntry[]>("wsl_get_commit_log", { distro, projectPath, count, skip });
    },
    // wsl_get_commit_detail — 占位（Step 4）
    getCommitDetail(commitHash: string): Promise<CommitDetail> {
      return invoke<CommitDetail>("wsl_get_commit_detail", { distro, projectPath, commitHash });
    },
    // wsl_get_commit_files — 占位（Step 4）
    getCommitFiles(commitHash: string): Promise<CommitFileChange[]> {
      return invoke<CommitFileChange[]>("wsl_get_commit_files", { distro, projectPath, commitHash });
    },
    // wsl_get_commit_file_diff — 占位（Step 4）
    getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult> {
      return invoke<DiffResult>("wsl_get_commit_file_diff", {
        distro,
        projectPath,
        commitHash,
        filePath,
      });
    },

    // ── Advanced Git ──────────────────────────────────────────────────────
    // wsl_cherry_pick — 占位（Step 4）
    cherryPick(commitHash: string): Promise<void> {
      return invoke<void>("wsl_cherry_pick", { distro, projectPath, commitHash });
    },
    // wsl_revert — 占位（Step 4）
    revert(commitHash: string): Promise<void> {
      return invoke<void>("wsl_revert", { distro, projectPath, commitHash });
    },
    // wsl_create_tag — 占位（Step 4）
    createTag(tagName: string, message?: string): Promise<void> {
      return invoke<void>("wsl_create_tag", { distro, projectPath, tagName, message });
    },

    // ── Files ─────────────────────────────────────────────────────────────
    // wsl_read_dir_tree — 占位（Step 4）
    readDirTree(rootPath?: string, subPath?: string, maxDepth?: number): Promise<FileNode[]> {
      return invoke<FileNode[]>("wsl_read_dir_tree", {
        distro,
        projectPath,
        rootPath: rootPath ?? null,
        subPath: subPath ?? null,
        maxDepth: maxDepth ?? 4,
      });
    },
    // wsl_read_file_content — 占位（Step 4）
    readFileContent(filePath: string, rootPath?: string): Promise<FileContent> {
      return invoke<FileContent>("wsl_read_file_content", {
        distro,
        projectPath,
        filePath,
        rootPath,
      });
    },
    // canEditFiles=false for WSL, but keep consistent signature
    // wsl_write_file_content — 占位（Step 4）
    writeFileContent(filePath: string, content: string, rootPath?: string): Promise<void> {
      return invoke<void>("wsl_write_file_content", {
        distro,
        projectPath,
        filePath,
        content,
        rootPath,
      });
    },

    // ── AI ────────────────────────────────────────────────────────────────
    // canGenerateCommitMessage=false for WSL, but keep consistent signature
    // wsl_generate_commit_message — 占位（Step 4）
    generateCommitMessage(
      agentId: string,
      filePaths: string[],
      agentCommandOverride?: string | null,
    ): Promise<string> {
      return invoke<string>("wsl_generate_commit_message", {
        distro,
        projectPath,
        agentId,
        agentCommandOverride: agentCommandOverride ?? null,
        filePaths,
      });
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// createRemoteCommands
// ────────────────────────────────────────────────────────────────────────────

/**
 * createRemoteCommands — 创建 SSH Remote 项目命令集
 *
 * 已存在的 Remote 命令使用真实命令名。
 * 尚未实现的命令使用约定命名占位（Step 4 后端实现后生效）。
 *
 * @param host        SSH 主机地址
 * @param port        SSH 端口
 * @param username    SSH 用户名
 * @param auth        认证方式
 * @param projectPath 远程项目路径
 */
export function createRemoteCommands(
  host: string,
  port: number,
  username: string,
  auth: AuthMethod,
  projectPath: string,
): ProjectCommands {
  // SSH 基础连接参数
  const conn = { host, port, username, auth };

  return {
    // ── Git Info ──────────────────────────────────────────────────────────
    // refresh_remote_git_info — 已实现
    refreshGitInfo(): Promise<GitInfo> {
      return invoke<GitInfo>("refresh_remote_git_info", { ...conn, projectPath });
    },
    // remote_get_ahead_behind — 占位（Step 4）
    getAheadBehind(): Promise<AheadBehind> {
      return invoke<AheadBehind>("remote_get_ahead_behind", { ...conn, projectPath });
    },

    // ── Staging ───────────────────────────────────────────────────────────
    // remote_stage_files — 占位（Step 4）
    stageFiles(filePaths: string[]): Promise<void> {
      return invoke<void>("remote_stage_files", { ...conn, projectPath, filePaths });
    },
    // remote_unstage_files — 占位（Step 4）
    unstageFiles(filePaths: string[]): Promise<void> {
      return invoke<void>("remote_unstage_files", { ...conn, projectPath, filePaths });
    },
    // remote_discard_file — 占位（Step 4）
    discardFile(filePath: string): Promise<void> {
      return invoke<void>("remote_discard_file", { ...conn, projectPath, filePath });
    },

    // ── Commit ────────────────────────────────────────────────────────────
    // remote_commit_files — 占位（Step 4）
    commitFiles(filePaths: string[], message: string): Promise<CommitResult> {
      return invoke<CommitResult>("remote_commit_files", { ...conn, projectPath, filePaths, message });
    },

    // ── Sync ──────────────────────────────────────────────────────────────
    // remote_fetch — 占位（Step 4）
    fetch(): Promise<void> {
      return invoke<void>("remote_fetch", { ...conn, projectPath });
    },
    // remote_pull — 占位（Step 4）
    pull(): Promise<void> {
      return invoke<void>("remote_pull", { ...conn, projectPath });
    },
    // remote_push — 占位（Step 4）
    push(setUpstream?: boolean): Promise<void> {
      return invoke<void>("remote_push", { ...conn, projectPath, setUpstream: setUpstream ?? false });
    },

    // ── Branch ────────────────────────────────────────────────────────────
    // remote_checkout_branch — 已实现
    checkoutBranch(branchName: string): Promise<void> {
      return invoke<void>("remote_checkout_branch", { ...conn, projectPath, branchName });
    },
    // remote_create_branch — 已实现
    createBranch(branchName: string, _startPoint?: string): Promise<void> {
      return invoke<void>("remote_create_branch", { ...conn, projectPath, branchName });
    },
    // remote_delete_branch — 占位（Step 4）
    deleteBranch(branchName: string): Promise<void> {
      return invoke<void>("remote_delete_branch", { ...conn, projectPath, branchName });
    },

    // ── Log ───────────────────────────────────────────────────────────────
    // remote_get_commit_log — 占位（Step 4）
    getCommitLog(count: number, skip?: number): Promise<CommitEntry[]> {
      return invoke<CommitEntry[]>("remote_get_commit_log", { ...conn, projectPath, count, skip });
    },
    // remote_get_commit_detail — 占位（Step 4）
    getCommitDetail(commitHash: string): Promise<CommitDetail> {
      return invoke<CommitDetail>("remote_get_commit_detail", { ...conn, projectPath, commitHash });
    },
    // remote_get_commit_files — 占位（Step 4）
    getCommitFiles(commitHash: string): Promise<CommitFileChange[]> {
      return invoke<CommitFileChange[]>("remote_get_commit_files", {
        ...conn,
        projectPath,
        commitHash,
      });
    },
    // remote_get_commit_file_diff — 占位（Step 4）
    getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult> {
      return invoke<DiffResult>("remote_get_commit_file_diff", {
        ...conn,
        projectPath,
        commitHash,
        filePath,
      });
    },

    // ── Advanced Git ──────────────────────────────────────────────────────
    // remote_cherry_pick — 占位（Step 4）
    cherryPick(commitHash: string): Promise<void> {
      return invoke<void>("remote_cherry_pick", { ...conn, projectPath, commitHash });
    },
    // remote_revert — 占位（Step 4）
    revert(commitHash: string): Promise<void> {
      return invoke<void>("remote_revert", { ...conn, projectPath, commitHash });
    },
    // remote_create_tag — 占位（Step 4）
    createTag(tagName: string, message?: string): Promise<void> {
      return invoke<void>("remote_create_tag", { ...conn, projectPath, tagName, message });
    },

    // ── Files ─────────────────────────────────────────────────────────────
    // remote_read_dir_tree — 占位（Step 4）
    readDirTree(rootPath?: string, subPath?: string, maxDepth?: number): Promise<FileNode[]> {
      return invoke<FileNode[]>("remote_read_dir_tree", {
        ...conn,
        projectPath,
        rootPath: rootPath ?? null,
        subPath: subPath ?? null,
        maxDepth: maxDepth ?? 4,
      });
    },
    // remote_read_file_content — 占位（Step 4）
    readFileContent(filePath: string, rootPath?: string): Promise<FileContent> {
      return invoke<FileContent>("remote_read_file_content", {
        ...conn,
        projectPath,
        filePath,
        rootPath,
      });
    },
    // canEditFiles=false for remote, but keep consistent signature
    // remote_write_file_content — 占位（Step 4）
    writeFileContent(filePath: string, content: string, rootPath?: string): Promise<void> {
      return invoke<void>("remote_write_file_content", {
        ...conn,
        projectPath,
        filePath,
        content,
        rootPath,
      });
    },

    // ── AI ────────────────────────────────────────────────────────────────
    // canGenerateCommitMessage=false for remote, but keep consistent signature
    // remote_generate_commit_message — 占位（Step 4）
    generateCommitMessage(
      agentId: string,
      filePaths: string[],
      agentCommandOverride?: string | null,
    ): Promise<string> {
      return invoke<string>("remote_generate_commit_message", {
        ...conn,
        projectPath,
        agentId,
        agentCommandOverride: agentCommandOverride ?? null,
        filePaths,
      });
    },
  };
}
