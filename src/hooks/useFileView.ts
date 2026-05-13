import { useState, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileNode, FileContent, Tab, FileTabData } from "../types";
import { DEFAULT_TREE_DEPTH } from "../types/file";
import type { ProjectCommands } from "../types/activeProject";
import { useAppStore } from "../store/appStore";
import { buildWorktreeTabKey, parseProjectIdFromTabKey } from "../utils/tabKey";

/**
 * 将 newChildren 合并到 fileTree 中路径为 dirPath 的节点
 */
function mergeSubTree(tree: FileNode[], dirPath: string, newChildren: FileNode[]): FileNode[] {
  return tree.map((node) => {
    if (node.path === dirPath) {
      return { ...node, children: newChildren };
    }
    if (node.is_dir && node.children.length > 0 && dirPath.startsWith(node.path + "/")) {
      return { ...node, children: mergeSubTree(node.children, dirPath, newChildren) };
    }
    return node;
  });
}

/**
 * Generate a unique tab ID from project ID and file path
 */
function getTabId(projectId: string, filePath: string): string {
  return `${projectId}:${filePath}`;
}

/**
 * Extract file name from path
 */
function getFileName(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() || filePath;
}

/** Type guard: narrow Tab to file kind */
function isFileTab(tab: Tab): tab is Tab & { data: FileTabData } {
  return tab.data.kind === "file";
}

/**
 * useFileView — 文件视图 hook
 *
 * 支持两种模式：
 * - 无参数 (local 模式): 从 store 读取 activeProjectId / activeWorktreePath，直接 invoke
 * - 传入 externalCommands / externalWorktreePath (WSL/Remote 模式): 通过 ProjectCommands 接口调用
 *
 * 选项 A：最小改动，保证本地功能不受影响，WSL/Remote 通过 externalCommands 接入。
 */
