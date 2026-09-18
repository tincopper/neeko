import { keymap } from '@codemirror/view';
import { useCallback, useMemo } from 'react';

import { openInDefaultBrowser } from '@/features/browser/api/browserApi';
import { readFileContent } from '@/features/file/api/fileApi';
import { useActiveProject } from '@/features/project';
import { useAppContext } from '@/shared/contexts';
import { useCodeMirrorBinding } from '@/shared/hooks/useResolvedShortcuts';
import { useEditorStore } from '@/shared/store/editorStore';
import type { FileTab } from '@/shared/types';
import { filePathToFileUrl, openHtmlInBrowserPanel } from '@/shared/utils/browserUtils';
import { clearViewSnapshot } from '@/shared/utils/editorViewState';
import { canonicalFsPath } from '@/shared/utils/fileRef';

interface UseEditorSaveParams {
  tab: FileTab;
  tabKey: string;
  tabId: string;
  projectPath: string | null;
  setIsSaving: (v: boolean) => void;
  onSave: (content: string) => Promise<boolean>;
  onContentChange: (tabId: string, content: string) => void;
  onReloaded?: () => void;
}

/**
 * 文件保存与外部修改处理：Ctrl+S 保存、外部修改 reload/保留编辑、
 * HTML 浏览器打开能力、CodeMirror change 转发。
 *
 * **配置纯净**：本 hook 产出的 `saveKeymap` 会进入 CodeMirror 的 extensions 数组，
 * 而宿主 `@uiw/react-codemirror` 在 extensions 身份变化时 dispatch
 * `StateEffect.reconfigure` 重建整个扩展世界（lint 等经 appendConfig 惰性安装的扩展
 * 会被丢掉）。因此活文档状态（内容 / 脏标记）**不得**进入依赖数组——按下快捷键时
 * 从 store 读取（store 本就是文件内容的单一事实源），而不是在渲染期捕获闭包。
 * 见 `useEditorExtensions` 的「配置纯净」不变量。
 */
export function useEditorSave({
  tab,
  tabKey,
  tabId,
  projectPath,
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

  /** 按键时读取本 tab 的最新内容与脏标记（不进渲染依赖，故 keymap 身份稳定）。 */
  const readFileTabState = useCallback((): { content: string; isDirty: boolean } | null => {
    const found = useEditorStore.getState().tabs[tabKey]?.tabs.find((t) => t.id === tabId);
    if (!found || found.data.kind !== 'file') return null;
    return { content: found.data.content.content, isDirty: found.data.isDirty };
  }, [tabKey, tabId]);

  const handleSave = useCallback(async () => {
    const current = readFileTabState();
    if (!current) return;
    setIsSaving(true);
    try {
      await onSave(current.content);
    } finally {
      setIsSaving(false);
    }
  }, [onSave, readFileTabState, setIsSaving]);

  // 获取 capabilities（用于判断是否显示 Open in Browser）
  const { project, capabilities } = useActiveProject();
  const { showToast } = useAppContext();
  const canOpenInBrowser = capabilities?.canEditFiles ?? false;

  // 在 Browser Panel 中打开 HTML 文件
  const handleOpenInBrowser = useCallback(() => {
    if (!projectPath || !canOpenInBrowser) return;
    openHtmlInBrowserPanel(canonicalFsPath(projectPath, tab.filePath));
  }, [tab.filePath, projectPath, canOpenInBrowser]);

  // 用系统默认浏览器打开 HTML 文件
  const handleOpenInSystemBrowser = useCallback(() => {
    if (!projectPath || !canOpenInBrowser) return;
    const absPath = canonicalFsPath(projectPath, tab.filePath);
    const fileUrl = filePathToFileUrl(absPath);
    openInDefaultBrowser(fileUrl, project?.id).catch((err) => {
      console.error('[FileViewer] Failed to open in system browser:', err);
      showToast('Failed to open in system browser', 'error');
    });
  }, [tab.filePath, projectPath, canOpenInBrowser, project?.id, showToast]);

  // Save shortcut — from user-configurable shortcut registry (default Ctrl+S).
  // 身份稳定：只依赖快捷键与稳定的回调；脏检查/内容在按键时从 store 读取。
  const saveCmKey = useCodeMirrorBinding('saveFile');
  const runSave = useCallback((): boolean => {
    if (!readFileTabState()?.isDirty) return false;
    void handleSave();
    return true;
  }, [handleSave, readFileTabState]);

  const saveKeymap = useMemo(() => {
    if (!saveCmKey) return [];
    return keymap.of([{ key: saveCmKey, run: runSave, preventDefault: true }]);
  }, [saveCmKey, runSave]);

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
