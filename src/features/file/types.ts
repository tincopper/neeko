export const DEFAULT_TREE_DEPTH = 4;

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileNode[];
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
  is_binary: boolean;
}

export interface FileViewState {
  projectId: string;
  filePath: string;
}

export interface FileTab {
  id: string;
  projectId: string;
  filePath: string;
  fileName: string;
  content: FileContent;
  isDirty: boolean;
  order: number;
}

export interface FileChangedEvent {
  project_id: string;
  paths: string[];
}

export interface FileTreeChangedEvent {
  project_id: string;
}

/**
 * Transport kind for file operations.
 * Shape matches the Rust FileTransportKind enum that serde serialises.
 */
export type FileTransportKind =
  | { Local: { project_path: string } }
  | { Wsl: { distro: string; project_path: string } }
  | { Remote: { host: string; port: number; username: string; auth: unknown; project_path: string } };
