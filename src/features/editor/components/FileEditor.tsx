import { closeSearchPanel, openSearchPanel, searchPanelOpen } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';
import React, { useCallback, useMemo, useRef, useState } from 'react';

import { useCmdHeld } from '@/features/lsp';
import { cn } from '@/lib/utils';
import { useAppContext } from '@/shared/contexts';
import { useLspStore } from '@/shared/store/lspStore';
import { useNotificationStore } from '@/shared/store/notificationStore';
import type { AppTheme, FileTab } from '@/shared/types';

import { useFileActionsContext } from '../FileActionsContext';
import { useEditorBreakpoints } from '../hooks/useEditorBreakpoints';
import { useEditorExtensions } from '../hooks/useEditorExtensions';
import { useEditorSave } from '../hooks/useEditorSave';
import { useEditorViewSnapshot } from '../hooks/useEditorViewSnapshot';
import { useFileEditorState } from '../hooks/useFileEditorState';
import { useLspClient } from '../hooks/useLspClient';
import { useLspNavigation } from '../hooks/useLspNavigation';

import FileEditorView from './FileEditorView';
import UneditableFileView from './UneditableFileView';

interface FileEditorProps {
  tab: FileTab;
  tabKey: string;
  tabId: string;
  externallyModified: boolean;
  theme: AppTheme;
  fontFamily: string;
  fontSize: number;
  projectPath: string | null;
  onSave: (content: string) => Promise<boolean>;
  onContentChange: (tabId: string, content: string) => void;
}

/**
 * 单文件编辑器组装层：组合编辑器状态 / 断点 / LSP / 快照 / 保存 hooks，
 * 组装 CodeMirror extensions 并把渲染职责委托给 FileEditorView
 * （binary / 超大 / preview / source 分支在视图层）。
 */
