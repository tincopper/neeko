import { closeSearchPanel, openSearchPanel, searchPanelOpen } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';
import React, { useCallback, useMemo, useRef, useState } from 'react';

import { useCmdHeld } from '@/features/lsp';
import { cn } from '@/lib/utils';
import ContextMenu from '@/shared/components/ContextMenu';
import { useAppContext } from '@/shared/contexts';
import { useLspStore } from '@/shared/store/lspStore';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { AppTheme, FileTab } from '@/shared/types';
import { isImageFile } from '@/shared/utils/fileTree';

import { useFileActionsContext } from '../FileActionsContext';
import { useEditorBreakpoints } from '../hooks/useEditorBreakpoints';
import { useEditorExtensions } from '../hooks/useEditorExtensions';
import { useEditorSave } from '../hooks/useEditorSave';
import { useEditorViewSnapshot } from '../hooks/useEditorViewSnapshot';
import { useFileEditorState } from '../hooks/useFileEditorState';
import { useLspClient } from '../hooks/useLspClient';
import { useLspNavigation } from '../hooks/useLspNavigation';
import { useTestRunActions } from '../hooks/useTestRunActions';
import { useUnifiedGutterExtension } from '../hooks/useUnifiedGutter';

import EditorHeader from './EditorHeader';
import FileEditorView from './FileEditorView';
import ImageFileView from './ImageFileView';
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
    isSvg,
    isJson,
    currentContent,
    basePath,
    pending,
    handleCloseToolbar,
    handleEditorAction,
    handleCreateTab,
  } = useFileEditorState({ tab, projectPath });

  // 二进制图片仅本地项目可预览：asset 协议无法访问 SSH/WSL 远程文件
  const projectEnvironmentType = useProjectStore(
    (s) => s.projects.find((p) => p.id === tab.projectId)?.environment.type,
  );
  const isBinaryImage =
    tab.content.is_binary && isImageFile(tab.filePath) && projectEnvironmentType === 'Local';

  const { bpSyncEffect, lastSyncedBpKeyRef, handleLnClick, handleLnHover, handleLnLeave } =
    useEditorBreakpoints({
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

  // Determine if file can be edited
  const canEdit = !tab.readOnly && !tab.content.is_binary && tab.content.size <= 512 * 1024;

  // 测试运行动作（TS 点击直跑 → Task Console，
  // Rust 点击弹 Run/Debug 下拉菜单 → Run 走 Task Console / Debug 走 lldb 会话）
  const { handleRunTest, menu, menuItems, openMenu, closeMenu } = useTestRunActions({
    projectId: tab.projectId,
    filePath: tab.filePath,
    projectPath,
  });
  // 统一 gutter 单列：断点红点常驻 + 测试 play 标记叠加（可编辑测试文件）。
  // 替代旧双列（cm-breakpoint-gutter + cm-test-run-gutter）：同一 markers 来源
  // 合并断点状态与用例检测，同行共存时渲染组合 cell，可分别点击。
  const bpGutterExt = useUnifiedGutterExtension({
    projectId: tab.projectId,
    absFilePath,
    fileName: tab.filePath,
    enabled: canEdit,
    onRun: handleRunTest,
    onMenuRequest: openMenu,
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

  // Binary / oversized → 不可编辑占位视图；本地二进制图片走图片预览（分支仍在编排层）
  if (tab.content.is_binary) {
    if (isBinaryImage) {
      return (
        <div className="flex-1 flex flex-col">
          <EditorHeader
            filePath={tab.filePath}
            projectPath={projectPath}
            isDirty={false}
            isMd={false}
            isHtml={false}
            isSvg={false}
            isJson={false}
            previewMode="preview"
            onTogglePreview={() => {}}
          />
          <ImageFileView absPath={absFilePath} fileName={tab.fileName} />
        </div>
      );
    }
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
    <>
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
        isSvg={isSvg}
        isJson={isJson}
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
          onSetViewMode: setPreviewMode,
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

      {/* 测试运行下拉菜单（Rust 用例 gutter 图标点击触发；选择后/Esc/外点关闭） */}
      {menu && (
        <ContextMenu position={{ x: menu.x, y: menu.y }} items={menuItems} onClose={closeMenu} />
      )}
    </>
  );
}

export default React.memo(FileEditor);
