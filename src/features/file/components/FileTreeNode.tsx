import React, { useCallback, useEffect, useRef } from 'react';

import { ChevronRight } from '@/shared/components/icons';
import type { DirLoadState, FileNode } from '@/shared/types';
import { fileIconSrc } from '@/shared/utils/fileIcons';
import type { Decoration, ResolveNodeDecoration } from '@/shared/utils/gitFileDecoration';

import { setDragFile } from '../hooks/useFileDrop';

import InlineNameInput from './InlineNameInput';

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  activeFilePath: string | null;
  expandedDirs: Set<string>;
  /** 目录加载状态机（来自 file store）：驱动 loading spinner 与 error 重试提示 */
  dirLoadStates: Record<string, DirLoadState>;
  projectId: string | null;
  onSelectFile: (path: string) => void;
  onToggleDir: (path: string) => void;
  /** 目录加载失败时点击重试（触发 store.loadDir 重新请求） */
  onRetryDir?: (path: string) => void;
  onContextMenu?: (position: { x: number; y: number }, node: FileNode) => void;
  /** 选中节点（用于 Delete 按钮） */
  onSelectNode?: (path: string, isDir: boolean) => void;
  /** 当前选中节点路径（高亮显示） */
  selectedPath?: string | null;
  /** 新建文件/目录的内联输入状态 */
  creating?: { dirPath: string; kind: 'file' | 'dir' } | null;
  creatingValue?: string;
  onCreatingValueChange?: (value: string) => void;
  onCreatingSubmit?: () => void;
  onCreatingCancel?: () => void;
  /** 重命名状态 */
  renaming?: { path: string; isDir: boolean; name: string } | null;
  onRenamingChange?: (value: string) => void;
  onRenamingSubmit?: () => void;
  onRenamingCancel?: () => void;
  /**
   * 当前节点的 git 状态装饰（由父级解析后传入，P3 下传策略）。
   * 结构等值时沿用上一实例：未受影响节点在 git 高频刷新期间不重渲染。
   */
  decoration?: Decoration | null;
  /**
   * 单节点装饰解析回调（身份恒定）：展开目录时为每个直接子节点解析后逐一传入。
   * 不再下传整张 map 或祖先谓词 —— memo 按「单节点装饰值」粒度生效。
   */
  resolveDecorationFor?: ResolveNodeDecoration;
}

