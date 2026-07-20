/**
 * Flatten FileNode trees into searchable path lists for Goto File.
 */
import type { FileNode } from '@/shared/types';

export function flattenFilePaths(nodes: FileNode[], prefix = ''): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    const path = prefix ? `${prefix}/${n.name}` : n.name;
    // Prefer node.path when absolute-ish relative already provided
    const filePath = n.path || path;
    if (n.is_dir) {
      if (n.children?.length) {
        out.push(...flattenFilePaths(n.children, filePath));
      }
    } else {
      out.push(filePath.replace(/\\/g, '/'));
    }
  }
  return out;
}

/** Strip leading project root noise if present. */
export function normalizeProjectRelative(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}
