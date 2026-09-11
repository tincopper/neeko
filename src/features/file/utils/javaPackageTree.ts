/**
 * Java 包视图（compact middle packages，IDEA 默认行为）。
 *
 * 数据是通用的 `FileTreeViewNode`（`@/shared/types`），本模块只承载
 * **Java 专属**的源根判定与压行规则 —— 故归属 file feature，而非 `shared/utils`
 * （shared 层不应沉淀单一功能的业务语义）。
 */

import type { FileTreeViewNode } from '@/shared/types';
import { stampSubtreeFingerprint } from '@/shared/utils/fileTree';

// ─── 包视图：Java 单子目录链压行（方案A）────────────────────────────────────

/** 路径是否为 Java 源码根自身（`…/src/main/java` / `…/src/test/java`）。 */
export function isJavaSourceRoot(path: string | null | undefined): boolean {
  if (!path) return false;
  return /(^|\/)src\/(main|test)\/java$/.test(path.replace(/\\/g, '/'));
}

/** 路径是否严格位于 Java 源码根之下（`src/main|test/java` 之下至少一段）。
 * 源根自身（`…/src/main/java`）返回 false —— 包行永远挂在源根之下，源根行保留。
 * 纯路径文本判定，不触文件系统。
 */
export function isUnderJavaSourceRoot(path: string | null | undefined): boolean {
  if (!path) return false;
  return /(^|\/)src\/(main|test)\/java\/.+/.test(path.replace(/\\/g, '/'));
}

/**
 * Java 包视图压行（compact middle packages，IDEA 默认行为）。
 *
 * 已加载的单子目录链（`com → tomgs → algorithm`，中间无文件）在源根之下压成
 * 一行（`com.tomgs.algorithm`）；中途有文件 / 多子目录 / 未加载即断链。
 * 合并行 path 取叶子真实路径 —— 展开/选中/右键/git/定位全部按真实路径工作，
 * 下游零改动。合并行补打子树指纹（memo 比较器依赖），原节点对象一律保留。
 */
export function compactJavaPackages(nodes: FileTreeViewNode[]): FileTreeViewNode[] {
  return nodes.map(compactPackageNode);
}

function compactPackageNode(node: FileTreeViewNode): FileTreeViewNode {
  if (!node.is_dir) return node;
  let changed = false;
  const children = node.children.map((c) => {
    const n = compactPackageNode(c);
    if (n !== c) changed = true;
    return n;
  });
  const only = children.length === 1 ? children[0] : null;
  if (
    only !== null &&
    only.is_dir &&
    only.children.length > 0 &&
    isUnderJavaSourceRoot(node.path) &&
    isUnderJavaSourceRoot(only.path)
  ) {
    return stampSubtreeFingerprint({ ...only, name: `${node.name}.${only.name}` });
  }
  if (!changed) return node;
  return stampSubtreeFingerprint({ ...node, children });
}
