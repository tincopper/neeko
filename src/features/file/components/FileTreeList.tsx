import React, { useEffect, useRef } from 'react';

import { VirtualList } from '@/shared/components/VirtualList';
import type { VirtualListHandle } from '@/shared/components/VirtualList';
import type { FileTreeViewNode } from '@/shared/types';
import { flatRowKey, type FlatFileTreeRow } from '@/shared/utils/fileTree';

import { isPanelInteractiveTarget } from '../utils/fileTreeUtils';

import FileTreeRow from './FileTreeRow';

/** VirtualList 首帧测量前的容器尺寸兜底（模块级常量，避免内联对象逐渲染新建） */
const INITIAL_LIST_RECT: { width: number; height: number } = { width: 600, height: 1200 };

interface FileTreeListProps {
  /** 扁平行（已展开路径按渲染顺序），交 VirtualList 窗口化渲染 */
  rows: FlatFileTreeRow[];
  /** 当前选中节点路径（驱动定位滚动；行未组装时跳过，待 rows 到位后重滚） */
  selectedPath: string | null;
  /** 显式定位信号：locateFile 每次调用（定位按钮/自动定位共用入口）递增；未消费
   *  的信号令「目标已是选中项」的重复定位仍触发滚动 */
  locateSignal: number;
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
  /** 点击树空白区域选中项目根（新建文件/目录目标回到根） */
  onSelectRoot: () => void;
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
 * 滚到目标行。两类触发：① 选中目标变化（点击/首次定位）；② locateSignal 出现未
 * 消费的显式定位请求 —— 目标已是选中项时选中不再变化，按钮的重复定位必须靠信号
 * 通道触发（按钮与自动定位共用 locateFile 入口，每次调用递增）。
 * rows 重建（git 刷新/内联击键）不重滚：无显式请求且选中不变时早退，避免把视口
 * 拽回选中行；目标行已在可见窗口内时不滚（保持旧版 scrollIntoView block:'nearest'
 * 语义：下方目标贴底、上方目标贴顶，各取最小滚动）；行未组装（懒加载未到）时
 * 不消费信号、不记 prev，待 rows 到位后补滚。
 */
function FileTreeList({
  rows,
  selectedPath,
  locateSignal,
  isLoading,
  loadFailed,
  projectId,
  onSelectFile,
  onToggleDir,
  onRetryDir,
  onRefresh,
  onContextMenu,
  onSelectNode,
  onSelectRoot,
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
  // 最近一次已消费的显式定位信号（与 locateSignal 同初始 0：首渲染不触发显式滚动）
  const lastConsumedLocateSeqRef = useRef(0);
  useEffect(() => {
    const explicit = locateSignal !== lastConsumedLocateSeqRef.current;
    const selectionChanged = selectedPath !== prevSelectedPathRef.current;
    if (!selectedPath || (!explicit && !selectionChanged)) return;
    const idx = rows.findIndex((r) => r.node.path === selectedPath);
    // 行尚未组装（祖先目录内容懒加载未到）→ 不消费 seq、不记 prev，待 rows 到位后补滚
    if (idx < 0) return;
    prevSelectedPathRef.current = selectedPath;
    lastConsumedLocateSeqRef.current = locateSignal;
    const range = visibleRangeRef.current;
    if (range && idx >= range[0] && idx < range[1]) return;
    const align = range ? (idx < range[0] ? 'start' : 'end') : 'center';
    listHandleRef.current?.scrollToIndex(idx, align);
  }, [selectedPath, rows, locateSignal]);

  let content: React.ReactNode;
  if (isLoading) {
    content = (
      <div className="flex-1 flex items-center justify-center p-4">
        <span className="text-[var(--font-size)] text-text-secondary">Loading...</span>
      </div>
    );
  } else if (loadFailed) {
    content = (
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
  } else if (rows.length === 0) {
    content = (
      <div className="flex-1 flex items-center justify-center p-4">
        <span className="text-[var(--font-size)] text-text-secondary">No files found</span>
      </div>
    );
  } else {
    content = (
      <VirtualList
        items={rows}
        getKey={flatRowKey}
        estimateSize={20}
        overscan={10}
        className="flex-1 min-h-0 overflow-x-hidden pb-8"
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

  return (
    // 点击空白区域（节点行 onClick 已 stopPropagation）选中项目根，使头部新建
    // 文件/目录目标回到根 —— 否则选中节点后无法在根目录新建。
    // role=presentation 遵循项目空白点击先例（SettingsPanel/OverlayPanel）；
    // 内含 treeitem（可聚焦后代）时 presentation 语义被 UA 忽略，树不扁平化。
    <div
      data-testid="file-tree-empty-area"
      className="flex flex-col flex-1 min-h-0"
      role="presentation"
      onClick={(e) => {
        // 节点行已 stopPropagation；新建/重命名输入等交互控件经共享判定排除，
        // 避免聚焦输入时误清选中
        if (isPanelInteractiveTarget(e.target as HTMLElement)) return;
        onSelectRoot();
      }}
    >
      {content}
    </div>
  );
}

export default FileTreeList;
