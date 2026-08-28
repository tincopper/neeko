import React, { useState, useCallback, useMemo } from 'react';

import { cn } from '@/lib/utils';
import type { FileChange } from '@/shared/types';
import { fileIconSrc } from '@/shared/utils/fileIcons';
import { buildFileSummaryMap, resolveDecoration } from '@/shared/utils/gitFileDecoration';
import type { Decoration, GitStatusSummary } from '@/shared/utils/gitFileDecoration';
import { Badge } from '@/ui/Badge';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FileStatus =
  | 'added'
  | 'removed'
  | 'modified'
  | 'renamed'
  | 'modified_count'
  | 'added_count'
  | 'removed_count';

export interface ChangeFileItem {
  path: string;
  status: FileStatus;
  additions?: number;
  deletions?: number;
}

export interface ChangeTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: ChangeTreeNode[];
}

// ─── Tree Building ────────────────────────────────────────────────────────────

export function buildChangeTree(files: ChangeFileItem[]): ChangeTreeNode[] {
  const root: ChangeTreeNode = { name: '', path: '', isDir: true, children: [] };

  for (const file of files) {
    const parts = file.path.replace(/\\/g, '/').split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          isDir: !isLast,
          children: [],
        };
        node.children.push(child);
      }
      node = child;
    }
  }

  // Sort: directories first, then by name
  const sort = (nodes: ChangeTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);

  return root.children;
}

// ─── 装饰投影（词表唯一源：gitFileDecoration；组件不再私持颜色/徽标对照表）────

/** ChangeFileItem 的 lowercase 同义词 → FileChange 状态词表（词表归一由模块承接） */
function toFileChangeStatus(status: FileStatus): FileChange['status'] {
  switch (status) {
    case 'added':
    case 'added_count':
      return 'Added';
    case 'modified':
    case 'modified_count':
      return 'Modified';
    case 'renamed':
      return 'Renamed';
    default:
      // removed | removed_count
      return 'Deleted';
  }
}

/** 目录摘要恒为空：目录行不参与状态展示（展示语义与收敛前保持一致） */
const EMPTY_FOLDER_SUMMARIES: Map<string, GitStatusSummary> = new Map();

/** 输入列表 → path 摘要 map（monoid 合并由模块处理） */
function buildChangeSummaries(files: ChangeFileItem[]): Map<string, GitStatusSummary> {
  return buildFileSummaryMap(
    files.map((f) => ({
      path: f.path,
      status: toFileChangeStatus(f.status),
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
    })),
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ChangeFileTreeProps {
  files: ChangeFileItem[];
  onFileClick?: (path: string) => void;
  selectedPath?: string | null;
  showStatusDot?: boolean;
  showBadge?: boolean;
  className?: string;
}

const ChangeFileTree: React.FC<ChangeFileTreeProps> = ({
  files,
  onFileClick,
  selectedPath,
  showStatusDot = true,
  showBadge = true,
  className,
}) => {
  const tree = useMemo(() => buildChangeTree(files), [files]);
  // 装饰派生：叶子行按 path 从投影取色/徽标/圆点（统一词表，与主 Explorer 一致）
  const summaries = useMemo(() => buildChangeSummaries(files), [files]);

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center p-4 text-[var(--font-size)] text-text-muted">
        No files changed
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {tree.map((node) => (
        <TreeNodeComponent
          key={node.path}
          node={node}
          depth={0}
          summaries={summaries}
          onFileClick={onFileClick}
          selectedPath={selectedPath}
          showStatusDot={showStatusDot}
          showBadge={showBadge}
        />
      ))}
    </div>
  );
};

// ─── Tree Node Component ──────────────────────────────────────────────────────

interface TreeNodeComponentProps {
  node: ChangeTreeNode;
  depth: number;
  onFileClick?: (path: string) => void;
  selectedPath?: string | null;
  showStatusDot: boolean;
  showBadge: boolean;
  /** path → 状态摘要：叶子装饰解析输入（引用稳定，memo 友好） */
  summaries: Map<string, GitStatusSummary>;
}

const TreeNodeComponent: React.FC<TreeNodeComponentProps> = React.memo(
  ({ node, depth, onFileClick, selectedPath, showStatusDot, showBadge, summaries }) => {
    const [expanded, setExpanded] = useState(true);
    const indent = 6 + depth * 12;

    const handleToggle = useCallback(() => {
      setExpanded((v) => !v);
    }, []);

    const handleClick = useCallback(() => {
      if (node.isDir) {
        handleToggle();
      } else if (onFileClick) {
        onFileClick(node.path);
      }
    }, [node.isDir, node.path, handleToggle, onFileClick]);

    if (node.isDir) {
      return (
        <div>
          <div
            role="treeitem"
            tabIndex={-1}
            aria-selected={false}
            className="flex items-center gap-1.5 py-0.5 pr-2 text-[var(--font-size)] cursor-pointer rounded transition-colors duration-100 select-none min-w-0 hover:bg-bg-hover"
            style={{ paddingLeft: indent }}
            onClick={handleClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClick();
              }
            }}
            title={node.path}
          >
            <img
              className="w-4 h-4 shrink-0 block"
              src={`/icons/${!expanded ? '_folder' : '_folder_open'}.svg`}
              alt=""
              width={16}
              height={16}
            />
            <span className="flex-1 text-text-primary font-medium truncate">{node.name}</span>
            <span className="text-[calc(var(--font-size)-2px)] text-text-muted">
              {node.children.length}
            </span>
          </div>
          {expanded &&
            node.children.map((child) => (
              <TreeNodeComponent
                key={child.path}
                node={child}
                depth={depth + 1}
                onFileClick={onFileClick}
                selectedPath={selectedPath}
                showStatusDot={showStatusDot}
                showBadge={showBadge}
                summaries={summaries}
              />
            ))}
        </div>
      );
    }

    const decoration: Decoration | null = resolveDecoration(
      node.path,
      false,
      summaries,
      EMPTY_FOLDER_SUMMARIES,
      undefined,
      false,
    );
    const isSelected = selectedPath === node.path;

    return (
      <div
        role="treeitem"
        tabIndex={-1}
        aria-selected={isSelected}
        className={cn(
          'flex items-center gap-1.5 py-0.5 pr-2 text-[var(--font-size)] cursor-pointer rounded transition-colors duration-100 select-none min-w-0 group',
          isSelected ? 'bg-accent-blue/10' : 'hover:bg-bg-hover',
        )}
        style={{ paddingLeft: indent }}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        title={node.path}
      >
        <img
          className="w-4 h-4 shrink-0 block opacity-70"
          src={fileIconSrc(node.name)}
          alt=""
          width={16}
          height={16}
        />
        <span className={`flex-1 truncate ${decoration?.color ?? 'group-hover:text-text-primary'}`}>
          {node.name}
        </span>
        {showStatusDot && decoration?.dot && (
          <span
            data-testid="status-dot"
            className={cn('w-1.5 h-1.5 rounded-full shrink-0', decoration.dot)}
          />
        )}
        {showBadge && decoration?.badge && (
          <Badge variant={decoration.variant ?? 'default'}>{decoration.badge}</Badge>
        )}
      </div>
    );
  },
);

TreeNodeComponent.displayName = 'TreeNodeComponent';

export default React.memo(ChangeFileTree);