export function useFileView(
  externalCommands?: ProjectCommands | null,
  externalWorktreePath?: string | null,
) {
  const fileTree = useAppStore((state) => state.fileTree);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const activeWslProject = useAppStore((state) => state.activeWslProject);
  const activeRemoteProject = useAppStore((state) => state.activeRemoteProject);
  const activeWorktreePath = useAppStore((state) => state.activeWorktreePath);
  const fileTreeLoading = useAppStore((state) => state.fileViewLoading);
  const [error, setError] = useState<string | null>(null);

  // Unified current project ID — covers local/WSL/remote (matches MainContent tabKey logic)
  const currentProjectId = activeProjectId
    ?? activeWslProject?.project.id
    ?? activeRemoteProject?.project.id
    ?? null;

  // Resolve effective worktree path: external takes priority
  const effectiveWorktreePath = externalWorktreePath !== undefined
    ? externalWorktreePath
    : activeWorktreePath;

  // Composite tab key: worktree gets its own independent tab space
  const tabKey = effectiveWorktreePath && currentProjectId
    ? buildWorktreeTabKey(currentProjectId, effectiveWorktreePath)
    : currentProjectId;

  // Read project tabs from unified store using tabKey
  const projectTabs = useAppStore((state) => {
    if (!tabKey) return null;
    return state.tabs[tabKey] ?? null;
  });

  // Derive file tabs (filtered by kind === "file")
  const fileTabs = useMemo(() => {
    if (!projectTabs) return [];
    return projectTabs.tabs.filter(isFileTab);
  }, [projectTabs]);

  // Derive active file tab ID
  const activeFileTabId = useMemo(() => {
    if (!projectTabs) return null;
    // Prefer the project's active tab if it's a file tab
    const active = projectTabs.tabs.find((t) => t.id === projectTabs.activeTabId);
    if (active && active.data.kind === "file") return active.id;
    // Fall back to first file tab
    const first = projectTabs.tabs.find(isFileTab);
    return first?.id ?? null;
  }, [projectTabs]);

  // Derive active file path
  const activeFilePath = useMemo(() => {
    if (!activeFileTabId) return null;
    const tab = fileTabs.find((t) => t.id === activeFileTabId);
    return tab?.data.filePath ?? null;
  }, [fileTabs, activeFileTabId]);

  // Refs for callbacks (avoids stale closures)
  // Sync during render phase — ensures loadFileTree/openFile always read latest values
  const tabKeyRef = useRef(tabKey);
  tabKeyRef.current = tabKey;

  const worktreePathRef = useRef(effectiveWorktreePath);
  worktreePathRef.current = effectiveWorktreePath;

  const externalCommandsRef = useRef(externalCommands);
  externalCommandsRef.current = externalCommands;

  /**
   * Load the directory tree for a project
   */
  const loadFileTree = useCallback(async (projectId: string, worktreePath?: string) => {
    useAppStore.setState({ fileViewLoading: true });
    setError(null);
    try {
      const cmds = externalCommandsRef.current;
      let tree: FileNode[];
      if (cmds) {
        // WSL/Remote 模式：通过 ProjectCommands 接口调用
        tree = await cmds.readDirTree(worktreePath ?? undefined, undefined, DEFAULT_TREE_DEPTH);
      } else {
        // Local 模式：直接 invoke
        tree = await invoke<FileNode[]>("read_dir_tree", {
          projectId,
          rootPath: worktreePath ?? null,
          subPath: null,
          maxDepth: DEFAULT_TREE_DEPTH,
        });
      }
      useAppStore.setState({
        fileTree: tree,
        fileViewLoading: false,
      });
    } catch (e) {
      setError(String(e));
      useAppStore.setState({
        fileTree: [],
        fileViewLoading: false,
      });
    }
  }, []);

  /**
   * 懒加载子目录：展开超过初始深度的目录时，按需加载该目录的子树
   */
  const expandSubTree = useCallback(async (dirPath: string) => {
    const cmds = externalCommandsRef.current;
    const state = useAppStore.getState();
    const projectId =
      state.activeProjectId ??
      state.activeWslProject?.project.id ??
      state.activeRemoteProject?.project.id ??
      null;
    if (!projectId) return;
    const rootPath = worktreePathRef.current ?? undefined;

    let subChildren: FileNode[];
    if (cmds) {
      // WSL/Remote 模式
      subChildren = await cmds.readDirTree(rootPath, dirPath, DEFAULT_TREE_DEPTH);
    } else {
      // Local 模式
      subChildren = await invoke<FileNode[]>("read_dir_tree", {
        projectId,
        rootPath: rootPath ?? null,
        subPath: dirPath,
        maxDepth: DEFAULT_TREE_DEPTH,
      });
    }

    const currentTree = useAppStore.getState().fileTree;
    const merged = mergeSubTree(currentTree, dirPath, subChildren);
    useAppStore.setState({ fileTree: merged });
  }, []);

  /**
   * Open a file - adds a new tab or activates existing tab
   */
  const openFile = useCallback(async (filePath: string) => {
    const tk = tabKeyRef.current;
    if (!tk) return;

    const projectId = parseProjectIdFromTabKey(tk);
    const tabId = getTabId(tk, filePath);

    // Check if tab already exists in unified store — just activate, no loading
    const state = useAppStore.getState();
    const existing = state.tabs[tk];
    if (existing?.tabs.some((t) => t.id === tabId)) {
      state.activateTab(tk, tabId);
      return;
    }

    // Load file content — do NOT touch fileTreeLoading
    setError(null);
    try {
      const rootPath = worktreePathRef.current ?? undefined;
      const cmds = externalCommandsRef.current;
      let content: FileContent;
      if (cmds) {
        // WSL/Remote 模式：通过 ProjectCommands 接口调用
        content = await cmds.readFileContent(filePath, rootPath);
      } else {
        // Local 模式：直接 invoke
        content = await invoke<FileContent>("read_file_content", {
          projectId,
          filePath,
          rootPath,
        });
      }

      const newTab: Tab = {
        id: tabId,
        projectId,
        title: getFileName(filePath),
        order: existing?.tabs.length ?? 0,
        data: {
          kind: "file",
          filePath,
          fileName: getFileName(filePath),
          content,
          isDirty: false,
        },
      };

      useAppStore.getState().addTab(tk, newTab);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  /**
   * Close a tab
   */
  const closeTab = useCallback((tabId: string) => {
    const tk = tabKeyRef.current;
    if (!tk) return;
    useAppStore.getState().closeTab(tk, tabId);
  }, []);

  /**
   * Activate a tab
   */
  const activateTab = useCallback((tabId: string) => {
    const tk = tabKeyRef.current;
    if (!tk) return;
    useAppStore.getState().activateTab(tk, tabId);
  }, []);

  /**
   * Update tab content (for dirty tracking)
   */
  const updateTabContent = useCallback((tabId: string, content: string) => {
    const tk = tabKeyRef.current;
    if (!tk) return;

    const state = useAppStore.getState();
    const projTabs = state.tabs[tk];
    if (!projTabs) return;

    const tab = projTabs.tabs.find((t) => t.id === tabId);
    if (!tab || tab.data.kind !== "file") return;

    state.updateTab(tk, tabId, {
      content: { ...tab.data.content, content },
      isDirty: content !== tab.data.content.content,
    });
  }, []);

  /**
   * Save file content
   */
  const saveFile = useCallback(async (content: string): Promise<boolean> => {
    const tk = tabKeyRef.current;
    if (!tk) return false;

    const state = useAppStore.getState();
    const projTabs = state.tabs[tk];
    if (!projTabs) return false;

    // Find the active file tab
    const active = projTabs.tabs.find((t) => t.id === projTabs.activeTabId);
    const fileTab = active && active.data.kind === "file"
      ? active
      : projTabs.tabs.find(isFileTab);
    if (!fileTab || fileTab.data.kind !== "file") return false;

    try {
      const rootPath = worktreePathRef.current ?? undefined;
      const cmds = externalCommandsRef.current;
      if (cmds) {
        // WSL/Remote 模式：通过 ProjectCommands 接口调用
        await cmds.writeFileContent(fileTab.data.filePath, content, rootPath);
      } else {
        // Local 模式：直接 invoke
        await invoke("write_file_content", {
          projectId: fileTab.projectId,
          filePath: fileTab.data.filePath,
          content,
          rootPath,
        });
      }

      // Update tab: mark as not dirty, update content
      state.updateTab(tk, fileTab.id, {
        content: { ...fileTab.data.content, content },
        isDirty: false,
      });
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }, []);

  /**
   * Mark tab as dirty
   */
  const setTabDirty = useCallback((tabId: string, isDirty: boolean) => {
    const tk = tabKeyRef.current;
    if (!tk) return;

    const state = useAppStore.getState();
    const projTabs = state.tabs[tk];
    if (!projTabs) return;

    const tab = projTabs.tabs.find((t) => t.id === tabId);
    if (!tab || tab.data.kind !== "file") return;

    state.updateTab(tk, tabId, {
      content: tab.data.content,
      isDirty,
    });
  }, []);

  /**
   * Clear file view (e.g., when switching projects)
   */
  const clearFileView = useCallback(() => {
    useAppStore.setState({
      fileTree: [],
      activeFilePath: null,
    });
    setError(null);
  }, []);

  return {
    fileTree,
    activeFilePath,
    isLoading: fileTreeLoading,
    error,
    loadFileTree,
    expandSubTree,
    openFile,
    closeTab,
    activateTab,
    updateTabContent,
    saveFile,
    setTabDirty,
    clearFileView,
  };
}
