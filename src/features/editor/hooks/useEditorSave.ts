import { keymap } from '@codemirror/view';
import { useCallback, useMemo } from 'react';

import { openInDefaultBrowser } from '@/features/browser/api/browserApi';
import { readFileContent } from '@/features/file/api/fileApi';
import { useActiveProject } from '@/features/project';
import { useAppContext } from '@/shared/contexts';
import { useCodeMirrorBinding } from '@/shared/hooks/useResolvedShortcuts';
import { useEditorStore } from '@/shared/store/editorStore';
import type { FileTab } from '@/shared/types';
import {
  filePathToFileUrl,
  openHtmlInBrowserPanel,
  resolveAbsolutePath,
} from '@/shared/utils/browserUtils';
import { clearViewSnapshot } from '@/shared/utils/editorViewState';

interface UseEditorSaveParams {
  tab: FileTab;
  tabKey: string;
  tabId: string;
  projectPath: string | null;
  currentContent: string;
  setIsSaving: (v: boolean) => void;
  onSave: (content: string) => Promise<boolean>;
  onContentChange: (tabId: string, content: string) => void;
  onReloaded?: () => void;
}

/**
 * 文件保存与外部修改处理：Ctrl+S 保存、外部修改 reload/保留编辑、
 * HTML 浏览器打开能力、CodeMirror change 转发。
 */
export function useEditorSave({
  tab,
  tabKey,
  tabId,
  projectPath,
  currentContent,
  setIsSaving,
  onSave,
  onContentChange,
  onReloaded,
}: UseEditorSaveParams) {
  const handleEditorChange = useCallback(
    (value: string) => {
      onContentChange(tab.id, value);
    },
    [tab.id, onContentChange],
  );

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    await onSave(currentContent);
    setIsSaving(false);
  }, [currentContent, onSave, setIsSaving]);

  // 获取 capabilities（用于判断是否显示 Open in Browser）
  const { project, capabilities } = useActiveProject();
  const { showToast } = useAppContext();
  const canOpenInBrowser = capabilities?.canEditFiles ?? false;

  // 在 Browser Panel 中打开 HTML 文件
  const handleOpenInBrowser = useCallback(() => {
    if (!projectPath || !canOpenInBrowser) return;
    openHtmlInBrowserPanel(resolveAbsolutePath(projectPath, tab.filePath));
  }, [tab.filePath, projectPath, canOpenInBrowser]);

  // 用系统默认浏览器打开 HTML 文件
  const handleOpenInSystemBrowser = useCallback(() => {
    if (!projectPath || !canOpenInBrowser) return;
    const absPath = resolveAbsolutePath(projectPath, tab.filePath);
    const fileUrl = filePathToFileUrl(absPath);
    openInDefaultBrowser(fileUrl, project?.id).catch((err) => {
      console.error('[FileViewer] Failed to open in system browser:', err);
      showToast('Failed to open in system browser', 'error');
    });
  }, [tab.filePath, projectPath, canOpenInBrowser, project?.id, showToast]);

  // Save shortcut — from user-configurable shortcut registry (default Ctrl+S).
  const saveCmKey = useCodeMirrorBinding('saveFile');
  const saveKeymap = useMemo(() => {
    if (!saveCmKey) return [];
    return keymap.of([
      {
        key: saveCmKey,
        run: () => {
          if (tab.isDirty) {
            handleSave();
            return true;
          }
          return false;
        },
        preventDefault: true,
      },
    ]);
  }, [saveCmKey, tab.isDirty, handleSave]);

  // 处理外部文件修改：重新加载
  const handleReload = useCallback(async () => {
    try {
      const content = await readFileContent(tab.projectId, tab.filePath);
      useEditorStore.getState().updateTab(tabKey, tabId, {
        kind: 'file',
        content,
        isDirty: false,
        externallyModified: false,
      });
      // 文件内容已变，旧 selection 偏移可能越界，清掉以免恢复到错误位置
      clearViewSnapshot(tabKey, tabId, 'editor');
      onReloaded?.();
    } catch (e) {
      console.error('[FileEditor] Failed to reload file:', e);
    }
  }, [tab.projectId, tab.filePath, tabKey, tabId, onReloaded]);

  // 处理外部文件修改：保留当前编辑
  const handleKeepEdits = useCallback(() => {
    useEditorStore.getState().updateTab(tabKey, tabId, {
      kind: 'file',
      externallyModified: false,
    });
  }, [tabKey, tabId]);

  return {
    handleEditorChange,
    handleSave,
    handleReload,
    handleKeepEdits,
    saveKeymap,
    canOpenInBrowser,
    handleOpenInBrowser,
    handleOpenInSystemBrowser,
  };
}
