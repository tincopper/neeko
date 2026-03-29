import React, { useState, useCallback } from "react";
import { FileChange } from "../../types";
import { fileIconSrc } from "../../utils/fileIcons";

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  file?: FileChange;
  // 压缩显示名（如 "com.tomgs.app"），仅目录节点使用
  compactName?: string;
}

export function buildTree(files: FileChange[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };

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

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);

  // 压缩只有单个目录子节点的中间路径（IDEA "Compact Middle Packages" 风格）
  compactTree(root.children);

  return root.children;
}

/**
 * 将形如 a/ -> b/ -> c/ (每层只有一个目录子节点) 压缩为单节点，
 * compactName = "a.b.c"，children 变为 c 的 children。
 */
function compactTree(nodes: TreeNode[]) {
  for (const node of nodes) {
    if (!node.isDir) continue;

    // 向下合并：只要当前节点只有 1 个子节点，且该子节点是目录
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

    // 递归处理子节点
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

  const BASE = 8;
  const STEP = 14;

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
                className="gh-tree-dir"
                style={{ paddingLeft: indent }}
                onClick={(e) => { e.stopPropagation(); toggle(node.path); }}
                title={node.path}
              >
                <img
                  className="gh-dir-icon"
                  src={`/icons/${!isExpanded ? "_folder" : "_folder_open"}.svg`}
                  alt=""
                  width={16}
                  height={16}
                />
                <span className="gh-dir-name">{displayName}</span>
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
            className="gh-tree-file"
            style={{ paddingLeft: indent }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectFile(projectId, file.path);
            }}
            title={file.path}
          >
            <img
              className="gh-file-icon"
              src={fileIconSrc(node.name)}
              alt=""
              width={16}
              height={16}
            />
            <span className="gh-file-name">{node.name}</span>
            <span className={`gh-badge ${badge.cls}`}>{badge.label}</span>
          </div>
        );
      })}
    </>
  );
};

export default React.memo(FileTree);
