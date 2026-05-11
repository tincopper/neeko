import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileNode, FileContent, Tab, FileTabData } from "../types";
import { useAppStore } from "../store/appStore";

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

export function useFileView() {
  const fileTree = useAppStore((state) => state.fileTree);
  const activeProjectId = useAppStore((state) => state.activeProjectId);
  const fileTreeLoading = useAppStore((state) => state.fileViewLoading);
  const [error, setError] = useState<string | null>(null);

  // Read project tabs from unified store
  const projectTabs = useAppStore((state) => {
    if (!activeProjectId) return null;
    return state.tabs[activeProjectId] ?? null;
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

  // Ref for projectId in callbacks (avoids stale closures)
  const projectIdRef = useRef(activeProjectId);
  useEffect(() => {
    projectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  /**
   * Load the directory tree for a project
   */
  const loadFileTree = useCallback(async (projectId: string, worktreePath?: string) => {
    useAppStore.setState({ fileViewLoading: true });
    setError(null);
    try {
      const tree = await invoke<FileNode[]>("read_dir_tree", {
        projectId,
        rootPath: worktreePath ?? null,
        subPath: null,
        maxDepth: 4,
      });
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
   * Open a file - adds a new tab or activates existing tab
   */
  const openFile = useCallback(async (projectId: string, filePath: string) => {
    const tabId = getTabId(projectId, filePath);

    // Check if tab already exists in unified store — just activate, no loading
    const state = useAppStore.getState();
    const existing = state.tabs[projectId];
    if (existing?.tabs.some((t) => t.id === tabId)) {
      state.activateTab(projectId, tabId);
      return;
    }

    // Load file content — do NOT touch fileTreeLoading
    setError(null);
    try {
      const content = await invoke<FileContent>("read_file_content", {
        projectId,
        filePath,
      });

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

      useAppStore.getState().addTab(projectId, newTab);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  /**
   * Close a tab
   */
  const closeTab = useCallback((tabId: string) => {
    const pid = projectIdRef.current;
    if (!pid) return;
    useAppStore.getState().closeTab(pid, tabId);
  }, []);

  /**
   * Activate a tab
   */
  const activateTab = useCallback((tabId: string) => {
    const pid = projectIdRef.current;
    if (!pid) return;
    useAppStore.getState().activateTab(pid, tabId);
  }, []);

  /**
   * Update tab content (for dirty tracking)
   */
  const updateTabContent = useCallback((tabId: string, content: string) => {
    const pid = projectIdRef.current;
    if (!pid) return;

    const state = useAppStore.getState();
    const projectTabs = state.tabs[pid];
    if (!projectTabs) return;

    const tab = projectTabs.tabs.find((t) => t.id === tabId);
    if (!tab || tab.data.kind !== "file") return;

    state.updateTab(pid, tabId, {
      content: { ...tab.data.content, content },
      isDirty: content !== tab.data.content.content,
    });
  }, []);

  /**
   * Save file content
   */
  const saveFile = useCallback(async (content: string): Promise<boolean> => {
    const pid = projectIdRef.current;
    if (!pid) return false;

    const state = useAppStore.getState();
    const projectTabs = state.tabs[pid];
    if (!projectTabs) return false;

    // Find the active file tab
    const active = projectTabs.tabs.find((t) => t.id === projectTabs.activeTabId);
    const fileTab = active && active.data.kind === "file"
      ? active
      : projectTabs.tabs.find(isFileTab);
    if (!fileTab || fileTab.data.kind !== "file") return false;

    try {
      await invoke("write_file_content", {
        projectId: fileTab.projectId,
        filePath: fileTab.data.filePath,
        content,
      });

      // Update tab: mark as not dirty, update content
      state.updateTab(pid, fileTab.id, {
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
    const pid = projectIdRef.current;
    if (!pid) return;

    const state = useAppStore.getState();
    const projectTabs = state.tabs[pid];
    if (!projectTabs) return;

    const tab = projectTabs.tabs.find((t) => t.id === tabId);
    if (!tab || tab.data.kind !== "file") return;

    state.updateTab(pid, tabId, {
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
    openFile,
    closeTab,
    activateTab,
    updateTabContent,
    saveFile,
    setTabDirty,
    clearFileView,
  };
}
