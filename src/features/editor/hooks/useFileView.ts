import { useState, useCallback, useRef, useMemo } from "react";
import { readDirTree, readFileContent, writeFileContent } from "@/features/file/api/fileApi";
import type { FileNode, FileContent, Tab } from '@/shared/types';
import { DEFAULT_TREE_DEPTH } from '@/shared/types/file';
import type { ProjectCommands } from '@/shared/types/activeProject';
import { useProjectStore } from '@/features/project/store';
import { useWorktreeStore } from '@/features/project/worktreeStore';
import { useFileStore } from '@/features/file/store';
import { useEditorStore } from '@/shared/store';
import { useShallow } from "zustand/shallow";
import { buildWorktreeTabKey, parseProjectIdFromTabKey } from '@/shared/utils/tabKey';
import { clearViewSnapshot, clearAllForTabKey } from '@/shared/utils/editorViewState';
import { mergeSubTree, getTabId, getFileName, isFileTab } from '@/shared/utils/fileTree';
import { closeEditorTab } from '@/features/terminal/components/terminalTabCleanup';

/**
 * useFileView �?文件视图 hook
 *
 * 支持两种模式�?
 * - 无参�?(local 模式): �?store 读取 activeProjectId / activeWorktreePath，直�?invoke
 * - 传入 externalCommands / externalWorktreePath (WSL/Remote 模式): 通过 ProjectCommands 接口调用
 *
 * 选项 A：最小改动，保证本地功能不受影响，WSL/Remote 通过 externalCommands 接入�?
 */
