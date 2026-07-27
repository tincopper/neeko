import { invoke } from '@tauri-apps/api/core';

import type { FileContent, FileNode } from '@/shared/types';

export function revealInFileManager(path: string): Promise<void> {
  return invoke<void>('reveal_in_file_manager', { path });
}

export function readFileContent(
  projectId: string,
  filePath: string,
  rootPath?: string | null,
): Promise<FileContent> {
  return invoke<FileContent>('read_file_content', {
    projectId,
    filePath,
    rootPath: rootPath ?? null,
  });
}

export function readDirTree(
  projectId: string,
  subPath?: string | null,
  rootPath?: string | null,
  maxDepth?: number | null,
): Promise<FileNode[]> {
  return invoke<FileNode[]>('read_dir_tree', {
    projectId,
    rootPath: rootPath ?? null,
    subPath: subPath ?? null,
    maxDepth: maxDepth ?? null,
  });
}

export function createNewFile(
  projectId: string,
  filePath: string,
  rootPath?: string | null,
): Promise<void> {
  return invoke<void>('create_new_file', {
    projectId,
    filePath,
    rootPath: rootPath ?? null,
  });
}

export function saveNewFile(
  projectId: string,
  directory: string,
  filename: string,
  content: string,
  rootPath?: string | null,
): Promise<string> {
  return invoke<string>('save_new_file', {
    projectId,
    directory,
    filename,
    content,
    rootPath: rootPath ?? null,
  });
}

export function writeFileContent(
  projectId: string,
  filePath: string,
  content: string,
  rootPath?: string | null,
): Promise<void> {
  return invoke<void>('write_file_content', {
    projectId,
    filePath,
    content,
    rootPath: rootPath ?? null,
  });
}
