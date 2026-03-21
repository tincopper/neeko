import React, { useState } from "react";
import { FileChange } from "../../types";
import { fileIconSrc } from "../../utils/fileIcons";

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  file?: FileChange;
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

  return root.children;
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

// Charmed Icons 图标映射已移至 src/utils/fileIcons.ts


const FileTree: React.FC<FileTreeProps> = ({ nodes, projectId, onSelectFile, depth = 0 }) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsed((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  return (
    <>
      {nodes.map((node) => {
        const isCollapsed = collapsed[node.path] ?? false;
        const indent = depth * 12;

        if (node.isDir) {
          return (
            <React.Fragment key={node.path}>
              <div
                className="gh-tree-dir"
                style={{ paddingLeft: 8 + indent }}
                onClick={(e) => toggle(node.path, e)}
              >
                <span className="gh-chevron">{isCollapsed ? "▶" : "▼"}</span>
                <img
                  className="gh-dir-icon"
                  src={`/icons/${isCollapsed ? "_folder" : "_folder_open"}.svg`}
                  alt=""
                  width={16}
                  height={16}
                />
                <span className="gh-dir-name">{node.name}</span>
              </div>
              {!isCollapsed && (
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
            style={{ paddingLeft: 8 + indent }}
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

export default FileTree;
