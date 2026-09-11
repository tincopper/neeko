import type { EditorView } from '@codemirror/view';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useCmdHeld } from '@/features/lsp';
import { useLspStore } from '@/features/lsp/store/lspStore';
import { cn } from '@/lib/utils';
import ContextMenu from '@/shared/components/ContextMenu';
import { useProjectStore } from '@/shared/store/projectStore';
import type { AppTheme, FileTab } from '@/shared/types';
import { canonicalFsPath } from '@/shared/utils/fileRef';
import { isImageFile } from '@/shared/utils/fileTree';
import { tabLspDocumentUri } from '@/shared/utils/jdt';

import { useEditorBreakpoints } from '../hooks/useEditorBreakpoints';
import { useEditorExtensions } from '../hooks/useEditorExtensions';
import { useEditorSave } from '../hooks/useEditorSave';
import { useEditorViewSnapshot } from '../hooks/useEditorViewSnapshot';
import { useFileEditorCallbacks } from '../hooks/useFileEditorCallbacks';
import { useFileEditorState } from '../hooks/useFileEditorState';
import { useLspClient } from '../hooks/useLspClient';
import { useLspNavigation } from '../hooks/useLspNavigation';
import { useRunActions } from '../hooks/useRunActions';
import { useUnifiedGutterExtension } from '../hooks/useUnifiedGutter';

import FileEditorFallback, { fileEditorFallbackKind } from './FileEditorFallback';
import FileEditorView from './FileEditorView';

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

  // DAP breakpoints（adapter 需要绝对路径）：filePath 恒为 canonical 绝对（jdt
  // 展示路径除外——断点对虚拟文档本就无意义），lexical 归一即可，不再内联拼根。
  const absFilePath = useMemo(
    () => canonicalFsPath(projectPath ?? '', tab.filePath),
    [projectPath, tab.filePath],
  );

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

  // hover 的 jdt:// 链接 → 跳转的晚绑定：useLspClient 需要稳定回调（共享 client
  // 首建时捕获），而 navigateToLocation 属于其后的 useLspNavigation —— 经 ref 解耦，
  // 双向均不感知对方（回调签名只收 uri，语义同 Cmd+Click 跳转）。
  const openJdtLinkRef = useRef<((uri: string) => void) | null>(null);

  const { lspLanguageIdRef, lspClientExt, linkHighlightExt } = useLspClient({
    projectPath,
    filePath: tab.filePath,
    virtualUri: tab.virtualUri ?? tabLspDocumentUri(tab),
    onOpenJdtLink: useCallback((uri: string) => openJdtLinkRef.current?.(uri), []),
  });

  const { lspKeymap, cmdClickExt, navigateToLocation } = useLspNavigation({
    projectPath,
    tabKey,
    tab,
    lspLanguageIdRef,
    editorViewRef,
  });

  useEffect(() => {
    openJdtLinkRef.current = (uri: string) => {
      void navigateToLocation(
        { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
        projectPath ?? '',
        tabKey,
        tab.projectId,
        tab.filePath,
        null,
      );
    };
    return () => {
      openJdtLinkRef.current = null;
    };
  }, [navigateToLocation, projectPath, tabKey, tab.projectId, tab.filePath]);

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

  // 可运行动作（TS 点击直跑 → Task Console；Rust/Go/Java 测试用例与 main 入口
  // 点击弹 Run/Debug 下拉菜单 → Run 走 Task Console / Debug 走 DAP 会话）
  const { handleRun, menu, menuItems, openMenu, closeMenu } = useRunActions({
    projectId: tab.projectId,
    filePath: tab.filePath,
    projectPath,
  });
  // 统一 gutter 单列：断点红点常驻 + 可运行 play 标记叠加（测试用例与 main 共用）。
  const bpGutterExt = useUnifiedGutterExtension({
    projectId: tab.projectId,
    absFilePath,
    fileName: tab.filePath,
    projectPath,
    enabled: canEdit,
    // onRun 仅 TS 用例触发（扩展内 targetLang==='ts' 才直跑），单一 handleRun 直接接管
    onRun: handleRun,
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
  const { handleInternalLinkClick, handleOpenSearch, handleOpenAI } = useFileEditorCallbacks({
    editorViewRef,
  });

  // 二进制（含本地图片预览）/ 超大文件 → 只读兜底视图（分支判定见 fileEditorFallbackKind）。
  const fallbackKind = fileEditorFallbackKind(tab, isBinaryImage);
  if (fallbackKind) {
    return (
      <FileEditorFallback
        kind={fallbackKind}
        tab={tab}
        projectPath={projectPath}
        absFilePath={absFilePath}
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

      {/* Run/Debug 下拉菜单（Rust/Go/Java 用例与 main 入口共用；选择后/Esc/外点关闭） */}
      {menu && (
        <ContextMenu position={{ x: menu.x, y: menu.y }} items={menuItems} onClose={closeMenu} />
      )}
    </>
  );
}

export default React.memo(FileEditor);
