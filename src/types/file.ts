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

/** 后端 file-changed 事件 payload（watcher 检测到文件内容变更时发出） */
export interface FileChangedEvent {
  project_id: string;
  /** 相对于项目根目录的变更路径列表（使用 `/` 分隔符） */
  paths: string[];
}

/** 后端 file-tree-changed 事件 payload（文件新增/删除/重命名时发出，前端应刷新目录树） */
export interface FileTreeChangedEvent {
  project_id: string;
}
