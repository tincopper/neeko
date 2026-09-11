import type {
  DirLoadState,
  FileNode,
  FileTreeGitStatus,
  FileTreeViewNode,
  Tab,
  FileTabData,
} from '@/shared/types';

/** 逐节点视图状态输入（FilesPanel 从 useFilePanelState / store 聚合后传入） */
export interface FileTreeViewInput {
  /** activeFilePath：盖章为 is_active（accent 高亮 + aria-selected） */
  activeFilePath?: string | null;
  /** 选中节点路径：盖章为 is_selected（高亮 + 滚动定位） */
  selectedPath?: string | null;
  /** 目录加载状态机：盖章为目录节点的 dir_state（spinner / 重试红点） */
  dirLoadStates?: Record<string, DirLoadState>;
  /** 内联新建：命中目录盖章为 creating_input（含当前输入值，击键驱动指纹变化） */
  creating?: { dirPath: string; kind: 'file' | 'dir' } | null;
  creatingValue?: string;
  /** 内联重命名：命中节点盖章为 renaming_name（行替换为输入框） */
  renaming?: { path: string; isDir: boolean; name: string } | null;
}

/**
 * 从扁平目录缓存组装嵌套视图树。
 * 仅沿「已展开路径」向下组装 children；未展开目录的 children 截断为空。
 * 数据源 `dirs[path]` 只含一级条目，子目录内容由各自的 `dirs[path]` key 提供 ——
 * 根刷新替换 `dirs['']` 不会影响任何已展开子目录的缓存，根治「展开目录被整树覆盖截断」。
 *
 * S3 组装期 join：git 语义状态（decorate = resolveNodeStatus 产物）与逐节点视图
 * 状态（input）在组装 walk 时统一盖章到节点——FileTreeNode 只收「节点 + 稳定回调」，
 * 无渲染期匹配回调、无动态 props 下传。
 *
 * 每个产出节点同时写入**子树指纹**（自身全部语义字段 + 全部后代指纹的 Merkle
 * 组合，存模块私有 WeakMap，不污染节点形状 / toEqual / 序列化）。文件树的 memo
 * 比较器（fileTreeNodeProps.ts）据此 O(1) 判定「子树是否变化」——后代任何投影
 * 变化都会逐层反映到祖先指纹，祖先重渲染把新节点对象送达子节点，避免
 * 「父 memo 剪枝 → 子节点 stale」。
 */
export function buildFileTreeView(
  dirs: Record<string, FileNode[]>,
  expandedDirs: Set<string>,
  input: FileTreeViewInput = {},
  decorate?: (path: string, isDir: boolean) => NodeGitStatusInput | null,
): FileTreeViewNode[] {
  const root = dirs[''] ?? [];
  return root.map((node) => attachChildren(node, dirs, expandedDirs, input, decorate));
}

/** `decorate` 回调的返回形状（gitFileDecoration.resolveNodeStatus 的投影子集） */
export type NodeGitStatusInput = {
  status: FileTreeGitStatus | null;
  ignored: boolean;
};

/** 子树指纹表：键为组装产出的节点对象（每次组装新建），值为其 Merkle 指纹 */
const subtreeFingerprints = new WeakMap<object, string>();

/**
 * 读取节点的子树指纹；非 `buildFileTreeView` 产出的节点返回 ''（空串互相等值，
 * 仅影响手动构造节点的测试场景——生产树全部经组装产出）。
 */
export function viewNodeFingerprint(node: FileNode): string {
  return subtreeFingerprints.get(node) ?? '';
}

function attachChildren(
  node: FileNode,
  dirs: Record<string, FileNode[]>,
  expandedDirs: Set<string>,
  input: FileTreeViewInput,
  decorate?: (path: string, isDir: boolean) => NodeGitStatusInput | null,
): FileTreeViewNode {
  if (!node.is_dir || !expandedDirs.has(node.path)) {
    return finalizeNode({ ...node, children: [] }, expandedDirs, input, decorate);
  }
  const children = dirs[node.path] ?? [];
  const viewChildren = children.map((child) =>
    attachChildren(child, dirs, expandedDirs, input, decorate),
  );
  return finalizeNode({ ...node, children: viewChildren }, expandedDirs, input, decorate);
}

/** 盖章（git 投影 + 逐节点视图状态）+ 后序计算子树指纹（自底向上组合） */
function finalizeNode(
  node: FileTreeViewNode,
  expandedDirs: Set<string>,
  input: FileTreeViewInput,
  decorate?: (path: string, isDir: boolean) => NodeGitStatusInput | null,
): FileTreeViewNode {
  const stamped = decorate?.(node.path, node.is_dir) ?? null;
  if (stamped) {
    if (stamped.status) node.git_status = stamped.status;
    if (stamped.ignored) node.is_ignored = true;
  }
  // S5：后端读层原生标注的 ignored（git 分层规则）并入灰显投影
  if (node.ignored) node.is_ignored = true;
  // 逐节点视图状态：字段只在命中/非默认时写入，保持节点形状最小
  if (input.activeFilePath && input.activeFilePath === node.path) node.is_active = true;
  if (input.selectedPath && input.selectedPath === node.path) node.is_selected = true;
  if (node.is_dir) {
    if (expandedDirs.has(node.path)) node.is_expanded = true;
    const dirState = input.dirLoadStates?.[node.path];
    if (dirState && dirState !== 'idle') node.dir_state = dirState;
    if (input.creating?.dirPath === node.path) {
      node.creating_input = { kind: input.creating.kind, value: input.creatingValue ?? '' };
    }
  }
  if (input.renaming?.path === node.path) node.renaming_name = input.renaming.name;

  // 子指纹用 \u0001 分隔（避免 [X, Y] 兄弟与 [X → Y] 链的拼接碰撞），保持注入性。
  const childFps = node.children.map((c) => subtreeFingerprints.get(c) ?? '').join('\u0001');
  subtreeFingerprints.set(node, computeSubtreeFingerprint(node, childFps));
  return node;
}

