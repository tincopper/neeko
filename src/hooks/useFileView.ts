import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileNode, FileContent, FileTab } from "../types";

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

export function useFileView() {
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [fileTreeLoading, setFileTreeLoading] = useState(false);
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
    setFileTreeLoading(true);
    setError(null);
    try {
      const tree = await invoke<FileNode[]>("read_dir_tree", {
        projectId,
        subPath: null,
        maxDepth: 4,
      });
      setFileTree(tree);
    } catch (e) {
      setError(String(e));
      setFileTree([]);
    } finally {
      setFileTreeLoading(false);
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
      setActiveTabId(tabId);
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

      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(tabId);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  /**
   * Close a tab
   */
  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId);
      if (idx === -1) return prev;

      const newTabs = prev.filter((t) => t.id !== tabId);

      // Update active tab if we're closing the active one
      if (activeTabIdRef.current === tabId) {
        if (newTabs.length === 0) {
          setActiveTabId(null);
        } else {
          // Activate the next tab, or the previous one if closing the last
          const nextIdx = Math.min(idx, newTabs.length - 1);
          setActiveTabId(newTabs[nextIdx].id);
        }
      }

      return newTabs;
    });
  }, []);

  /**
   * Activate a tab
   */
  const activateTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  /**
   * Update tab content (for dirty tracking)
   */
  const updateTabContent = useCallback((tabId: string, content: string) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        return {
          ...t,
          content: { ...t.content, content },
          isDirty: content !== t.content.content,
        };
      })
    );
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
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== tabId) return t;
          return {
            ...t,
            content: { ...t.content, content },
            isDirty: false,
          };
        })
      );
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
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, isDirty } : t))
    );
  }, []);

  /**
   * Clear file view (e.g., when switching projects)
   */
  const clearFileView = useCallback(() => {
    setActiveTabId(null);
    setTabs([]);
    setFileTree([]);
    setError(null);
  }, []);

  // Derived state
  const activeTab = tabs.find((t) => t.id === activeTabId) || null;
  const activeFilePath = activeTab?.filePath || null;

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
