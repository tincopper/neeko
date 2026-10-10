import { useCallback } from 'react';

import { useSaveAsStore } from '@/features/action-menu/store/saveAsStore';
import { readFileContent, writeFileContent } from '@/features/file/api/fileApi';
import { useFileStore } from '@/features/file/store';
import { closeEditorTab } from '@/features/terminal';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { FileContent, Tab } from '@/shared/types';
import { clearViewSnapshot, clearAllForTabKey } from '@/shared/utils/editorViewState';
import { canonicalFsPath } from '@/shared/utils/fileRef';
import { getFileName, getTabId, isFileTab } from '@/shared/utils/fileTree';
import { requireTabWorkspaceSession } from '@/shared/utils/tabIdentity';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

interface UseFileViewTabOpsParams {
  tabKeyRef: React.MutableRefObject<string | null>;
  /**
   * 当前视图单元的身份**值**（上游单点构造）。openFile 的地址、身份基准、组键
   * 全部由它派生 —— 不再从 tabKey 解回 projectId、不再另传 worktreePath ref
   * （两源混合 = session 内部可不一致的根因）。
   */
  workspaceRef: React.MutableRefObject<WorkspaceSession | null>;
  setError: (msg: string | null) => void;
}

/**
 * useFileViewTabOps — 文件标签页操作：打开 / 关闭 / 激活 / 更新 / 保存 / 脏标记 / 清空。
 * 通过 refs 读取最新 tabKey / workspace，避免闭包过期。
 */
export function useFileViewTabOps({ tabKeyRef, workspaceRef, setError }: UseFileViewTabOpsParams) {
  /**
   * Open a file - adds a new tab or activates existing tab
   */
  const openFile = useCallback(
    async (rawPath: string): Promise<boolean> => {
      const ws = workspaceRef.current;
      if (!ws) return false;
      const tk = tabKeyRef.current;
      if (!tk) return false;

      const { projectId, worktreePath } = ws;
      const projectPath =
        useProjectStore.getState().projects.find((p) => p.id === projectId)?.path ?? '';
      // 身份基准与读取地址同源：worktree 激活用 worktree 根，否则项目根。
      const identityRoot = worktreePath ?? projectPath;
      const filePath = canonicalFsPath(identityRoot, rawPath);
      const tabId = getTabId(tk, filePath);

      // If tab already exists, re-read content from disk and activate
      const existing = useEditorStore.getState().tabs[tk];
      const existingTab = existing?.tabs.find((t) => t.id === tabId);
      if (existingTab) {
        if (existingTab.data.kind === 'file') {
          try {
            const newContent = await readFileContent(ws, filePath);
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
        return true;
      }

      // Load file content — 不触碰文件树 loading 状态（树加载由 store.loadDir 独立治理）
      setError(null);
      try {
        // 地址对象（单元根）：Local / WSL / Remote 同一后端命令，按 ExecTarget 路由。
        const content: FileContent = await readFileContent(ws, filePath);

        const newTab: Tab = {
          id: tabId,
          scope: { kind: 'workspace', session: ws },
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

        useEditorStore.getState().addTab(newTab);
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      }
    },
    [setError, tabKeyRef, workspaceRef],
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
   * Save file content.
   * 传入 `tabId` 时保存指定 tab；`closeAfterSave` 标记本次保存来自关闭确认链路
   * （untitled 触发 Save As 后，保存成功即关 tab）——Ctrl+S 手动保存不传。
   */
  const saveFile = useCallback(
    async (content: string, tabId?: string, closeAfterSave?: boolean): Promise<boolean> => {
      const tk = tabKeyRef.current;
      if (!tk) return false;

      const projTabs = useEditorStore.getState().tabs[tk];
      if (!projTabs) return false;

      // Find the active file tab (or the tab specified by tabId)
      const target = tabId
        ? projTabs.tabs.find((t) => t.id === tabId)
        : projTabs.tabs.find((t) => t.id === projTabs.activeTabId);
      const fileTab =
        target && target.data.kind === 'file' ? target : projTabs.tabs.find(isFileTab);
      if (!fileTab || fileTab.data.kind !== 'file') return false;

      // Untitled tab → trigger Save As dialog
      if (fileTab.data.isUntitled) {
        const tabSession = requireTabWorkspaceSession(fileTab);
        const projectPath =
          useProjectStore.getState().projects.find((p) => p.id === tabSession.projectId)?.path ??
          '';
        // Save As 默认目录 = 该 tab 所属单元的工作树根（worktree 可在项目根外）。
        const defaultDirectory = tabSession.worktreePath ?? projectPath;
        useSaveAsStore.getState().requestSaveAs({
          tabId: fileTab.id,
          tabKey: tk,
          projectId: tabSession.projectId,
          content,
          defaultDirectory,
          defaultFilename: fileTab.data.untitledName ?? fileTab.data.fileName,
          closeAfterSave,
        });
        return false;
      }

      try {
        // 地址 = tab.scope 携带的唯一地址值 ——不取「当前激活视图」：
        // 后台组保存 / 切换后保存若用现场重组的 ref，会写错工作树（单元漂移）。
        await writeFileContent(requireTabWorkspaceSession(fileTab), fileTab.data.filePath, content);

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
    [tabKeyRef, setError],
  );

  /**
   * Save a specific file tab by its id (used by the unsaved-close confirmation).
   * Reads the tab's current content from the store and saves it.
   */
  const saveTabById = useCallback(
    async (tabId: string): Promise<boolean> => {
      const tk = tabKeyRef.current;
      if (!tk) return false;

      const projTabs = useEditorStore.getState().tabs[tk];
      const tab = projTabs?.tabs.find((t) => t.id === tabId);
      if (!tab || tab.data.kind !== 'file') return false;

      // 关闭确认链路：untitled 走 Save As 成功后由对话框关 tab（closeAfterSave）
      return saveFile(tab.data.content.content, tabId, true);
    },
    [tabKeyRef, saveFile],
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
    saveTabById,
    setTabDirty,
    clearFileView,
  };
}