/**
 * 子树指纹计算（finalizeNode 与包视图合并共用）：自身全部语义字段 + 已组装的
 * 后代指纹。调用方保证 children 指纹先就绪（后序），合并节点自底向上打戳。
 */
export function computeSubtreeFingerprint(node: FileTreeViewNode, childFps: string): string {
  return `${node.is_dir ? 1 : 0}|${node.git_status ?? ''}|${node.is_ignored ? 1 : 0}|${
    node.is_active ? 1 : 0
  }|${node.is_selected ? 1 : 0}|${node.is_expanded ? 1 : 0}|${node.dir_state ?? ''}|${
    node.creating_input ? `${node.creating_input.kind}:${node.creating_input.value}` : ''
  }|${node.renaming_name ?? ''}|${childFps}`;
}

/** 为组装外新建的视图节点（如包视图合并行）补打子树指纹（memo 比较器依赖）。 */
export function stampSubtreeFingerprint(node: FileTreeViewNode): FileTreeViewNode {
  const childFps = node.children.map((c) => subtreeFingerprints.get(c) ?? '').join('\u0001');
  subtreeFingerprints.set(node, computeSubtreeFingerprint(node, childFps));
  return node;
}

// ─── S4：视图树 → 扁平行（窗口虚拟化的数据面）────────────────────────────────

/** 扁平行种类：普通行 / 内联重命名行（替换本行，子树不渲染）/ 内联新建行（子列表首位） */
export type FlatFileTreeRow =
  | { kind: 'node'; node: FileTreeViewNode; depth: number }
  | { kind: 'renaming'; node: FileTreeViewNode; depth: number }
  | { kind: 'creating'; node: FileTreeViewNode; depth: number };

/** 行稳定键：路径 + 种类（同一目录可同时存在 creating 行与 node 行） */
export function flatRowKey(row: FlatFileTreeRow): string {
  return `${row.kind}:${row.node.path}`;
}

/**
 * 沿「已展开路径」按渲染顺序摊平视图树。与原 FileTreeNode 递归结构一一对应：
 * renaming 命中 → 本行替换为输入行且子树不渲染；creating 命中 → 输入行插在本行
 * 之后、children 之前。纯函数，随 viewTree useMemo 一次计算。
 */
export function flattenFileTreeView(nodes: FileTreeViewNode[]): FlatFileTreeRow[] {
  const rows: FlatFileTreeRow[] = [];
  const walk = (list: FileTreeViewNode[], depth: number) => {
    for (const node of list) {
      if (node.renaming_name !== undefined) {
        rows.push({ kind: 'renaming', node, depth });
        continue;
      }
      rows.push({ kind: 'node', node, depth });
      if (node.creating_input) {
        rows.push({ kind: 'creating', node, depth });
      }
      if (node.children.length > 0) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(nodes, 0);
  return rows;
}

/** Generate a unique tab ID from project ID and file path */
export function getTabId(projectId: string, filePath: string): string {
  return `${projectId}:${filePath}`;
}

/** Extract file name from path */
export function getFileName(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() || filePath;
}

/** Type guard: narrow Tab to file kind */
export function isFileTab(tab: Tab): tab is Tab & { data: FileTabData } {
  return tab.data.kind === 'file';
}

/** Type guard: file tab with unsaved changes（关闭确认 / 退出警示共用） */
export function isDirtyFileTab(tab: Tab): tab is Tab & { data: FileTabData } {
  return isFileTab(tab) && tab.data.isDirty;
}

/** 文件 tab 展示名：untitled 用 untitledName，否则 fileName，兜底 Untitled */
export function getTabDisplayName(tab: Tab & { data: FileTabData }): string {
  return tab.data.untitledName ?? tab.data.fileName ?? 'Untitled';
}

/** 检查文件是否为 HTML 文件 */
export function isHtmlFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext === 'html' || ext === 'htm';
}

/** 纯文本文档（AI 翻译视图适用） */
export function isTxtFile(filePath: string): boolean {
  return filePath.split('.').pop()?.toLowerCase() === 'txt';
}

/** 检查文件是否为 SVG 文件（文本格式，可读入 content 走 srcDoc 预览） */
export function isSvgFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext === 'svg';
}

/** 检查文件是否为 JSON 文件（.jsonc 含注释无法 JSON.parse，不提供格式化预览） */
export function isJsonFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext === 'json';
}

/** 二进制图片扩展名集合（svg 是文本格式，不在此列） */
const BINARY_IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'avif',
  'ico',
]);

/** 检查文件是否为二进制图片文件（走 asset URL 预览，content 为空） */
export function isImageFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext !== undefined && BINARY_IMAGE_EXTENSIONS.has(ext);
}
