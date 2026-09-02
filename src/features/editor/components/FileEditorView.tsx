import type { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import React from 'react';

import type { AppTheme, FileTab } from '@/shared/types';
import type { EditorAction } from '@/shared/utils/agentPrompt';
import { MarkdownPreview } from '@/ui';

import { isTranslatableFile } from '../translation/useDocumentTranslation';
import type { PreviewMode } from '../types';

import EditorHeader from './EditorHeader';
import ExternallyModifiedDialog from './ExternallyModifiedDialog';
import InlineHtmlPreview from './InlineHtmlPreview';
import JsonPreview from './JsonPreview';
import MarkdownScrollContainer from './MarkdownScrollContainer';
import SelectionToolbar from './SelectionToolbar';
import SvgPreview from './SvgPreview';
import TranslationView from './TranslationView';

/** EditorHeader 上层的动作回调集（由 FileEditor 的 hooks 提供）。 */
export interface FileEditorViewCallbacks {
  onTogglePreview: () => void;
  /** 译文视图三段式切换（仅可翻译文件使用） */
  onSetViewMode: (mode: PreviewMode) => void;
  onOpenInBrowser: () => void;
  onOpenInSystemBrowser: () => void;
  canOpenInBrowser: boolean;
  onOpenSearch: () => void;
  onOpenAI: () => void;
  /** Markdown/HTML 预览内链点击。 */
  onInternalLinkClick: (absPath: string) => void;
}

interface FileEditorViewProps {
  tab: FileTab;
  tabKey: string;
  tabId: string;
  projectPath: string | null;
  theme: AppTheme;
  externallyModified: boolean;
  /** hooks 组装产物 */
  previewMode: PreviewMode;
  isMd: boolean;
  isHtml: boolean;
  isSvg: boolean;
  isJson: boolean;
  currentContent: string;
  basePath: string | undefined;
  canEdit: boolean;
  extensions: unknown[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- CM Extension 型从 hooks 推断，避免跨包类型依赖
  cmTheme: any;
  cmClassName: string;
  /** CodeMirror 交互回调 */
  onEditorChange: (value: string) => void;
  onCreateEditor: (view: EditorView) => void;
  /** 外部修改对话框回调 */
  onKeepEdits: () => void;
  onReload: () => void;
  callbacks: FileEditorViewCallbacks;
  /** SelectionToolbar */
  toolbarPos: { top: number; left: number } | null;
  onToolbarAction: (action: EditorAction, question?: string) => void;
  onToolbarClose: () => void;
  pendingAgentName: string | null;
  onCreateAgentTab: () => void;
}

/**
 * FileEditor 的纯渲染视图：EditorHeader + 主体三分支（preview / source）+
 * SelectionToolbar。无业务逻辑，全部状态与回调由 FileEditor 的 hooks 注入——
 * 渲染分支（binary/超大/preview/source）的新增改动落在正确的一层。
 */
function FileEditorView({
  tab,
  tabKey,
  tabId,
  projectPath,
  theme,
  externallyModified,
  previewMode,
  isMd,
  isHtml,
  isSvg,
  isJson,
  currentContent,
  basePath,
  canEdit,
  extensions,
  cmTheme,
  cmClassName,
  onEditorChange,
  onCreateEditor,
  onKeepEdits,
  onReload,
  callbacks,
  toolbarPos,
  onToolbarAction,
  onToolbarClose,
  pendingAgentName,
  onCreateAgentTab,
}: FileEditorViewProps) {
  const showPreview = (isMd || isHtml || isSvg || isJson) && previewMode === 'preview';
  const translatable = isTranslatableFile(tab.filePath);
  const showTranslate = previewMode === 'translate' && translatable;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 外部文件修改 Modal */}
      {externallyModified && (
        <ExternallyModifiedDialog
          fileName={tab.fileName}
          onKeepEdits={onKeepEdits}
          onReload={onReload}
        />
      )}

      <EditorHeader
        filePath={tab.filePath}
        projectPath={projectPath}
        isDirty={tab.isDirty}
        isMd={isMd}
        isHtml={isHtml}
        isSvg={isSvg}
        isJson={isJson}
        previewMode={previewMode}
        onTogglePreview={callbacks.onTogglePreview}
        translatable={translatable}
        onViewModeChange={callbacks.onSetViewMode}
        onOpenInBrowser={callbacks.onOpenInBrowser}
        onOpenInSystemBrowser={callbacks.onOpenInSystemBrowser}
        canOpenInBrowser={callbacks.canOpenInBrowser}
        onSearch={showPreview ? undefined : callbacks.onOpenSearch}
        onAI={callbacks.onOpenAI}
      />

      <div className="flex-1 min-h-0 overflow-hidden">
        {showTranslate ? (
          <TranslationView
            filePath={tab.filePath}
            content={currentContent}
            projectId={tab.projectId}
            enabled
          />
        ) : showPreview ? (
          isMd ? (
            <MarkdownScrollContainer tabKey={tabKey} tabId={tabId} content={currentContent}>
              <MarkdownPreview
                content={currentContent}
                theme={theme}
                basePath={basePath}
                onInternalLinkClick={callbacks.onInternalLinkClick}
              />
            </MarkdownScrollContainer>
          ) : isSvg ? (
            <SvgPreview
              tabKey={tabKey}
              tabId={tabId}
              content={currentContent}
              fileName={tab.fileName}
            />
          ) : isJson ? (
            <JsonPreview
              tabKey={tabKey}
              tabId={tabId}
              content={currentContent}
              fileName={tab.fileName}
            />
          ) : (
            <InlineHtmlPreview
              tabKey={tabKey}
              tabId={tabId}
              content={currentContent}
              basePath={basePath}
              fileName={tab.fileName}
            />
          )
        ) : (
          <CodeMirror
            value={currentContent}
            height="100%"
            extensions={extensions as never}
            onChange={onEditorChange}
            onCreateEditor={onCreateEditor}
            editable={true}
            readOnly={!canEdit}
            theme={cmTheme}
            basicSetup={false}
            className={cmClassName}
          />
        )}
      </div>

      <SelectionToolbar
        visible={toolbarPos !== null && !showPreview && !externallyModified}
        top={toolbarPos?.top ?? 0}
        left={toolbarPos?.left ?? 0}
        onAction={onToolbarAction}
        onClose={onToolbarClose}
        needsAgentTab={pendingAgentName !== null}
        agentName="Agent"
        onCreateTab={onCreateAgentTab}
      />
    </div>
  );
}

export default React.memo(FileEditorView);
