import React, { useState, useCallback } from "react";
import { FileChange } from "../../types";
import { fileIconSrc } from "../../utils/fileIcons";

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  file?: FileChange;
  // compact display name (e.g. "com.tomgs.app"), directories only
  compactName?: string;
}

const IGNORED_PREFIXES = ['.neeko/'];

export function buildTree(files: FileChange[]): TreeNode[] {
  const filtered = files.filter((f) => {
    const norm = f.path.replace(/\\/g, "/");
    return !IGNORED_PREFIXES.some((p) => norm.startsWith(p) || norm.includes("/" + p));
  });

  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };

  for (const file of filtered) {
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

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);

  // compact intermediate directories with single child (IDEA "Compact Middle Packages" style)
  compactTree(root.children);

  return root.children;
}

/**
 * Compress chains like a/ -> b/ -> c/ (each level has single dir child) into a single node,
 * compactName = "a.b.c", children becomes c's children.
 */
function compactTree(nodes: TreeNode[]) {
  for (const node of nodes) {
    if (!node.isDir) continue;

    const parts: string[] = [node.name];
    let cur = node;
    while (cur.children.length === 1 && cur.children[0].isDir) {
      cur = cur.children[0];
      parts.push(cur.name);
    }

    if (parts.length > 1) {
      node.compactName = parts.join(".");
      node.children = cur.children;
      node.path = cur.path;
    }

    compactTree(node.children);
  }
}

const STATUS_BADGE: Record<FileChange["status"], { label: string; cls: string }> = {
  Modified: { label: "M", cls: "gh-badge-modified" },
  Added: { label: "A", cls: "gh-badge-added" },
  Deleted: { label: "D", cls: "gh-badge-deleted" },
  Renamed: { label: "R", cls: "gh-badge-renamed" },
  Untracked: { label: "U", cls: "gh-badge-untracked" },
};

interface FileTreeProps {
  nodes: TreeNode[];
  projectId: string;
  onSelectFile: (projectId: string, filePath: string) => void;
  depth?: number;
}

const FileTree: React.FC<FileTreeProps> = ({ nodes, projectId, onSelectFile, depth = 0 }) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const BASE = 6;
  const STEP = 12;

  return (
    <>
      {nodes.map((node) => {
        const isExpanded = expanded.has(node.path);
        const indent = BASE + depth * STEP;
        const displayName = node.compactName ?? node.name;

        if (node.isDir) {
          return (
            <React.Fragment key={node.path}>
              <div
                className="flex items-center gap-1 py-0.5 pr-2 text-base cursor-pointer rounded transition-colors duration-100 select-none min-w-0 hover:bg-bg-hover"
                style={{ paddingLeft: indent }}
                onClick={(e) => { e.stopPropagation(); toggle(node.path); }}
                title={node.path}
              >
                <img
                  className="w-4 h-4 shrink-0 block"
                  src={`/icons/${!isExpanded ? "_folder" : "_folder_open"}.svg`}
                  alt=""
                  width={16}
                  height={16}
                />
                <span className="flex-1 text-text-primary font-medium truncate">{displayName}</span>
              </div>
              {isExpanded && (
                <FileTree
                  nodes={node.children}
                  projectId={projectId}
                  onSelectFile={onSelectFile}
                  depth={depth + 1}
                />
              )}
            </React.Fragment>
          );
        }

        const file = node.file!;
        const badge = STATUS_BADGE[file.status];
        return (
          <div
            key={node.path}
            className="flex items-center gap-1 py-0.5 pr-2 text-base cursor-pointer rounded transition-colors duration-100 select-none min-w-0 hover:bg-bg-hover group"
            style={{ paddingLeft: indent }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectFile(projectId, file.path);
            }}
            title={file.path}
          >
            <img
              className="w-4 h-4 shrink-0 block opacity-70"
              src={fileIconSrc(node.name)}
              alt=""
              width={16}
              height={16}
            />
            <span className="flex-1 text-text-secondary truncate group-hover:text-text-primary">{node.name}</span>
            <span className={`gh-badge ${badge.cls}`}>{badge.label}</span>
          </div>
        );
      })}
    </>
  );
};

export default React.memo(FileTree);