export function useFileView(
  externalCommands?: ProjectCommands | null,
  externalWorktreePath?: string | null,
) {
  const fileTree = useFileStore(useShallow((state) => state.fileTree));
  const activeProject = useProjectStore((state) => state.activeProject);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeWorktreePath = useWorktreeStore((state) => state.activeWorktreePath);
  const fileTreeLoading = useFileStore((state) => state.fileViewLoading);
  const [error, setError] = useState<string | null>(null);

  // Unified current project ID — covers local/WSL/remote via unified store
  const currentProjectId = activeProjectId ?? activeProject?.id ?? null;

  // Resolve effective worktree path: external takes priority
  const effectiveWorktreePath = externalWorktreePath !== undefined
    ? externalWorktreePath
    : activeWorktreePath;

  // Composite tab key: worktree gets its own independent tab space
  const tabKey = effectiveWorktreePath && currentProjectId
    ? buildWorktreeTabKey(currentProjectId, effectiveWorktreePath)
    : currentProjectId;

  // Read project tabs from unified store using tabKey
  const projectTabs = useEditorStore(useShallow((state) => {
    if (!tabKey) return null;
    return state.tabs[tabKey] ?? null;
  }));

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
  // Sync during render phase �?ensures loadFileTree/openFile always read latest values
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
    useFileStore.setState({ fileViewLoading: true });
    setError(null);
    try {
      const cmds = externalCommandsRef.current;
      let tree: FileNode[];
      if (cmds) {
        // WSL/Remote 模式：通过 ProjectCommands 接口调用
        tree = await cmds.readDirTree(worktreePath ?? undefined, undefined, DEFAULT_TREE_DEPTH);
      } else {
        // Local 模式：通过 unified 命令调用
        tree = await readDirTree(
          projectId,
          "",
          worktreePath ?? null,
        );
      }
      useFileStore.setState({
        fileTree: tree,
        fileViewLoading: false,
      });
    } catch (e) {
      setError(String(e));
      useFileStore.setState({
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
    const projectId =
      useProjectStore.getState().activeProjectId ??
      null;
    if (!projectId) return;
    const rootPath = worktreePathRef.current ?? undefined;

    try {
      let subChildren: FileNode[];
      if (cmds) {
        // WSL/Remote 模式
        subChildren = await cmds.readDirTree(rootPath, dirPath, DEFAULT_TREE_DEPTH);
      } else {
        // Local 模式：通过 unified 命令
        subChildren = await readDirTree(
          projectId,
          dirPath,
          rootPath ?? null,
        );
      }

      const currentTree = useFileStore.getState().fileTree;
      const merged = mergeSubTree(currentTree, dirPath, subChildren);
      useFileStore.setState({ fileTree: merged });
    } catch (e) {
      // Re-throw so the caller (FilesPanel.handleToggleDir) can handle it;
      // at minimum its `finally` block will clear the loading spinner.
      console.error("[useFileView] expandSubTree failed for", dirPath, e);
      throw e;
    }
  }, []);

  /**
   * Open a file - adds a new tab or activates existing tab
   */
  const openFile = useCallback(async (filePath: string) => {
    const tk = tabKeyRef.current;
    if (!tk) return;

    const projectId = parseProjectIdFromTabKey(tk);
    const tabId = getTabId(tk, filePath);

    // If tab already exists, re-read content from disk and activate
    const existing = useEditorStore.getState().tabs[tk];
    const existingTab = existing?.tabs.find((t) => t.id === tabId);
    if (existingTab) {
      if (existingTab.data.kind === "file") {
        try {
          const rootPath = worktreePathRef.current ?? undefined;
          const cmds = externalCommandsRef.current;
          const newContent = cmds
            ? await cmds.readFileContent(filePath, rootPath)
            : await readFileContent(projectId, filePath, rootPath ?? null);
          const oldContent = existingTab.data.content.content;
          if (newContent.content !== oldContent) {
            if (existingTab.data.isDirty) {
              useEditorStore.getState().updateTab(tk, tabId, {
                kind: "file",
                externallyModified: true,
              });
            } else {
              useEditorStore.getState().updateTab(tk, tabId, {
                kind: "file",
                content: newContent,
                isDirty: false,
                externallyModified: false,
              });
            }
          }
        } catch {
          // 读取失败时保持现有内容
        }
      }
      useEditorStore.getState().activateTab(tk, tabId);
      return;
    }

    // Load file content �?do NOT touch fileTreeLoading
    setError(null);
    try {
      const rootPath = worktreePathRef.current ?? undefined;
      const cmds = externalCommandsRef.current;
      let content: FileContent;
      if (cmds) {
        // WSL/Remote 模式：通过 ProjectCommands 接口调用
        content = await cmds.readFileContent(filePath, rootPath);
      } else {
        // Local 模式：通过 unified 命令
        content = await readFileContent(
          projectId,
          filePath,
          rootPath ?? null,
        );
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

      useEditorStore.getState().addTab(tk, newTab);
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
    clearViewSnapshot(tk, tabId);
    // Recycle any terminal PTY if this tab hosted a session.
    closeEditorTab(tk, tabId);
  }, []);

  /**
   * Activate a tab
   */
  const activateTab = useCallback((tabId: string) => {
    const tk = tabKeyRef.current;
    if (!tk) return;
    useEditorStore.getState().activateTab(tk, tabId);
  }, []);

  /**
   * Update tab content (for dirty tracking)
   */
  const updateTabContent = useCallback((tabId: string, content: string) => {
    const tk = tabKeyRef.current;
    if (!tk) return;

    const projTabs = useEditorStore.getState().tabs[tk];
    if (!projTabs) return;

    const tab = projTabs.tabs.find((t) => t.id === tabId);
    if (!tab || tab.data.kind !== "file") return;

    useEditorStore.getState().updateTab(tk, tabId, {
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

    const projTabs = useEditorStore.getState().tabs[tk];
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
        // Local 模式：通过 unified 命令
        await writeFileContent(
          fileTab.projectId,
          fileTab.data.filePath,
          content,
        );
      }

      // Update tab: mark as not dirty, update content
      useEditorStore.getState().updateTab(tk, fileTab.id, {
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

    const projTabs = useEditorStore.getState().tabs[tk];
    if (!projTabs) return;

    const tab = projTabs.tabs.find((t) => t.id === tabId);
    if (!tab || tab.data.kind !== "file") return;

    useEditorStore.getState().updateTab(tk, tabId, {
      content: tab.data.content,
      isDirty,
    });
  }, []);

  /**
   * Clear file view (e.g., when switching projects)
   */
  const clearFileView = useCallback(() => {
    const tk = tabKeyRef.current;
    if (tk) clearAllForTabKey(tk);
    useFileStore.setState({
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
