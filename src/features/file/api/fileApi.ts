import { invoke } from '@tauri-apps/api/core';

import type { FileTransportKind, FileContent, FileNode } from '@/shared/types';

export function revealInFileManager(path: string): Promise<void> {
  return invoke<void>('reveal_in_file_manager', { path });
}

export function readFileContent(
  transport: FileTransportKind,
  filePath: string,
  rootPath?: string | null,
): Promise<FileContent> {
  return invoke<FileContent>('read_file_content', {
    transport,
    filePath,
    rootPath: rootPath ?? null,
  });
}

export function readDirTree(
  transport: FileTransportKind,
  subPath?: string | null,
  rootPath?: string | null,
  maxDepth?: number | null,
): Promise<FileNode[]> {
  return invoke<FileNode[]>('read_dir_tree', {
    transport,
    rootPath: rootPath ?? null,
    subPath: subPath ?? null,
    maxDepth: maxDepth ?? null,
  });
}

export function writeFileContent(
  transport: FileTransportKind,
  filePath: string,
  content: string,
  rootPath?: string | null,
): Promise<void> {
  return invoke<void>('write_file_content', {
    transport,
    filePath,
    content,
    rootPath: rootPath ?? null,
  });
}
