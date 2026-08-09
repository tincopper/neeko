export const DEFAULT_TREE_DEPTH = 3;

/** 目录内容的加载状态：`loading` 中重复请求幂等合并；`error` 保留旧内容可重试 */
export type DirLoadState = 'idle' | 'loading' | 'loaded' | 'error';

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
  initialPreviewMode?: 'preview' | 'source';
  isUntitled?: boolean;
  untitledName?: string;
}

export interface FileChangedEvent {
  project_id: string;
  paths: string[];
}

export interface FileTreeChangedEvent {
  project_id: string;
}
