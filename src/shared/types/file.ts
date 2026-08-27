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
  /**
   * 受影响的目录相对路径集合（'' 表示项目根）。
   * 非空：前端只需重载命中这些路径的已展开目录缓存（S2-2 定向刷新）；
   * 空 / 缺失（旧后端）：变更范围未知，退回全树刷新兜底。
   */
  dirs?: string[];
}
