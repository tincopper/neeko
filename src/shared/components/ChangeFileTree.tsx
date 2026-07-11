import React, { useState, useCallback } from "react";
import { fileIconSrc } from '@/shared/utils/fileIcons';
import { Badge } from "@/ui/badge";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FileStatus = "added" | "removed" | "modified" | "renamed" | "modified_count" | "added_count" | "removed_count";

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
  file?: ChangeFileItem;
}

// ─── Tree Building ────────────────────────────────────────────────────────────

export function buildChangeTree(files: ChangeFileItem[]): ChangeTreeNode[] {
  const root: ChangeTreeNode = { name: "", path: "", isDir: true, children: [] };

  for (const file of files) {
    const parts = file.path.replace(/\\/g, "/").split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          isDir: !isLast,
          children: [],
          file: isLast ? file : undefined,
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

// ─── Status Config ────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<FileStatus, { label: string; variant: "modified" | "added" | "deleted" | "default" }> = {
  added: { label: "A", variant: "added" },
  removed: { label: "D", variant: "deleted" },
  modified: { label: "M", variant: "modified" },
  renamed: { label: "R", variant: "default" },
  modified_count: { label: "M", variant: "modified" },
  added_count: { label: "A", variant: "added" },
  removed_count: { label: "D", variant: "deleted" },
};

const STATUS_DOT_COLOR: Record<FileStatus, string> = {
  added: "bg-accent-green",
  removed: "bg-accent-red",
  modified: "bg-accent-blue",
  renamed: "bg-accent-yellow",
  modified_count: "bg-accent-blue",
  added_count: "bg-accent-green",
  removed_count: "bg-accent-red",
};

const STATUS_TEXT_COLOR: Record<FileStatus, string> = {
  added: "text-accent-green",
  removed: "text-accent-red",
  modified: "text-text-primary",
  renamed: "text-text-primary",
  modified_count: "text-text-primary",
  added_count: "text-accent-green",
  removed_count: "text-accent-red",
};

// ─── Component ────────────────────────────────────────────────────────────────

interface ChangeFileTreeProps {
  files: ChangeFileItem[];
  onFileClick?: (path: string) => void;
  showStatusDot?: boolean;
  showBadge?: boolean;
  className?: string;
}

const ChangeFileTree: React.FC<ChangeFileTreeProps> = ({
  files,
  onFileClick,
  showStatusDot = true,
  showBadge = true,
  className,
}) => {
  const tree = React.useMemo(() => buildChangeTree(files), [files]);

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center p-4 text-[var(--font-size)] text-text-muted">
        No files changed
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {tree.map((node) => (
        <TreeNodeComponent
          key={node.path}
          node={node}
          depth={0}
          onFileClick={onFileClick}
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
  showStatusDot: boolean;
  showBadge: boolean;
}

const TreeNodeComponent: React.FC<TreeNodeComponentProps> = React.memo(({
  node,
  depth,
  onFileClick,
  showStatusDot,
  showBadge,
}) => {
  const [expanded, setExpanded] = useState(true);
  const indent = 6 + depth * 12;

  const handleToggle = useCallback(() => {
    setExpanded((v) => !v);
  }, []);

  const handleClick = useCallback(() => {
    if (node.isDir) {
      handleToggle();
    } else if (node.file && onFileClick) {
      onFileClick(node.file.path);
    }
  }, [node, handleToggle, onFileClick]);

  if (node.isDir) {
    return (
      <div>
        <div
          className="flex items-center gap-1.5 py-0.5 pr-2 text-[var(--font-size)] cursor-pointer rounded transition-colors duration-100 select-none min-w-0 hover:bg-bg-hover"
          style={{ paddingLeft: indent }}
          onClick={handleClick}
          title={node.path}
        >
          <img
            className="w-4 h-4 shrink-0 block"
            src={`/icons/${!expanded ? "_folder" : "_folder_open"}.svg`}
            alt=""
            width={16}
            height={16}
          />
          <span className="flex-1 text-text-primary font-medium truncate">{node.name}</span>
          <span className="text-[calc(var(--font-size)-2px)] text-text-muted">
            {node.children.length}
          </span>
        </div>
        {expanded && node.children.map((child) => (
          <TreeNodeComponent
            key={child.path}
            node={child}
            depth={depth + 1}
            onFileClick={onFileClick}
            showStatusDot={showStatusDot}
            showBadge={showBadge}
          />
        ))}
      </div>
    );
  }

  const file = node.file!;
  const badge = STATUS_BADGE[file.status];
  const dotColor = STATUS_DOT_COLOR[file.status];
  const textColor = STATUS_TEXT_COLOR[file.status];

  return (
    <div
      className="flex items-center gap-1.5 py-0.5 pr-2 text-[var(--font-size)] cursor-pointer rounded transition-colors duration-100 select-none min-w-0 hover:bg-bg-hover group"
      style={{ paddingLeft: indent }}
      onClick={handleClick}
      title={file.path}
    >
      <img
        className="w-4 h-4 shrink-0 block opacity-70"
        src={fileIconSrc(node.name)}
        alt=""
        width={16}
        height={16}
      />
      <span className={`flex-1 truncate group-hover:text-text-primary ${textColor}`}>
        {node.name}
      </span>
      {showStatusDot && (
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotColor)} />
      )}
      {showBadge && (
        <Badge variant={badge.variant}>{badge.label}</Badge>
      )}
    </div>
  );
});

TreeNodeComponent.displayName = 'TreeNodeComponent';

export default React.memo(ChangeFileTree);