function FileEditor({
  tab,
  tabKey,
  tabId,
  externallyModified,
  theme,
  fontFamily,
  fontSize,
  projectPath,
  onSave,
  onContentChange,
}: FileEditorProps) {
  // CodeMirror EditorView 引用 + 是否已恢复过位置
  const editorViewRef = useRef<EditorView | null>(null);
  /** Bumped when EditorView mounts so debug highlight can re-apply. */
  const [editorViewEpoch, setEditorViewEpoch] = useState(0);

  // DAP breakpoints (absolute path for adapter)
  const absFilePath = useMemo(() => {
    const fp = tab.filePath;
    if (fp.startsWith('/') || /^[A-Za-z]:[\\/]/.test(fp)) return fp;
    if (!projectPath) return fp;
    const base = projectPath.replace(/[/\\]+$/, '');
    const rel = fp.replace(/^[/\\]+/, '');
    return `${base}/${rel}`.replace(/\\/g, '/');
  }, [projectPath, tab.filePath]);

  const {
    previewMode,
    setPreviewMode,
    setIsSaving,
    langExtension,
    setSelectionLines,
    toolbarPos,
    setToolbarPos,
    isMd,
    isHtml,
    currentContent,
    basePath,
    pending,
    handleCloseToolbar,
    handleEditorAction,
    handleCreateTab,
  } = useFileEditorState({ tab, projectPath });

  const {
    bpGutterExt,
    bpSyncEffect,
    lastSyncedBpKeyRef,
    handleLnClick,
    handleLnHover,
    handleLnLeave,
  } = useEditorBreakpoints({
    projectId: tab.projectId,
    absFilePath,
    filePath: tab.filePath,
    editorViewRef,
    editorViewEpoch,
  });

  const { lspLanguageIdRef, lspClientExt, linkHighlightExt } = useLspClient({
    projectPath,
    filePath: tab.filePath,
  });

  const { lspKeymap, cmdClickExt } = useLspNavigation({
    projectPath,
    tabKey,
    tab,
    lspLanguageIdRef,
    editorViewRef,
  });

  const { handleCreateEditor, viewStateExt, resetEditorRestored } = useEditorViewSnapshot({
    tabKey,
    tabId,
    tab,
    absFilePath,
    bpSyncEffect,
    lastSyncedBpKeyRef,
    setSelectionLines,
    setToolbarPos,
    editorViewRef,
    setEditorViewEpoch,
  });

  const {
    handleEditorChange,
    handleReload,
    handleKeepEdits,
    saveKeymap,
    canOpenInBrowser,
    handleOpenInBrowser,
    handleOpenInSystemBrowser,
  } = useEditorSave({
    tab,
    tabKey,
    tabId,
    projectPath,
    currentContent,
    setIsSaving,
    onSave,
    onContentChange,
    onReloaded: resetEditorRestored,
  });

  const { extensions, cmTheme } = useEditorExtensions({
    fontFamily,
    fontSize,
    langExtension,
    saveKeymap,
    viewStateExt,
    lspClientExt,
    lspKeymap,
    cmdClickExt,
    linkHighlightExt,
    bpGutterExt,
    handleLnClick,
    handleLnHover,
    handleLnLeave,
  });

  // Cmd/Ctrl held state — used for link highlight pointer cursor style
  const cmdHeld = useCmdHeld();
  // 显式跳转进行中 → loading 光标（冷启动 server 握手时给出可感知反馈）
  const isJumping = useLspStore((state) => state.isDefinitionJumping);
  const cmClassName = cn(
    'h-full overflow-hidden',
    cmdHeld && 'cmd-held',
    isJumping && 'lsp-jumping',
  );

  // Markdown / HTML preview 模式下点击内部链接时打开目标文件
  const { onFileSelect } = useFileActionsContext();
  const handleInternalLinkClick = useCallback(
    async (absPath: string) => {
      if (!onFileSelect) return;
      const ok = await onFileSelect(absPath);
      if (!ok) {
        useNotificationStore
          .getState()
          .addNotification({ type: 'error', title: '无法打开文件', message: absPath });
      }
    },
    [onFileSelect],
  );

  // 页内内容搜索：标题栏「搜索」按钮开合 CodeMirror 查找面板（Ctrl+F 由 searchKeymap 承担）
  const handleOpenSearch = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;
    if (searchPanelOpen(view.state)) closeSearchPanel(view);
    else openSearchPanel(view);
  }, []);

  // AI 助手：占位入口，后续接入 Agent 选择器
  const { showToast } = useAppContext();
  const handleOpenAI = useCallback(() => {
    showToast('AI 助手功能即将接入', 'info');
  }, [showToast]);

  // Determine if file can be edited
  const canEdit = !tab.readOnly && !tab.content.is_binary && tab.content.size <= 512 * 1024;

  // Binary / oversized → 不可编辑占位视图（分支仍在编排层：早退避免无谓 hooks 消费）
  if (tab.content.is_binary) {
    return (
      <UneditableFileView
        filePath={tab.filePath}
        projectPath={projectPath}
        size={tab.content.size}
        message="Binary file — cannot be displayed"
      />
    );
  }
  if (tab.content.size > 512 * 1024) {
    return (
      <UneditableFileView
        filePath={tab.filePath}
        projectPath={projectPath}
        size={tab.content.size}
        message="File too large to edit (> 500 KB)"
      />
    );
  }

  return (
    <FileEditorView
      tab={tab}
      tabKey={tabKey}
      tabId={tabId}
      projectPath={projectPath}
      theme={theme}
      externallyModified={externallyModified}
      previewMode={previewMode}
      isMd={isMd}
      isHtml={isHtml}
      currentContent={currentContent}
      basePath={basePath}
      canEdit={canEdit}
      extensions={extensions}
      cmTheme={cmTheme}
      cmClassName={cmClassName}
      onEditorChange={handleEditorChange}
      onCreateEditor={handleCreateEditor}
      onKeepEdits={handleKeepEdits}
      onReload={handleReload}
      callbacks={{
        onTogglePreview: () => setPreviewMode((m) => (m === 'preview' ? 'source' : 'preview')),
        onOpenInBrowser: handleOpenInBrowser,
        onOpenInSystemBrowser: handleOpenInSystemBrowser,
        canOpenInBrowser,
        onOpenSearch: handleOpenSearch,
        onOpenAI: handleOpenAI,
        onInternalLinkClick: handleInternalLinkClick,
      }}
      toolbarPos={toolbarPos}
      onToolbarAction={handleEditorAction}
      onToolbarClose={handleCloseToolbar}
      pendingAgentName={pending !== null ? 'Agent' : null}
      onCreateAgentTab={handleCreateTab}
    />
  );
}

export default React.memo(FileEditor);
