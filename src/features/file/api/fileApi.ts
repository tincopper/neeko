import { invoke } from '@tauri-apps/api/core';

import type { FileContent, FileNode, WorkspaceSession } from '@/shared/types';

export function revealInFileManager(path: string): Promise<void> {
  return invoke<void>('reveal_in_file_manager', { path });
}

/** 存在性探测（O(1) stat，不读内容）：任务命令构造等前端逻辑用。 */
export function fileExists(path: string): Promise<boolean> {
  return invoke<boolean>('file_exists', { path });
}

// ── 文件读写：地址是一个 `WorkspaceSession` 值对象（首个参数，**必填**）────────────
//
// `worktreePath === null` = 主 checkout。后端由 `resolve_workspace_target` 唯一解析出工作树根，
// 调用方不传「任意 root 路径」—— 那把同一份身份变成了散参，且在 worktree 场景下默认值恒错。

export function readFileContent(
  workspace: WorkspaceSession,
  filePath: string,
): Promise<FileContent> {
  return invoke<FileContent>('read_file_content', { workspace, filePath });
}

export function readDirTree(
  workspace: WorkspaceSession,
  subPath?: string | null,
  maxDepth?: number | null,
): Promise<FileNode[]> {
  return invoke<FileNode[]>('read_dir_tree', {
    workspace,
    subPath: subPath ?? null,
    maxDepth: maxDepth ?? null,
  });
}

export function createNewFile(workspace: WorkspaceSession, filePath: string): Promise<void> {
  return invoke<void>('create_new_file', { workspace, filePath });
}

export function createDirectory(workspace: WorkspaceSession, dirPath: string): Promise<void> {
  return invoke<void>('create_directory', { workspace, dirPath });
}

export function deletePath(workspace: WorkspaceSession, path: string): Promise<void> {
  return invoke<void>('delete_path', { workspace, path });
}

export function renamePath(
  workspace: WorkspaceSession,
  path: string,
  newName: string,
): Promise<void> {
  return invoke<void>('rename_path', { workspace, path, newName });
}

export function saveNewFile(
  workspace: WorkspaceSession,
  directory: string,
  filename: string,
  content: string,
): Promise<string> {
  return invoke<string>('save_new_file', { workspace, directory, filename, content });
}

export function writeFileContent(
  workspace: WorkspaceSession,
  filePath: string,
  content: string,
): Promise<void> {
  return invoke<void>('write_file_content', { workspace, filePath, content });
}
