/** 文件树默认递归深度（每次加载的最大层数） */
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
