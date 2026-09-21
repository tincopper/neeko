import React, { useCallback, useEffect, useRef } from 'react';

import { ChevronRight } from '@/shared/components/icons';
import type { FileTreeViewNode } from '@/shared/types';
import { fileIconSrc } from '@/shared/utils/fileIcons';
import { statusToNameColorClass } from '@/shared/utils/gitFileDecoration';

import { setDragFile } from '../hooks/useFileDrop';
import { disposeDragGhost, setDragGhost } from '../utils/dragGhost';

import { areFileTreeRowPropsEqual } from './fileTreeRowProps';
import type { FileTreeRowProps } from './fileTreeRowProps';
import InlineNameInput from './InlineNameInput';

/** 行图标 URL（JSX 与拖影共用）：目录用展开/折叠文件夹，文件用 fileIconSrc。 */
function nodeIconSrc(node: FileTreeViewNode): string {
  return node.is_dir
    ? `/icons/${node.is_expanded ? '_folder_open' : '_folder'}.svg`
    : fileIconSrc(node.name);
}

/**
 * 文件树单行组件（S4 虚拟化）：无递归——可见行由 FilesPanel 经
 * flattenFileTreeView 摊平后交给 VirtualList 窗口化渲染，本组件只渲染一行
 * （node / renaming / creating 三种行）。git 状态与视图状态由组装期盖章在
 * node 上（S3），名字色经 statusToNameColorClass 派生。
 *
 * 渲染隔离由 areFileTreeRowPropsEqual（子树指纹）承担，见 fileTreeRowProps.ts。
 */
function FileTreeRow({
  row,
  projectId,
  onSelectFile,
  onToggleDir,
  onRetryDir,
  onContextMenu,
  onSelectNode,
  onCreatingValueChange,
  onCreatingSubmit,
  onCreatingCancel,
  onRenamingChange,
  onRenamingSubmit,
  onRenamingCancel,
}: FileTreeRowProps) {
  const { node, depth } = row;
  const isExpanded = node.is_expanded === true;
  const isActive = node.is_active === true;
  const isSelected = node.is_selected === true;
  const isLoadingChildren = node.dir_state === 'loading';
  const isLoadError = node.dir_state === 'error';
  const indent = 4 + depth * 12;

  // 定位联动：选中行滚动到可见（虚拟化下的可靠定位由 FilesPanel 的
  // scrollToIndex 承担；本 effect 兜底行已挂载时的精确定位）。
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

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (!projectId) return;
      e.dataTransfer.effectAllowed = 'copy';
      setDragFile(node.path, projectId);
      // 自定义拖影（去 chevron 等行内 UI 装饰），图标尺寸与行内一致
      setDragGhost(e.dataTransfer, {
        iconUrl: nodeIconSrc(node),
        label: node.name,
        iconSize: node.is_dir ? 16 : 14,
      });
    },
    [projectId, node],
  );

  if (row.kind === 'renaming') {
    return (
      <InlineNameInput
        kind={node.is_dir ? 'dir' : 'file'}
        value={node.renaming_name ?? ''}
        onChange={onRenamingChange}
        onSubmit={onRenamingSubmit}
        onCancel={onRenamingCancel}
        indent={indent}
        selectOnMount
        commitOnBlur
      />
    );
  }

  if (row.kind === 'creating') {
    return (
      <InlineNameInput
        kind={node.creating_input?.kind ?? 'file'}
        value={node.creating_input?.value ?? ''}
        onChange={onCreatingValueChange}
        onSubmit={onCreatingSubmit}
        onCancel={onCreatingCancel}
        indent={4 + (depth + 1) * 12}
      />
    );
  }

  // 装饰色：优先级链（激活 > 状态 > 忽略 > 默认）单处收敛在 gitFileDecoration
  const nameColorClass = statusToNameColorClass(
    node.git_status,
    node.is_ignored === true,
    isActive,
  );

  return (
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
      onDragEnd={disposeDragGhost}
      onClick={(e) => {
        // 阻止冒泡到树容器：容器空白点击才选中项目根，节点点击只选中自身
        e.stopPropagation();
        handleClick();
      }}
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
            src={nodeIconSrc(node)}
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
              className="w-2 h-2 rounded-full bg-accent-red ml-1 p-0 border-0 cursor-pointer"
              title="加载失败，点击重试"
              aria-label={`重新加载 ${node.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onRetryDir?.(node.path);
              }}
            />
          )}
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
  );
}

export default React.memo(FileTreeRow, areFileTreeRowPropsEqual);
