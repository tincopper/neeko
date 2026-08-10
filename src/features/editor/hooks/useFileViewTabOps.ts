import { useCallback } from 'react';

import { useSaveAsStore } from '@/features/action-menu/store/saveAsStore';
import { readFileContent, writeFileContent } from '@/features/file/api/fileApi';
import { useFileStore } from '@/features/file/store';
import { closeEditorTab } from '@/features/terminal';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { FileContent, Tab } from '@/shared/types';
import type { ProjectCommands } from '@/shared/types/activeProject';
import { clearViewSnapshot, clearAllForTabKey } from '@/shared/utils/editorViewState';
import { getFileName, getTabId, isFileTab } from '@/shared/utils/fileTree';
import { parseProjectIdFromTabKey } from '@/shared/utils/tabKey';

interface UseFileViewTabOpsParams {
  tabKeyRef: React.MutableRefObject<string | null>;
  worktreePathRef: React.MutableRefObject<string | undefined | null>;
  externalCommandsRef: React.MutableRefObject<ProjectCommands | null | undefined>;
  setError: (msg: string | null) => void;
}

/**
 * useFileViewTabOps — 文件标签页操作：打开 / 关闭 / 激活 / 更新 / 保存 / 脏标记 / 清空。
 * 通过 refs 读取最新 tabKey / worktree / externalCommands，避免闭包过期。
 */
export function useFileViewTabOps({
  tabKeyRef,
  worktreePathRef,
  externalCommandsRef,
  setError,
}: UseFileViewTabOpsParams) {
  /**
   * Open a file - adds a new tab or activates existing tab
   */
  const openFile = useCallback(
    async (filePath: string) => {
      const tk = tabKeyRef.current;
      if (!tk) return;

      const projectId = parseProjectIdFromTabKey(tk);
      const tabId = getTabId(tk, filePath);

      // If tab already exists, re-read content from disk and activate
      const existing = useEditorStore.getState().tabs[tk];
      const existingTab = existing?.tabs.find((t) => t.id === tabId);
      if (existingTab) {
        if (existingTab.data.kind === 'file') {
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
                  kind: 'file',
                  externallyModified: true,
                });
              } else {
                useEditorStore.getState().updateTab(tk, tabId, {
                  kind: 'file',
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

      // Load file content — 不触碰文件树 loading 状态（树加载由 store.loadDir 独立治理）
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
          content = await readFileContent(projectId, filePath, rootPath ?? null);
        }

        const newTab: Tab = {
          id: tabId,
          projectId,
          title: getFileName(filePath),
          order: existing?.tabs.length ?? 0,
          data: {
            kind: 'file',
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
    },
    [setError, tabKeyRef, worktreePathRef, externalCommandsRef],
  );

  /**
   * Close a tab
   */
  const closeTab = useCallback(
    (tabId: string) => {
      const tk = tabKeyRef.current;
      if (!tk) return;
      clearViewSnapshot(tk, tabId);
      // Recycle any terminal PTY if this tab hosted a session.
      closeEditorTab(tk, tabId);
    },
    [tabKeyRef],
  );

  /**
   * Activate a tab
   */
  const activateTab = useCallback(
    (tabId: string) => {
      const tk = tabKeyRef.current;
      if (!tk) return;
      useEditorStore.getState().activateTab(tk, tabId);
    },
    [tabKeyRef],
  );

  /**
   * Update tab content (for dirty tracking)
   */
  const updateTabContent = useCallback(
    (tabId: string, content: string) => {
      const tk = tabKeyRef.current;
      if (!tk) return;

      const projTabs = useEditorStore.getState().tabs[tk];
      if (!projTabs) return;

      const tab = projTabs.tabs.find((t) => t.id === tabId);
      if (!tab || tab.data.kind !== 'file') return;

      useEditorStore.getState().updateTab(tk, tabId, {
        content: { ...tab.data.content, content },
        isDirty: content !== tab.data.content.content,
      });
    },
    [tabKeyRef],
  );

  /**
   * Save file content
   */
  const saveFile = useCallback(
    async (content: string): Promise<boolean> => {
      const tk = tabKeyRef.current;
      if (!tk) return false;

      const projTabs = useEditorStore.getState().tabs[tk];
      if (!projTabs) return false;

      // Find the active file tab
      const active = projTabs.tabs.find((t) => t.id === projTabs.activeTabId);
      const fileTab =
        active && active.data.kind === 'file' ? active : projTabs.tabs.find(isFileTab);
      if (!fileTab || fileTab.data.kind !== 'file') return false;

      // Untitled tab → trigger Save As dialog
      if (fileTab.data.isUntitled) {
        const projectPath = useProjectStore.getState().activeProject?.path ?? '';
        // Worktree 激活时，Save As 默认目录应为 worktree 根目录，而非项目根目录
        const defaultDirectory = worktreePathRef.current ?? projectPath;
        useSaveAsStore.getState().requestSaveAs({
          tabId: fileTab.id,
          tabKey: tk,
          projectId: fileTab.projectId,
          content,
          defaultDirectory,
          defaultFilename: fileTab.data.untitledName ?? fileTab.data.fileName,
        });
        return false;
      }

      try {
        const rootPath = worktreePathRef.current ?? undefined;
        const cmds = externalCommandsRef.current;
        if (cmds) {
          // WSL/Remote 模式：通过 ProjectCommands 接口调用
          await cmds.writeFileContent(fileTab.data.filePath, content, rootPath);
        } else {
          // Local 模式：通过 unified 命令
          await writeFileContent(fileTab.projectId, fileTab.data.filePath, content);
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
    },
    [tabKeyRef, worktreePathRef, externalCommandsRef, setError],
  );

  /**
   * Mark tab as dirty
   */
  const setTabDirty = useCallback(
    (tabId: string, isDirty: boolean) => {
      const tk = tabKeyRef.current;
      if (!tk) return;

      const projTabs = useEditorStore.getState().tabs[tk];
      if (!projTabs) return;

      const tab = projTabs.tabs.find((t) => t.id === tabId);
      if (!tab || tab.data.kind !== 'file') return;

      useEditorStore.getState().updateTab(tk, tabId, {
        content: tab.data.content,
        isDirty,
      });
    },
    [tabKeyRef],
  );

  /**
   * Clear file view (e.g., when switching projects)
   */
  const clearFileView = useCallback(() => {
    const tk = tabKeyRef.current;
    if (tk) clearAllForTabKey(tk);
    useFileStore.getState().reset();
    setError(null);
  }, [tabKeyRef, setError]);

  return {
    openFile,
    closeTab,
    activateTab,
    updateTabContent,
    saveFile,
    setTabDirty,
    clearFileView,
  };
}
