import { useCallback, useEffect, useMemo, useState } from 'react';

import { useTerminalTabs } from '@/features/terminal';
import { AGENT_IDS } from '@/shared/constants/agentIds';
import { useProjectStore } from '@/shared/store/projectStore';
import type { FileTab } from '@/shared/types';
import type { EditorAction } from '@/shared/utils/agentPrompt';
import { buildCodeMessage } from '@/shared/utils/agentPrompt';
import { resolveAbsolutePath } from '@/shared/utils/browserUtils';
import {
  getCachedLanguageExtension,
  getLanguageExtension,
  isMarkdownFile,
} from '@/shared/utils/codemirror';
import { isHtmlFile, isJsonFile, isSvgFile } from '@/shared/utils/fileTree';

import type { PreviewMode } from '../types';

import { useEditorAgentActions } from './useEditorAgentActions';

interface UseFileEditorStateParams {
  tab: FileTab;
  projectPath: string | null;
}

/**
 * FileEditor 的基础 UI 状态：preview/source 模式、保存中标记、
 * 语言扩展（同步缓存优先 + 异步加载）、选中文本 AI 工具栏状态。
 */
export function useFileEditorState({ tab, projectPath }: UseFileEditorStateParams) {
  // JSON 源码优先（配置/代码文件常需编辑，格式化预览为辅助）；MD/HTML/SVG 预览优先
  const isJson = isJsonFile(tab.filePath);
  const [previewMode, setPreviewMode] = useState<PreviewMode>(
    () => tab.initialPreviewMode ?? (isJson ? 'source' : 'preview'),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [langExtension, setLangExtension] = useState<import('@codemirror/state').Extension | null>(
    () => getCachedLanguageExtension(tab.filePath),
  );
  const [selectionLines, setSelectionLines] = useState<{
    startLine: number;
    endLine: number;
  } | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null);

  const isMd = isMarkdownFile(tab.filePath);
  const isHtml = isHtmlFile(tab.filePath);
  // SVG 是文本格式：content 可直接进 srcDoc 预览，WSL/SSH 项目同样可用
  const isSvg = isSvgFile(tab.filePath);
  const currentContent = tab.content.content;
  const basePath = useMemo(() => {
    if (!projectPath) return undefined;
    // resolveAbsolutePath handles both relative and absolute filePaths correctly,
    // avoiding the double-root bug (e.g. "E:/ws/C:/project") when filePath is absolute.
    const absFilePath = resolveAbsolutePath(projectPath, tab.filePath);
    const lastSlash = absFilePath.lastIndexOf('/');
    return lastSlash >= 0 ? absFilePath.substring(0, lastSlash) : projectPath.replace(/\\/g, '/');
  }, [projectPath, tab.filePath]);

  // Load language extension (async + cached fallback)
  useEffect(() => {
    const cached = getCachedLanguageExtension(tab.filePath);
    if (cached) {
      // Defer to avoid sync setState in effect (can trigger cascading renders)
      Promise.resolve().then(() => setLangExtension(cached));
      return;
    }
    let cancelled = false;
    getLanguageExtension(tab.filePath).then((ext) => {
      if (!cancelled) setLangExtension(ext);
    });
    return () => {
      cancelled = true;
    };
  }, [tab.filePath]);

  // ── Selection → AI toolbar actions ──
  const { sendToAgent, pending, clearPending } = useEditorAgentActions();
  const currentProjectIdForToolbar = tab.projectId;

  const handleCloseToolbar = useCallback(() => {
    setSelectionLines(null);
    setToolbarPos(null);
  }, []);

  const handleEditorAction = useCallback(
    (action: EditorAction, question?: string) => {
      if (!selectionLines) return;
      const message = buildCodeMessage(
        action,
        {
          filePath: tab.filePath,
          startLine: selectionLines.startLine,
          endLine: selectionLines.endLine,
        },
        question,
      );
      const sent = sendToAgent(currentProjectIdForToolbar, message);
      if (sent) {
        setSelectionLines(null);
        setToolbarPos(null);
      }
    },
    [selectionLines, tab.filePath, currentProjectIdForToolbar, sendToAgent],
  );

  const { addTab: addTerminalTab } = useTerminalTabs();

  const handleCreateTab = useCallback(() => {
    const agentId =
      useProjectStore.getState().activeProject?.selected_agents?.[0] ?? AGENT_IDS.opencode;
    const tabCreated = addTerminalTab(currentProjectIdForToolbar, agentId, agentId);
    if (tabCreated && pending) {
      setTimeout(() => {
        import('@/features/terminal').then(({ sendToTerminal }) => {
          sendToTerminal(currentProjectIdForToolbar, `${pending.message}\r`);
          clearPending();
          setSelectionLines(null);
          setToolbarPos(null);
        });
      }, 1500);
    }
  }, [currentProjectIdForToolbar, pending, clearPending, addTerminalTab]);

  return {
    previewMode,
    setPreviewMode,
    isSaving,
    setIsSaving,
    langExtension,
    selectionLines,
    setSelectionLines,
    toolbarPos,
    setToolbarPos,
    isMd,
    isHtml,
    isSvg,
    isJson,
    currentContent,
    basePath,
    pending,
    handleCloseToolbar,
    handleEditorAction,
    handleCreateTab,
  };
}
