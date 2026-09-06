import type { FileTreeViewNode } from '@/shared/types';
import { viewNodeFingerprint, type FlatFileTreeRow } from '@/shared/utils/fileTree';

/**
 * FileTreeRow 的 props 契约与 memo 比较器（S3/S4 渲染隔离承重墙）。
 *
 * S4 扁平化后行与行之间无父子元素关系——「父 bail out 断供子 props」问题在
 * 结构上消失，比较器只需判定本行语义是否变化：row.kind + node 子树指纹 +
 * depth + projectId + 稳定回调身份。指纹仍由组装期写入（后代变化逐层反映
 * 到祖先，ancestor 行的 node 是新对象、指纹变化）。
 */
export interface FileTreeRowProps {
  row: FlatFileTreeRow;
  projectId: string | null;
  onSelectFile: (path: string) => void;
  onToggleDir: (path: string) => void;
  /** 目录加载失败时点击重试（触发 store.loadDir 重新请求） */
  onRetryDir?: (path: string) => void;
  onContextMenu?: (position: { x: number; y: number }, node: FileTreeViewNode) => void;
  /** 选中节点（用于 Delete 按钮） */
  onSelectNode?: (path: string, isDir: boolean) => void;
  onCreatingValueChange?: (value: string) => void;
  /**
   * 提交/重命名提交回调闭包引用击键状态，身份每次击键变化。
   * 刻意不比较：仅「输入行」消费，而该行 node 的 creating_input / renaming_name
   * 随击键变化 → 指纹变化 → 必然重渲染拿到新闭包，陈旧闭包不可达。
   */
  onCreatingSubmit?: () => void;
  onCreatingCancel?: () => void;
  onRenamingChange?: (value: string) => void;
  onRenamingSubmit?: () => void;
  onRenamingCancel?: () => void;
}

/** 参与身份比较的回调键（全部为稳定 useCallback / setState 函数） */
const HANDLER_KEYS = [
  'onSelectFile',
  'onToggleDir',
  'onRetryDir',
  'onContextMenu',
  'onSelectNode',
  'onCreatingValueChange',
  'onCreatingCancel',
  'onRenamingChange',
  'onRenamingCancel',
] as const;

export function areFileTreeRowPropsEqual(prev: FileTreeRowProps, next: FileTreeRowProps): boolean {
  const a = prev.row;
  const b = next.row;
  if (a.kind !== b.kind || a.node.path !== b.node.path || a.depth !== b.depth) return false;
  if (viewNodeFingerprint(a.node) !== viewNodeFingerprint(b.node)) return false;
  if (prev.projectId !== next.projectId) return false;
  for (const key of HANDLER_KEYS) {
    if (prev[key] !== next[key]) return false;
  }
  return true;
}
