import { useEffect, useRef } from 'react';

import { VirtualList } from '@/shared/components/VirtualList';
import type { VirtualListHandle } from '@/shared/components/VirtualList';
import type { FileTreeViewNode } from '@/shared/types';
import { flatRowKey, type FlatFileTreeRow } from '@/shared/utils/fileTree';

import FileTreeRow from './FileTreeRow';

/** VirtualList 首帧测量前的容器尺寸兜底（模块级常量，避免内联对象逐渲染新建） */
const INITIAL_LIST_RECT: { width: number; height: number } = { width: 600, height: 1200 };

interface FileTreeListProps {
  /** 扁平行（已展开路径按渲染顺序），交 VirtualList 窗口化渲染 */
  rows: FlatFileTreeRow[];
  /** 当前选中节点路径（驱动定位滚动；行未组装时跳过，待 rows 到位后重滚） */
  selectedPath: string | null;
  /** 首次加载（根无内容且 loading）显示全面板 Loading */
  isLoading: boolean;
  /** 加载失败且无内容显示重试 */
  loadFailed: boolean;
  /** 拖拽文件时传给 sendToAgent */
  projectId: string | null;
  onSelectFile: (filePath: string) => void;
  onToggleDir: (path: string) => void;
  /** 目录加载失败时点击重试（触发 store.loadDir 重新请求） */
  onRetryDir: (path: string) => void;
  /** 根目录加载失败的重试按钮 */
  onRefresh: () => void;
  onContextMenu: (position: { x: number; y: number }, node: FileTreeViewNode) => void;
  onSelectNode: (path: string, isDir: boolean) => void;
  onCreatingValueChange: (value: string) => void;
  onCreatingSubmit: () => void;
  onCreatingCancel: () => void;
  onRenamingChange: (value: string) => void;
  onRenamingSubmit: () => void;
  onRenamingCancel: () => void;
}

/**
 * 文件树列表（S4 虚拟化窗口）：loading / error / empty 三态 + VirtualList 行渲染。
 * 定位滚动在此收口 —— 虚拟化后目标行可能未挂载，scrollIntoView 不可靠，经 handle
 * 滚到目标行。仅在选中目标**变化**时滚动（rows 重建不重滚，避免 git 刷新/内联击键
 * 把视口拽回选中行）；目标行已在可见窗口内时不滚（保持旧版 scrollIntoView
 * block:'nearest' 语义：下方目标贴底、上方目标贴顶，各取最小滚动）。
 */
function FileTreeList({
  rows,
  selectedPath,
  isLoading,
  loadFailed,
  projectId,
  onSelectFile,
  onToggleDir,
  onRetryDir,
  onRefresh,
  onContextMenu,
  onSelectNode,
  onCreatingValueChange,
  onCreatingSubmit,
  onCreatingCancel,
  onRenamingChange,
  onRenamingSubmit,
  onRenamingCancel,
}: FileTreeListProps) {
  const listHandleRef = useRef<VirtualListHandle | null>(null);
  const visibleRangeRef = useRef<[number, number] | null>(null);
  const prevSelectedPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedPath || selectedPath === prevSelectedPathRef.current) return;
    const idx = rows.findIndex((r) => r.node.path === selectedPath);
    // 行尚未组装（祖先目录内容懒加载未到）→ 不记 prev，待 rows 到位后下一轮 effect 再滚
    if (idx < 0) return;
    prevSelectedPathRef.current = selectedPath;
    const range = visibleRangeRef.current;
    if (range && idx >= range[0] && idx < range[1]) return;
    const align = range ? (idx < range[0] ? 'start' : 'end') : 'center';
    listHandleRef.current?.scrollToIndex(idx, align);
  }, [selectedPath, rows]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <span className="text-[var(--font-size)] text-text-secondary">Loading...</span>
      </div>
    );
  }
  if (loadFailed) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4">
        <span className="text-[var(--font-size)] text-text-secondary">Failed to load files</span>
        <button
          type="button"
          onClick={onRefresh}
          className="text-[var(--font-size)] text-accent hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <span className="text-[var(--font-size)] text-text-secondary">No files found</span>
      </div>
    );
  }
  return (
    <VirtualList
      items={rows}
      getKey={flatRowKey}
      estimateSize={20}
      overscan={10}
      className="flex-1 min-h-0 overflow-x-hidden"
      initialRect={INITIAL_LIST_RECT}
      handleRef={listHandleRef}
      onRangeChange={(start, end) => {
        visibleRangeRef.current = [start, end];
      }}
      renderItem={(row) => (
        <FileTreeRow
          row={row}
          projectId={projectId}
          onSelectFile={onSelectFile}
          onToggleDir={onToggleDir}
          onRetryDir={onRetryDir}
          onContextMenu={onContextMenu}
          onSelectNode={onSelectNode}
          onCreatingValueChange={onCreatingValueChange}
          onCreatingSubmit={onCreatingSubmit}
          onCreatingCancel={onCreatingCancel}
          onRenamingChange={onRenamingChange}
          onRenamingSubmit={onRenamingSubmit}
          onRenamingCancel={onRenamingCancel}
        />
      )}
    />
  );
}

export default FileTreeList;
