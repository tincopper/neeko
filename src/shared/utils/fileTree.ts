import type { FileNode, Tab, FileTabData } from '@/shared/types';

/**
 * Merge new children into a file tree at a specific directory path.
 */
export function mergeSubTree(tree: FileNode[], dirPath: string, newChildren: FileNode[]): FileNode[] {
  return tree.map((node) => {
    if (node.path === dirPath) {
      return { ...node, children: newChildren };
    }
    if (node.is_dir && node.children.length > 0 && dirPath.startsWith(node.path + "/")) {
      return { ...node, children: mergeSubTree(node.children, dirPath, newChildren) };
    }
    return node;
  });
}

/** Generate a unique tab ID from project ID and file path */
export function getTabId(projectId: string, filePath: string): string {
  return `${projectId}:${filePath}`;
}

/** Extract file name from path */
export function getFileName(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() || filePath;
}

/** Type guard: narrow Tab to file kind */
export function isFileTab(tab: Tab): tab is Tab & { data: FileTabData } {
  return tab.data.kind === "file";
}
