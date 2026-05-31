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
    file_path: filePath,
    root_path: rootPath ?? null,
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
    root_path: rootPath ?? null,
    sub_path: subPath ?? null,
    max_depth: maxDepth ?? null,
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
    file_path: filePath,
    content,
    root_path: rootPath ?? null,
  });
}
