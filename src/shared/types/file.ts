/**
 * 根目录初始扫描深度（S4 调整 3→2）：第三层走懒加载，
 * 初始 read_dir_tree 成本减半，展开体验由目录桶懒加载兜住。
 */
export const DEFAULT_TREE_DEPTH = 2;

/** 目录内容的加载状态：`loading` 中重复请求幂等合并；`error` 保留旧内容可重试 */
export type DirLoadState = 'idle' | 'loading' | 'loaded' | 'error';

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileNode[];
  /**
   * 被 .gitignore 忽略（S5 退役 ignored_files 数组：灰显标记由后端读层原生标注，
   * ignored 目录保留节点但不递归 children）。
   */
  ignored?: boolean;
}

/**
 * 文件树节点的 git 主导状态词表（与 gitFileDecoration 的展示优先级链共用同一词表）。
 */
export type FileTreeGitStatus =
  | 'conflict'
  | 'deleted'
  | 'modified'
  | 'renamed'
  | 'untracked'
  | 'added';

/**
 * 文件树视图节点：FileNode（文件系统事实）+ 投影字段（git 状态 + 逐节点视图状态）。
 *
 * 仅存在于 `buildFileTreeView` 的组装产出中；目录桶缓存内的 FileNode 不携带
 * 这些字段——桶是 fs 事实模型（由文件事件写入），投影由 git 快照 / 面板视图状态
 * 派生，两者生命周期与写入方不同，不得混写（数据与信号分离）。
 *
 * 全部视图状态（激活/选中/展开/加载/内联编辑）在组装期盖章为节点字段，
 * FileTreeRow 因此只收「节点 + 稳定回调」，渲染隔离由子树指纹统一承载
 * （S4 起为扁平行 + VirtualList 窗口化渲染）。
 */
export type FileTreeViewNode = FileNode & {
  // ── git 状态投影（S3 状态入模）────────────────────────────
  /** 主导 git 状态；无状态 / 非 git 项目为 undefined */
  git_status?: FileTreeGitStatus;
  /** 被 .gitignore 忽略且无 git 状态（灰显输入；与状态共存时状态优先） */
  is_ignored?: boolean;
  // ── 逐节点视图状态投影 ────────────────────────────────────
  /** activeFilePath 命中本节点（accent 高亮 + aria-selected） */
  is_active?: boolean;
  /** selectedPath 命中本节点（选中高亮 + 滚动定位） */
  is_selected?: boolean;
  /** 目录已展开（决定 children 是否渲染；仅目录节点携带） */
  is_expanded?: boolean;
  /** 目录加载状态（loading spinner / error 重试；仅目录节点携带） */
  dir_state?: DirLoadState;
  /** 内联新建输入落在本目录（仅命中节点携带；value 每击键更新 → 指纹驱动重渲染） */
  creating_input?: { kind: 'file' | 'dir'; value: string };
  /** 内联重命名命中本节点（行替换为输入框；仅命中节点携带） */
  renaming_name?: string;
};

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
  /** 只读 tab（如 LSP 跳转打开的项目外定义文件）：不可编辑。 */
  readOnly?: boolean;
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
