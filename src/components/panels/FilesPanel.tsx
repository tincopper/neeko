import { ChevronRight } from "lucide-react";
import React, { useCallback, useState, useEffect, useRef } from "react";
import { fileIconSrc } from "../../utils/fileIcons";
import type { FileNode } from "../../types";

interface FilesPanelProps {
  projectName: string | null;
  projectPath?: string | null;
  fileTree: FileNode[];
  isLoading: boolean;
  activeFilePath: string | null;
  onSelectFile: (filePath: string) => void;
  onRefresh: () => void;
  /** 懒加载：按需加载超过初始深度的子目录 */
  onExpandDir: (dirPath: string) => Promise<void>;
}

/**
 * Get all parent directory paths for a file path
 */
function getParentPaths(filePath: string): string[] {
  const parts = filePath.replace(/\\/g, "/").split("/");
  const paths: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    paths.push(parts.slice(0, i).join("/"));
  }
  return paths;
}

/**
 * 在树中查找指定路径的节点
 */
function findNode(tree: FileNode[], path: string): FileNode | null {
  for (const node of tree) {
    if (node.path === path) return node;
    if (node.is_dir && node.children.length > 0) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  activeFilePath: string | null;
  expandedDirs: Set<string>;
  loadingDirs: Set<string>;
  onSelectFile: (path: string) => void;
  onToggleDir: (path: string) => void;
}

function FileTreeNode({
  node,
  depth,
  activeFilePath,
  expandedDirs,
  loadingDirs,
  onSelectFile,
  onToggleDir,
}: FileTreeNodeProps) {
  const isExpanded = expandedDirs.has(node.path);
  const isActive = activeFilePath === node.path;
  const isLoadingChildren = loadingDirs.has(node.path);

  const handleClick = useCallback(() => {
    if (node.is_dir) {
      onToggleDir(node.path);
    } else {
      onSelectFile(node.path);
    }
  }, [node.is_dir, node.path, onSelectFile, onToggleDir]);

  const indent = 4 + depth * 12;

  return (
    <>
      <div
        className={`flex items-center gap-1 py-0.5 pr-2 text-[var(--font-size)] cursor-pointer rounded select-none min-w-0 ${
          isActive ? "bg-accent/10" : "hover:bg-bg-hover"
        }`}
        style={{ paddingLeft: indent }}
        onClick={handleClick}
        title={node.path}
      >
        {node.is_dir ? (
          <>
            <ChevronRight
              className={`w-3.5 h-3.5 shrink-0 text-text-muted transition-transform duration-150 ${
                isExpanded ? "rotate-90" : ""
              }`}
            />
            <img
              className="w-4 h-4 shrink-0 block"
              src={`/icons/${isExpanded ? "_folder_open" : "_folder"}.svg`}
              alt=""
              width={16}
              height={16}
            />
            <span className="flex-1 text-text-primary font-medium truncate">{node.name}</span>
            {isLoadingChildren && (
              <span className="shrink-0 w-3 h-3 rounded-full border border-text-muted border-t-transparent animate-spin ml-1" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5 h-3.5 shrink-0" />
            <img
              className="w-3.5 h-3.5 shrink-0 block opacity-70"
              src={fileIconSrc(node.name)}
              alt=""
              width={14}
              height={14}
            />
            <span
              className={`flex-1 truncate ${
                isActive ? "text-accent font-medium" : "text-text-secondary"
              }`}
            >
              {node.name}
            </span>
          </>
        )}
      </div>
      {node.is_dir && isExpanded && (
        <>
          {node.children.length > 0
            ? node.children.map((child) => (
                <FileTreeNode
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  activeFilePath={activeFilePath}
                  expandedDirs={expandedDirs}
                  loadingDirs={loadingDirs}
                  onSelectFile={onSelectFile}
                  onToggleDir={onToggleDir}
                />
              ))
            : !isLoadingChildren && null}
        </>
      )}
    </>
  );
}

const MemoizedFileTreeNode = React.memo(FileTreeNode);

function FilesPanel({ projectName, projectPath, fileTree, isLoading, activeFilePath, onSelectFile, onRefresh, onExpandDir }: FilesPanelProps) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  // 正在加载中的目录
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  // 已懒加载过的空目录（避免重复请求真正的空目录）
  const [loadedEmptyDirs, setLoadedEmptyDirs] = useState<Set<string>>(new Set());
  const prevActiveFilePathRef = useRef<string | null>(null);

  // 刷新时清空懒加载记录
  const handleRefresh = useCallback(() => {
    setLoadedEmptyDirs(new Set());
    setLoadingDirs(new Set());
    onRefresh();
  }, [onRefresh]);

  // Auto-expand parent directories when activeFilePath changes
  useEffect(() => {
    if (activeFilePath && activeFilePath !== prevActiveFilePathRef.current) {
      const parentPaths = getParentPaths(activeFilePath);
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        let hasNew = false;
        for (const p of parentPaths) {
          if (!next.has(p)) {
            next.add(p);
            hasNew = true;
          }
        }
        return hasNew ? next : prev;
      });
      prevActiveFilePathRef.current = activeFilePath;
    }
  }, [activeFilePath]);

  const handleToggleDir = useCallback(async (path: string) => {
    // 收起：直接 toggle，无需懒加载
    if (expandedDirs.has(path)) {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      return;
    }

    // 展开：检查是否需要懒加载
    const node = findNode(fileTree, path);
    const needsLazyLoad =
      node &&
      node.is_dir &&
      node.children.length === 0 &&
      !loadedEmptyDirs.has(path);

    if (needsLazyLoad) {
      // 先展开，显示 loading spinner
      setExpandedDirs((prev) => new Set(prev).add(path));
      setLoadingDirs((prev) => new Set(prev).add(path));
      try {
        await onExpandDir(path);
      } finally {
        setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
        // 标记已加载（无论是否有结果），防止重复请求真正的空目录
        setLoadedEmptyDirs((prev) => new Set(prev).add(path));
      }
    } else {
      // children 已存在，或已知为真空目录：直接展开
      setExpandedDirs((prev) => new Set(prev).add(path));
    }
  }, [fileTree, expandedDirs, loadedEmptyDirs, onExpandDir]);

  if (!projectName) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-[var(--font-size)] text-text-secondary text-center">
          Select a project to browse files
        </p>
      </div>
    );
  }

  const activeFileName = activeFilePath ? activeFilePath.split(/[\\/]/).pop() || activeFilePath : null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          {activeFileName ? (
            <>
              <img
                src={fileIconSrc(activeFileName)}
                alt=""
                width={16}
                height={16}
                className="shrink-0"
              />
              <span className="font-semibold text-[var(--font-size)] truncate">{activeFileName}</span>
              <span className="text-text-muted text-[var(--font-size)] truncate">{activeFilePath}</span>
            </>
          ) : (
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[var(--font-size)] font-medium text-text-primary truncate">{projectName}</span>
              {projectPath && (
                <span className="text-[calc(var(--font-size)-1px)] text-text-muted truncate" title={projectPath}>
                  {projectPath}
                </span>
              )}
            </div>
          )}
        </div>
        <button
          className="p-1 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
          onClick={handleRefresh}
          title="Refresh file tree"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6" />
            <path d="M2.5 22v-6h6" />
            <path d="M2 11.5a10 10 0 0 1 18.8-4.3" />
            <path d="M22 12.5a10 10 0 0 1-18.8 4.2" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        {isLoading ? (
          <div className="flex items-center justify-center p-4">
            <span className="text-[var(--font-size)] text-text-secondary">Loading...</span>
          </div>
        ) : fileTree.length === 0 ? (
          <div className="flex items-center justify-center p-4">
            <span className="text-[var(--font-size)] text-text-secondary">No files found</span>
          </div>
        ) : (
          fileTree.map((node) => (
            <MemoizedFileTreeNode
              key={node.path}
              node={node}
              depth={0}
              activeFilePath={activeFilePath}
              expandedDirs={expandedDirs}
              loadingDirs={loadingDirs}
              onSelectFile={onSelectFile}
              onToggleDir={handleToggleDir}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default React.memo(FilesPanel);
