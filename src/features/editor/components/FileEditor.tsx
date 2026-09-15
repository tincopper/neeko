import type { EditorView } from '@codemirror/view';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { useCmdHeld } from '@/features/lsp';
import { useLspStore } from '@/features/lsp/store/lspStore';
import { useRunActions } from '@/features/runner';
import { cn } from '@/lib/utils';
import ContextMenu from '@/shared/components/ContextMenu';
import type { AppTheme, FileTab } from '@/shared/types';
import { sourceIdentityOf } from '@/shared/utils/fileRef';
import { tabLspDocumentUri } from '@/shared/utils/jdt';

import { useBinaryImagePreview } from '../hooks/useBinaryImagePreview';
import { useEditorBreakpoints } from '../hooks/useEditorBreakpoints';
import { useEditorExtensions } from '../hooks/useEditorExtensions';
import { useEditorSave } from '../hooks/useEditorSave';
import { useEditorViewSnapshot } from '../hooks/useEditorViewSnapshot';
import { useFileEditorCallbacks } from '../hooks/useFileEditorCallbacks';
import { useFileEditorState } from '../hooks/useFileEditorState';
import { useJdtLinkNavigation } from '../hooks/useJdtLinkNavigation';
import { useLspClient } from '../hooks/useLspClient';
import { useLspNavigation } from '../hooks/useLspNavigation';
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

  // DAP 断点 key = **规范源身份**（见 sourceIdentityOf）：同一份源码只有一种身份，
  // 因此「Cmd+Click 打开的 jdt 虚拟页」与「调试停点打开的 JDK 源码」是同一个 key
  // ——断点不会因跳转而消失。
  const absFilePath = useMemo(
    () => sourceIdentityOf(projectPath ?? '', tab.filePath),
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

  // 二进制图片仅本地项目可预览（asset 协议无法访问 SSH/WSL 远程文件）——环境查询收在 hook 内
  const isBinaryImage = useBinaryImagePreview(tab);

  const { bpSyncEffect, lastSyncedBpKeyRef, handleLnClick, handleLnHover, handleLnLeave } =
    useEditorBreakpoints({
      projectId: tab.projectId,
      absFilePath,
      filePath: tab.filePath,
      editorViewRef,
      editorViewEpoch,
    });

  // hover 的 jdt:// 链接 → 跳转：回调引用恒定（可先交给 useLspClient），
  // navigateToLocation 就绪后再 bind（两段式晚绑定，见 useJdtLinkNavigation）。
  const { onOpenJdtLink, bind: bindJdtLinkNav } = useJdtLinkNavigation();

  const { lspLanguageIdRef, lspClientExt, linkHighlightExt } = useLspClient({
    projectPath,
    filePath: tab.filePath,
    virtualUri: tab.virtualUri ?? tabLspDocumentUri(tab),
    onOpenJdtLink,
  });

  const { lspKeymap, cmdClickExt, navigateToLocation } = useLspNavigation({
    projectPath,
    tabKey,
    tab,
    lspLanguageIdRef,
    editorViewRef,
  });

  // effect 返回解绑：ref 不超出 tab 存活期（回调归属由 LSP 侧 facet 保证）。
  useEffect(
    () =>
      bindJdtLinkNav(navigateToLocation, {
        projectPath,
        tabKey,
        projectId: tab.projectId,
        filePath: tab.filePath,
      }),
    [bindJdtLinkNav, navigateToLocation, projectPath, tabKey, tab.projectId, tab.filePath],
  );

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
