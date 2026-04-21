import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileNode, FileContent, FileTab } from "../types";
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

function getActiveFilePath(tabs: FileTab[], activeTabId: string | null): string | null {
  if (!activeTabId) {
    return null;
  }
  return tabs.find((tab) => tab.id === activeTabId)?.filePath ?? null;
}

export function useFileView() {
  const fileTree = useAppStore((state) => state.fileTree);
  const tabs = useAppStore((state) => state.fileTabs);
  const activeTabId = useAppStore((state) => state.activeFileTabId);
  const fileTreeLoading = useAppStore((state) => state.fileViewLoading);
  const activeFilePath = useAppStore((state) => state.activeFilePath);
  const [error, setError] = useState<string | null>(null);

  // Refs for avoiding stale closures
  const tabsRef = useRef<FileTab[]>(tabs);
  const activeTabIdRef = useRef<string | null>(activeTabId);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  /**
   * Load the directory tree for a project
   */
  const loadFileTree = useCallback(async (projectId: string) => {
    useAppStore.setState({ fileViewLoading: true });
    setError(null);
    try {
      const tree = await invoke<FileNode[]>("read_dir_tree", {
        projectId,
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

    // Check if tab already exists — just activate, no loading
    const existingTab = tabsRef.current.find((t) => t.id === tabId);
    if (existingTab) {
      useAppStore.setState({
        activeFileTabId: tabId,
        activeFilePath: existingTab.filePath,
      });
      return;
    }

    // Load file content — do NOT touch fileTreeLoading
    setError(null);
    try {
      const content = await invoke<FileContent>("read_file_content", {
        projectId,
        filePath,
      });

      const newTab: FileTab = {
        id: tabId,
        projectId,
        filePath,
        fileName: getFileName(filePath),
        content,
        isDirty: false,
        order: tabsRef.current.length,
      };

      useAppStore.setState((state) => {
        const nextTabs = [...state.fileTabs, newTab];
        return {
          fileTabs: nextTabs,
          activeFileTabId: tabId,
          activeFilePath: getActiveFilePath(nextTabs, tabId),
        };
      });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  /**
   * Close a tab
   */
  const closeTab = useCallback((tabId: string) => {
    useAppStore.setState((state) => {
      const idx = state.fileTabs.findIndex((t) => t.id === tabId);
      if (idx === -1) {
        return {};
      }

      const newTabs = state.fileTabs.filter((t) => t.id !== tabId);
      let nextActiveTabId = state.activeFileTabId;

      // Update active tab if we're closing the active one
      if (activeTabIdRef.current === tabId) {
        if (newTabs.length === 0) {
          nextActiveTabId = null;
        } else {
          // Activate the next tab, or the previous one if closing the last
          const nextIdx = Math.min(idx, newTabs.length - 1);
          nextActiveTabId = newTabs[nextIdx].id;
        }
      }

      return {
        fileTabs: newTabs,
        activeFileTabId: nextActiveTabId,
        activeFilePath: getActiveFilePath(newTabs, nextActiveTabId),
      };
    });
  }, []);

  /**
   * Activate a tab
   */
  const activateTab = useCallback((tabId: string) => {
    useAppStore.setState((state) => ({
      activeFileTabId: tabId,
      activeFilePath: getActiveFilePath(state.fileTabs, tabId),
    }));
  }, []);

  /**
   * Update tab content (for dirty tracking)
   */
  const updateTabContent = useCallback((tabId: string, content: string) => {
    useAppStore.setState((state) => {
      const nextTabs = state.fileTabs.map((t) => {
        if (t.id !== tabId) return t;
        return {
          ...t,
          content: { ...t.content, content },
          isDirty: content !== t.content.content,
        };
      });
      return {
        fileTabs: nextTabs,
        activeFilePath: getActiveFilePath(nextTabs, state.activeFileTabId),
      };
    });
  }, []);

  /**
   * Save file content
   */
  const saveFile = useCallback(async (content: string): Promise<boolean> => {
    const tabId = activeTabIdRef.current;
    if (!tabId) return false;

    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab) return false;

    try {
      await invoke("write_file_content", {
        projectId: tab.projectId,
        filePath: tab.filePath,
        content,
      });

      // Update tab: mark as not dirty, update original content
      useAppStore.setState((state) => {
        const nextTabs = state.fileTabs.map((t) => {
          if (t.id !== tabId) return t;
          return {
            ...t,
            content: { ...t.content, content },
            isDirty: false,
          };
        });
        return {
          fileTabs: nextTabs,
          activeFilePath: getActiveFilePath(nextTabs, state.activeFileTabId),
        };
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
    useAppStore.setState((state) => {
      const nextTabs = state.fileTabs.map((t) => (
        t.id === tabId ? { ...t, isDirty } : t
      ));
      return {
        fileTabs: nextTabs,
        activeFilePath: getActiveFilePath(nextTabs, state.activeFileTabId),
      };
    });
  }, []);

  /**
   * Clear file view (e.g., when switching projects)
   */
  const clearFileView = useCallback(() => {
    useAppStore.setState({
      activeFileTabId: null,
      fileTabs: [],
      fileTree: [],
      activeFilePath: null,
    });
    setError(null);
  }, []);

  // Derived state
  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

  return {
    fileTree,
    tabs,
    activeTabId,
    activeTab,
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