function FileTreeNode({
  node,
  depth,
  activeFilePath,
  expandedDirs,
  dirLoadStates,
  projectId,
  onSelectFile,
  onToggleDir,
  onRetryDir,
  onContextMenu,
  onSelectNode,
  selectedPath,
  creating,
  creatingValue,
  onCreatingValueChange,
  onCreatingSubmit,
  onCreatingCancel,
  renaming,
  onRenamingChange,
  onRenamingSubmit,
  onRenamingCancel,
  decoration,
  resolveDecorationFor,
}: FileTreeNodeProps) {
  const isExpanded = expandedDirs.has(node.path);
  const isActive = activeFilePath === node.path;
  const isSelected = selectedPath === node.path;
  const dirState = dirLoadStates[node.path];
  const isLoadingChildren = dirState === 'loading';
  const isLoadError = dirState === 'error';

  // 定位联动：复用「点击选中」同一状态 —— 节点被选中（selectedPath 命中）时
  // 滚动到可见。定位按钮与手动点击都走 selectedNode → isSelected，样式一致。
  const nodeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (isSelected) {
      nodeRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [isSelected, node.path]);

  const handleClick = useCallback(() => {
    onSelectNode?.(node.path, node.is_dir);
    if (node.is_dir) {
      onToggleDir(node.path);
    } else {
      onSelectFile(node.path);
    }
  }, [node.is_dir, node.path, onSelectFile, onToggleDir, onSelectNode]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu?.({ x: e.clientX, y: e.clientY }, node);
    },
    [node, onContextMenu],
  );

  const indent = 4 + depth * 12;

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (!projectId) return;
      e.dataTransfer.effectAllowed = 'copy';
      setDragFile(node.path, projectId);
    },
    [node.path, projectId],
  );

  // 装饰色：color 字段已编码最终 class（激活/状态/忽略/默认的优先级在模块内收敛）
  const nameColorClass = decoration?.color ?? 'text-text-primary';

  // 重命名模式：节点行替换为内联输入框（所有 hooks 之后，避免提前 return 破坏 hooks 顺序）
  if (renaming?.path === node.path) {
    return (
      <InlineNameInput
        kind={node.is_dir ? 'dir' : 'file'}
        value={renaming.name}
        onChange={onRenamingChange}
        onSubmit={onRenamingSubmit}
        onCancel={onRenamingCancel}
        indent={indent}
        selectOnMount
        commitOnBlur
      />
    );
  }

  return (
    <>
      <div
        ref={nodeRef}
        role="treeitem"
        tabIndex={-1}
        aria-selected={isActive || isSelected}
        className={`flex items-center gap-1 py-0.5 pr-2 text-[var(--font-size)] cursor-pointer rounded select-none min-w-0 ${
          isActive || isSelected ? 'bg-bg-selected' : 'hover:bg-bg-hover'
        }`}
        style={{ paddingLeft: indent }}
        draggable={!!projectId}
        onDragStart={handleDragStart}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        onContextMenu={handleContextMenu}
        title={node.path}
      >
        {node.is_dir ? (
          <>
            <ChevronRight
              className={`w-3.5 h-3.5 shrink-0 text-text-muted transition-transform duration-150 ${
                isExpanded ? 'rotate-90' : ''
              }`}
            />
            <img
              className="w-4 h-4 shrink-0 block"
              src={`/icons/${isExpanded ? '_folder_open' : '_folder'}.svg`}
              alt=""
              width={16}
              height={16}
            />
            <span className={`flex-1 font-medium truncate ${nameColorClass}`}>{node.name}</span>
            {isLoadingChildren && (
              <span className="shrink-0 w-3 h-3 rounded-full border border-text-muted border-t-transparent animate-spin ml-1" />
            )}
            {isLoadError && (
              <button
                type="button"
                className="shrink-0 w-2 h-2 rounded-full bg-accent-red ml-1 p-0 border-0 cursor-pointer"
                title="加载失败，点击重试"
                aria-label={`重新加载 ${node.name}`}
                onClick={(e) => {
                  // 阻止冒泡到行级 toggle（避免收起/展开），红点只负责触发重试
                  e.stopPropagation();
                  onRetryDir?.(node.path);
                }}
              />
            )}
            {/* 目录 git 状态仅以名字着色表达（需求演进：不再渲染行尾徽标） */}
          </>
        ) : (
          <>
            <span className="w-3.5 h-3.5 shrink-0" />
            <img
              className="w-3.5 h-3.5 shrink-0 block"
              src={fileIconSrc(node.name)}
              alt=""
              width={14}
              height={14}
            />
            <span className={`flex-1 truncate ${isActive ? 'font-medium ' : ''}${nameColorClass}`}>
              {node.name}
            </span>
          </>
        )}
      </div>
      {node.is_dir && isExpanded && (
        <>
          {/* 新建输入行放在子列表第一个位置 */}
          {creating?.dirPath === node.path && (
            <InlineNameInput
              kind={creating.kind}
              value={creatingValue}
              onChange={onCreatingValueChange}
              onSubmit={onCreatingSubmit}
              onCancel={onCreatingCancel}
              indent={4 + (depth + 1) * 12}
            />
          )}
          {node.children.length > 0
            ? node.children.map((child) => (
                <FileTreeNode
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  activeFilePath={activeFilePath}
                  expandedDirs={expandedDirs}
                  dirLoadStates={dirLoadStates}
                  projectId={projectId}
                  onSelectFile={onSelectFile}
                  onToggleDir={onToggleDir}
                  onRetryDir={onRetryDir}
                  onContextMenu={onContextMenu}
                  onSelectNode={onSelectNode}
                  selectedPath={selectedPath}
                  creating={creating}
                  creatingValue={creatingValue}
                  onCreatingValueChange={onCreatingValueChange}
                  onCreatingSubmit={onCreatingSubmit}
                  onCreatingCancel={onCreatingCancel}
                  renaming={renaming}
                  onRenamingChange={onRenamingChange}
                  onRenamingSubmit={onRenamingSubmit}
                  onRenamingCancel={onRenamingCancel}
                  decoration={
                    resolveDecorationFor?.(
                      child.path,
                      child.is_dir,
                      activeFilePath === child.path,
                    ) ?? null
                  }
                  resolveDecorationFor={resolveDecorationFor}
                />
              ))
            : !isLoadingChildren && null}
        </>
      )}
    </>
  );
}

export default React.memo(FileTreeNode);
