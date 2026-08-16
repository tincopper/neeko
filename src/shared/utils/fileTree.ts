import type { FileNode, Tab, FileTabData } from '@/shared/types';

/**
 * 从扁平目录缓存组装嵌套视图树。
 * 仅沿「已展开路径」向下组装 children；未展开目录的 children 截断为空。
 * 数据源 `dirs[path]` 只含一级条目，子目录内容由各自的 `dirs[path]` key 提供 ——
 * 根刷新替换 `dirs['']` 不会影响任何已展开子目录的缓存，根治「展开目录被整树覆盖截断」。
 */
export function buildFileTreeView(
  dirs: Record<string, FileNode[]>,
  expandedDirs: Set<string>,
): FileNode[] {
  const root = dirs[''] ?? [];
  return root.map((node) => attachChildren(node, dirs, expandedDirs));
}

function attachChildren(
  node: FileNode,
  dirs: Record<string, FileNode[]>,
  expandedDirs: Set<string>,
): FileNode {
  if (!node.is_dir || !expandedDirs.has(node.path)) {
    return { ...node, children: [] };
  }
  const children = dirs[node.path] ?? [];
  return {
    ...node,
    children: children.map((child) => attachChildren(child, dirs, expandedDirs)),
  };
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
