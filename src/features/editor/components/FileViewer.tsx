import {
  closeBrackets,
  closeBracketsKeymap,
  autocompletion,
  completionKeymap,
} from '@codemirror/autocomplete';
import { history, historyKeymap, indentWithTab, defaultKeymap } from '@codemirror/commands';
import { foldGutter, indentOnInput, bracketMatching } from '@codemirror/language';
import { EditorSelection } from '@codemirror/state';
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  keymap,
} from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import React, { useState, useCallback, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { useShallow } from 'zustand/shallow';

import { readFileContent } from '@/features/file/api/fileApi';
import { acquireLspPlugin, releaseLspClient } from '@/features/lsp/hooks/lspClientManager';
import {
  fromFileUri,
  getLspLanguageId,
  resolveLspLanguageId,
  toFileUri,
} from '@/features/lsp/languageMap';
import { useCmdHeld } from '@/features/lsp/hooks/useCmdHeld';
import { useLspDefinition } from '@/features/lsp/hooks/useLspDefinition';
import { useLspLinkHighlightExtension, clearLinkHighlight } from '@/features/lsp/hooks/useLspLinkHighlight';
import { resolveLspPositionFromOffset } from '@/features/lsp/position';
import type { LspLocation } from '@/features/lsp/types';
import { useActiveProject } from '@/features/project/hooks/use-active-project';
import { useProjectStore } from '@/features/project/store';
import { useWorktreeStore } from '@/features/project/worktreeStore';
import { useTerminalTabs } from '@/features/terminal/hooks/useTerminalTabs';
import { Eye, Save, FileCode, Globe } from '@/shared/components/icons';
import { useEditorContext } from '@/shared/contexts';
import { useAppContext } from '@/shared/contexts/AppContext';
import { useEditorStore } from '@/shared/store';
import type { FileTab, AppTheme, Tab, FileTabData } from '@/shared/types';
import { openHtmlInBrowserPanel, resolveAbsolutePath } from '@/shared/utils/browserUtils';
import {
  getCachedLanguageExtension,
  getLanguageExtension,
  preloadLanguageExtension,
  createCmTheme,
  isMarkdownFile,
} from '@/shared/utils/codemirror';
import { MarkdownPreview } from '@/ui';

import { useFileActionsContext } from '../FileActionsContext';

import { buildWorktreeTabKey } from '@/shared/utils/tabKey';
import {
  getViewSnapshot,
  setViewSnapshot,
  clearViewSnapshot,
  type SerializedSelection,
} from '@/shared/utils/editorViewState';

import { useEditorAgentActions } from '../hooks/useEditorAgentActions';
import { useBreakpointGutterExtensions } from '@/features/debug/hooks/useBreakpointGutter';
import {
  applyDebugCurrentLine,
  resolveDebugHighlightLine,
  useCurrentLineHighlight,
} from '@/features/debug/hooks/useCurrentLineHighlight';
import { EMPTY_BP_LINES, useDebugStore } from '@/features/debug/store/debugStore';

import InlineHtmlPreview from './InlineHtmlPreview';
import SelectionToolbar from './SelectionToolbar';

import { cn } from '@/lib/utils';
import { IS_MACOS } from '@/shared/utils/platform';
import type { EditorAction } from '@/shared/utils/agentPrompt';
import { buildCodeMessage } from '@/shared/utils/agentPrompt';
import { getTabId, getFileName } from '@/shared/utils/fileTree';

type PreviewMode = 'preview' | 'source';

/** 检查文件是否为 HTML 文件 */
function isHtmlFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext === 'html' || ext === 'htm';
}

/** Type guard: narrow Tab to file kind */
function isFileTab(tab: Tab): tab is Tab & { data: FileTabData } {
  return tab.data.kind === 'file';
}

/** Convert a unified Tab (file kind) to legacy FileTab for FileEditor */
function tabToFileTab(tab: Tab & { data: FileTabData }): FileTab {
  return {
    id: tab.id,
    projectId: tab.projectId,
    filePath: tab.data.filePath,
    fileName: tab.data.fileName,
    content: tab.data.content,
    isDirty: tab.data.isDirty,
    order: tab.order,
  };
}

function FileViewer() {
  const { config } = useAppContext();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProject = useProjectStore((state) => state.activeProject);
  const activeWorktreePath = useWorktreeStore((state) => state.activeWorktreePath);
  const { onFileSave: onSave, onFileContentChange: onContentChange } = useFileActionsContext();

  const theme = config.theme;
  const fontFamily = config.fontFamily;
  const fontSize = config.editorFontSize;

  // Composite tab key: unified across local/WSL/remote projects
  const currentProjectId = activeProjectId ?? activeProject?.id ?? null;
  const effectiveWorktreePath = activeWorktreePath ?? null;
  const tabKey =
    effectiveWorktreePath && currentProjectId
      ? buildWorktreeTabKey(currentProjectId, effectiveWorktreePath)
      : currentProjectId;

  // Read project tabs from unified store
  const projectTabs = useEditorStore(
    useShallow((state) => {
      if (!tabKey) return null;
      return state.tabs[tabKey] ?? null;
    }),
  );

  // Read per-group activeTabId from EditorContext (correct in split mode)
  const { activeTabId: groupActiveTabId } = useEditorContext();

  // Collect all file tabs to render (keep editors alive across switches)
  const fileTabs = useMemo(() => {
    if (!projectTabs) return [];
    return projectTabs.tabs.filter(isFileTab) as (Tab & { data: FileTabData })[];
  }, [projectTabs]);

  if (fileTabs.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-text-secondary">
        <FileCode size={48} className="mb-3 opacity-30" />
        <p>No file open</p>
        <p className="text-xs mt-1 opacity-60">Select a file from the tree to start editing</p>
      </div>
    );
  }

  const projectPath =
    activeProject?.path ??
    null;

  return (
    <div className="flex flex-col h-full">
      {fileTabs.map((tab) => {
        const fileTab = tabToFileTab(tab);
        const isActive = tab.id === groupActiveTabId;
        return (
          <div
            key={tab.id}
            className="flex-1 flex flex-col min-h-0"
            style={{ display: isActive ? 'flex' : 'none' }}
          >
            <FileEditor
              tab={fileTab}
              tabKey={tabKey ?? ''}
              tabId={tab.id}
              externallyModified={tab.data.externallyModified ?? false}
              theme={theme}
              fontFamily={fontFamily}
              fontSize={fontSize}
              projectPath={projectPath}
              onSave={onSave}
              onContentChange={onContentChange}
            />
          </div>
        );
      })}
    </div>
  );
}

// Internal editor component for a single file tab
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
  const [previewMode, setPreviewMode] = useState<PreviewMode>('preview');
  const [isSaving, setIsSaving] = useState(false);
  // Prefer sync cache so cross-file go-to-definition mounts CodeMirror once
  // with language highlighting already applied (avoids expensive reconfigure).
  const [langExtension, setLangExtension] = useState<import('@codemirror/state').Extension | null>(
    () => getCachedLanguageExtension(tab.filePath),
  );
  // CodeMirror EditorView 引用 + 是否已恢复过位置
  const editorViewRef = useRef<EditorView | null>(null);
  const editorRestoredRef = useRef(false);
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

  const loadBreakpoints = useDebugStore((s) => s.loadBreakpoints);
  // Select the stored array reference directly — never allocate a new [] here
  // (that would trip zustand's Object.is check and infinite-loop renders).
  const bpLines = useDebugStore(
    (s) => s.breakpoints[tab.projectId]?.[absFilePath] ?? EMPTY_BP_LINES,
  );
  const {
    extensions: bpGutterExt,
    syncEffect: bpSyncEffect,
    onLineNumberClick,
    onLineNumberHover,
    onLineNumberLeave,
  } = useBreakpointGutterExtensions(tab.projectId, absFilePath);
  // Current-line highlight field lives inside bpGutterExt; this only re-applies on stop.
  useCurrentLineHighlight(
    absFilePath,
    tab.filePath,
    editorViewRef,
    editorViewEpoch,
  );

  // Stable refs so lineNumbers handlers stay fresh without rebuilding extensions every render
  const lnClickRef = useRef(onLineNumberClick);
  const lnHoverRef = useRef(onLineNumberHover);
  const lnLeaveRef = useRef(onLineNumberLeave);
  lnClickRef.current = onLineNumberClick;
  lnHoverRef.current = onLineNumberHover;
  lnLeaveRef.current = onLineNumberLeave;
  const lastSyncedBpKey = useRef<string>('');

  useEffect(() => {
    void loadBreakpoints(tab.projectId);
  }, [tab.projectId, loadBreakpoints]);

  // Sync store → CodeMirror breakpoint field (also after editor is created)
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    const key = `${absFilePath}:${bpLines.join(',')}`;
    if (key === lastSyncedBpKey.current) return;
    lastSyncedBpKey.current = key;
    view.dispatch({ effects: bpSyncEffect(bpLines) });
  }, [bpLines, bpSyncEffect, absFilePath]);

  // Selection state for AI toolbar
  const [selectionLines, setSelectionLines] = useState<{
    startLine: number;
    endLine: number;
  } | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null);
  const { sendToAgent, pending, clearPending } = useEditorAgentActions();

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
      editorRestoredRef.current = false;
    } catch (e) {
      console.error('[FileEditor] Failed to reload file:', e);
    }
  }, [tab.projectId, tab.filePath, tabKey, tabId]);

  // 处理外部文件修改：保留当前编辑
  const handleKeepEdits = useCallback(() => {
    useEditorStore.getState().updateTab(tabKey, tabId, {
      kind: 'file',
      externallyModified: false,
    });
  }, [tabKey, tabId]);

  const isMd = isMarkdownFile(tab.filePath);
  const isHtml = isHtmlFile(tab.filePath);
  const currentContent = tab.content.content;

  const basePath = useMemo(() => {
    if (!projectPath) return undefined;
    // resolveAbsolutePath handles both relative and absolute filePaths correctly,
    // avoiding the double-root bug (e.g. "E:/ws/C:/project") when filePath is absolute.
    const absFilePath = resolveAbsolutePath(projectPath, tab.filePath);
    const lastSlash = absFilePath.lastIndexOf('/');
    return lastSlash >= 0 ? absFilePath.substring(0, lastSlash) : projectPath.replace(/\\/g, '/');
  }, [projectPath, tab.filePath]);

  // Load language extension lazily (instant when cache is warm from preload)
  useEffect(() => {
    let cancelled = false;
    const cached = getCachedLanguageExtension(tab.filePath);
    if (cached) {
      setLangExtension(cached);
      return;
    }
    getLanguageExtension(tab.filePath).then((ext) => {
      if (!cancelled) setLangExtension(ext);
    });
    return () => {
      cancelled = true;
    };
  }, [tab.filePath]);

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
  }, [currentContent, onSave]);

  // 获取 capabilities（用于判断是否显示 Open in Browser）
  const { capabilities } = useActiveProject();
  const canOpenInBrowser = capabilities?.canEditFiles ?? false;

  // 在 Browser Panel 中打开 HTML 文件
  const handleOpenInBrowser = useCallback(() => {
    if (!projectPath || !canOpenInBrowser) return;
    openHtmlInBrowserPanel(resolveAbsolutePath(projectPath, tab.filePath));
  }, [tab.filePath, projectPath, canOpenInBrowser]);

  // Ctrl+S handler
  const saveKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: 'Ctrl-s',
          run: () => {
            if (tab.isDirty) {
              handleSave();
              return true;
            }
            return false;
          },
          preventDefault: true,
        },
      ]),
    [tab.isDirty, handleSave],
  );

  // Create theme object (new reference triggers CodeMirror reconfigure)
  const cmTheme = useMemo(() => createCmTheme(fontFamily, fontSize), [fontFamily, fontSize, theme]);

  // LSP go-to-definition / find-references — keep custom handlers for cross-file navigation
  const definition = useLspDefinition(projectPath);

  // Build file URI (used by keybindings, Cmd+Click handler, and LSP client)
  const fileUri = useMemo(
    () => (projectPath ? toFileUri(projectPath, tab.filePath) : ''),
    [projectPath, tab.filePath],
  );

  // Language id: sync map first, then tighten with live backend registry (custom plugins).
  const [lspLanguageId, setLspLanguageId] = useState<string | null>(() =>
    getLspLanguageId(tab.filePath),
  );
  const lspLanguageIdRef = useRef(lspLanguageId);
  lspLanguageIdRef.current = lspLanguageId;

  useEffect(() => {
    let cancelled = false;
    const sync = getLspLanguageId(tab.filePath);
    setLspLanguageId(sync);
    void resolveLspLanguageId(tab.filePath).then((live) => {
      if (!cancelled && live) {
        setLspLanguageId(live);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tab.filePath]);

  // @codemirror/lsp-client plugin — handles hover, diagnostics, completion, document lifecycle
  // Shared per (projectPath, languageId) so switching between files of the same
  // language reuses the existing LSP client instead of destroying and re-initializing.
  const [lspClientExt, setLspClientExt] = useState<import('@codemirror/state').Extension[]>([]);

  useEffect(() => {
    const lang = lspLanguageId;
    if (!projectPath || !lang || !fileUri) {
      setLspClientExt([]);
      return;
    }

    const plugin = acquireLspPlugin(projectPath, lang, fileUri);
    setLspClientExt([plugin]);

    return () => {
      setLspClientExt([]);
      releaseLspClient(projectPath, lang);
    };
  }, [projectPath, lspLanguageId, fileUri]);

  // LSP link highlight (Cmd/Ctrl+hover underline) — visual cue only, does not affect navigation
  const linkHighlightExt = useLspLinkHighlightExtension(
    projectPath,
    projectPath ? lspLanguageId : null,
    projectPath ? toFileUri(projectPath, tab.filePath) : '',
  );

  // Navigation helper for go-to-definition
  const navigateToLocation = useCallback(
    async (
      location: LspLocation,
      _projPath: string,
      tKey: string,
      projId: string,
      currentFilePath: string,
      preloadedContent?: string | null,
    ) => {
      const tNav = performance.now();
      const targetPath = fromFileUri(location.uri);
      const targetLine = location.range.start.line;
      const targetChar = location.range.start.character;

      if (targetPath === currentFilePath) {
        // Same file – navigate cursor and focus editor
        console.log('[perf] navigate: same-file');
        const v = editorViewRef.current;
        if (!v) return;
        try {
          const targetPos = v.state.doc.line(targetLine + 1).from + targetChar;
          v.dispatch({
            selection: { anchor: targetPos, head: targetPos },
            scrollIntoView: true,
          });
          v.focus();
        } catch (e) {
          console.warn('[LSP] Navigation within file failed:', e);
        }
        return;
      }

      // Cross-file – warm language pack before mounting so CM configures once
      const langWarm = getLanguageExtension(targetPath);
      const targetTabId = getTabId(tKey, targetPath);
      const existing = useEditorStore.getState().tabs[tKey];
      useEditorStore.getState().setPendingNavigateTarget({
        tabKey: tKey,
        tabId: targetTabId,
        line: targetLine + 1,
        col: targetChar,
      });

      if (existing?.tabs.some((t) => t.id === targetTabId)) {
        // Ensure language cache is warm even for existing tabs (cheap if cached)
        void langWarm;
        console.log(
          `[perf] navigate: cross-file existing-tab ${(performance.now() - tNav).toFixed(0)}ms`,
        );
        useEditorStore.getState().activateTab(tKey, targetTabId);
        return;
      }

      try {
        // Await language first-time import so FileViewer mounts with lang ready
        const tLang = performance.now();
        await langWarm;
        const langMs = performance.now() - tLang;

        const tContent = performance.now();
        const content = preloadedContent
          ? {
              path: targetPath,
              content: preloadedContent,
              size: preloadedContent.length,
              is_binary: false,
            }
          : await readFileContent(projId, targetPath);
        const contentMs = performance.now() - tContent;

        const newTab: Tab = {
          id: targetTabId,
          projectId: projId,
          title: getFileName(targetPath),
          order: 0,
          data: {
            kind: 'file' as const,
            filePath: targetPath,
            fileName: getFileName(targetPath),
            content,
            isDirty: false,
          },
        };
        useEditorStore.getState().addTab(tKey, newTab);
        console.log(
          `[perf] navigate: cross-file new-tab content=${preloadedContent ? 'preloaded' : 'ipc'} ` +
            `lang=${langMs.toFixed(0)}ms content=${contentMs.toFixed(0)}ms ` +
            `total=${(performance.now() - tNav).toFixed(0)}ms`,
        );
      } catch (e) {
        useEditorStore.getState().setPendingNavigateTarget(null);
        console.error('[LSP] Failed to open definition target:', e);
      }
    },
    [],
  );

  // LSP keybinding extension: F12 = Go to Definition, Shift+F12 = Find References
  /* eslint-disable react-hooks/refs */
  const lspKeymap = useMemo(() => {
    if (!projectPath) return [];
    return keymap.of([
      {
        key: 'F12',
        run: (view) => {
          const lid = lspLanguageIdRef.current;
          if (!lid) return false;

          const pos = view.state.selection.main.head;
          const lineObj = view.state.doc.lineAt(pos);
          const line = lineObj.number - 1;
          const character = pos - lineObj.from;
          const uri = projectPath ? toFileUri(projectPath, tab.filePath) : '';

          const t0 = performance.now();
          definition.goToDefinitionWithContent(lid, uri, line, character).then((result) => {
            if (!result) return;
            // Kick language preload ASAP (overlaps with navigate setup)
            preloadLanguageExtension(fromFileUri(result.location.uri));
            const tLsp = performance.now() - t0;
            navigateToLocation(
              result.location,
              projectPath,
              tabKey,
              tab.projectId,
              tab.filePath,
              result.fileContent,
            ).then(() => {
              console.log(
                `[perf] total (F12→tab): ${(performance.now() - t0).toFixed(0)}ms ` +
                  `(lsp=${tLsp.toFixed(0)}ms)`,
              );
            });
          });

          return true;
        },
      },
      {
        key: 'Shift-F12',
        run: (view) => {
          const lid = lspLanguageIdRef.current;
          if (!lid) return false;

          const pos = view.state.selection.main.head;
          const lineObj = view.state.doc.lineAt(pos);
          const line = lineObj.number - 1;
          const character = pos - lineObj.from;
          const uri = projectPath ? toFileUri(projectPath, tab.filePath) : '';

          definition.findReferences(lid, uri, line, character).then((results) => {
            if (results.length === 0) {
              console.log('[LSP] No references found');
            } else {
              console.log(`[LSP] Found ${results.length} reference(s)`);
            }
          });

          return true;
        },
      },
    ]);
  }, [projectPath, tab.filePath, tabKey, tab.projectId, definition, navigateToLocation]);
  /* eslint-enable react-hooks/refs */

  // Cmd/Ctrl held state — used for link highlight pointer cursor style
  const cmdHeld = useCmdHeld();
  const cmClassName = cn('h-full overflow-auto', cmdHeld && 'cmd-held');

  // Cmd+Click / Ctrl+Click — go to definition, clearing link highlight first
  useEffect(() => {
    const editorEl = editorViewRef.current?.dom;
    if (!editorEl || !projectPath) return;

    const handler = (event: MouseEvent) => {
      const modKey = IS_MACOS ? event.metaKey : event.ctrlKey;
      if (!modKey || event.button !== 0) return;

      event.preventDefault();

      const view = editorViewRef.current;
      if (!view) return;

      // Clear link highlight immediately to prevent visual stutter
      clearLinkHighlight(view);

      const lid = lspLanguageIdRef.current;
      if (!lid) return;

      // Use click coordinates — not the current selection — so Cmd+Click jumps
      // to the symbol under the mouse (matches link-highlight hover behavior).
      const offset = view.posAtCoords({ x: event.clientX, y: event.clientY });
      const lspPos = resolveLspPositionFromOffset(offset, (p) => view.state.doc.lineAt(p));
      if (!lspPos) return;

      const uri = projectPath ? toFileUri(projectPath, tab.filePath) : '';

      const t0 = performance.now();
      definition
        .goToDefinitionWithContent(lid, uri, lspPos.line, lspPos.character)
        .then((result) => {
          if (!result) return;
          preloadLanguageExtension(fromFileUri(result.location.uri));
          const tLsp = performance.now() - t0;
          return navigateToLocation(
            result.location,
            projectPath,
            tabKey,
            tab.projectId,
            tab.filePath,
            result.fileContent,
          ).then(() => {
            console.log(
              `[perf] total (Cmd+Click→tab): ${(performance.now() - t0).toFixed(0)}ms ` +
                `(lsp=${tLsp.toFixed(0)}ms)`,
            );
          });
        });
    };

    editorEl.addEventListener('click', handler);
    return () => editorEl.removeEventListener('click', handler);
  }, [projectPath, tab.filePath, tabKey, tab.projectId, definition, navigateToLocation]);

  // Selection → AI actions
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

  const handleCreateTab = useCallback(() => {
    const { addTab } = useTerminalTabs();
    const agentId = useProjectStore.getState().activeProject?.selected_agent ?? 'opencode';
    const tab = addTab(currentProjectIdForToolbar, agentId, agentId);
    if (tab && pending) {
      setTimeout(() => {
        import('@/features/terminal/components/terminalCommands').then(({ sendToTerminal }) => {
          sendToTerminal(currentProjectIdForToolbar, `${pending.message}\r`);
          clearPending();
          setSelectionLines(null);
          setToolbarPos(null);
        });
      }, 1500);
    }
  }, [currentProjectIdForToolbar, pending, clearPending]);

  // 把当前 EditorView 状态写回缓存
  const saveEditorSnapshot = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;
    try {
      const selJson = view.state.selection.toJSON() as SerializedSelection;
      setViewSnapshot(tabKey, tabId, 'editor', {
        scrollTop: view.scrollDOM.scrollTop,
        selection: selJson,
      });
    } catch {
      // toJSON 极少失败；失败时仅落 scrollTop
      setViewSnapshot(tabKey, tabId, 'editor', {
        scrollTop: view.scrollDOM.scrollTop,
      });
    }
  }, [tabKey, tabId]);

  // updateListener: selection / scroll / geometry 变化都更新一次缓存
  const viewStateExt = useMemo(
    () =>
      EditorView.updateListener.of((u) => {
        if (u.selectionSet || u.geometryChanged || u.viewportChanged || u.docChanged) {
          saveEditorSnapshot();
        }

        // Update cursor position for the StatusBar
        if (u.selectionSet || u.docChanged) {
          const view = editorViewRef.current;
          if (view) {
            const pos = view.state.selection.main.head;
            const lineObj = view.state.doc.lineAt(pos);
            useEditorStore.getState().setCursorPosition({
              line: lineObj.number,
              col: pos - lineObj.from,
            });
          }
        }

        // Extract selection lines for AI toolbar
        if (u.selectionSet) {
          const view = editorViewRef.current;
          if (view) {
            const sel = view.state.selection.main;
            if (!sel.empty) {
              const fromLine = view.state.doc.lineAt(sel.from).number;
              const toLine = view.state.doc.lineAt(sel.to).number;
              setSelectionLines({ startLine: fromLine, endLine: toLine });

              const coords = view.coordsAtPos(sel.to);
              if (coords) {
                setToolbarPos({
                  top: coords.bottom + 4,
                  left: coords.left,
                });
              }
            } else {
              setSelectionLines(null);
              setToolbarPos(null);
            }
          }
        }
      }),
    [saveEditorSnapshot],
  );

  // CodeMirror 初始化完成后：捕获 view 引用，恢复上次的 scrollTop/selection
  const handleCreateEditor = useCallback(
    (view: EditorView) => {
      editorViewRef.current = view;
      setEditorViewEpoch((n) => n + 1);
      // Apply any breakpoints already in the store (effect may have run before view existed)
      const lines =
        useDebugStore.getState().breakpoints[tab.projectId]?.[absFilePath] ?? [];
      lastSyncedBpKey.current = `${absFilePath}:${lines.join(',')}`;
      view.dispatch({ effects: bpSyncEffect(lines) });
      // Re-apply debug current-line if we stopped before the editor mounted.
      const dbg = useDebugStore.getState();
      const hl = resolveDebugHighlightLine(
        absFilePath,
        tab.filePath,
        dbg.stoppedAt,
        dbg.session?.status,
      );
      applyDebugCurrentLine(view, hl);
      if (editorRestoredRef.current) return;

      // Check for pending LSP navigation target (go-to-definition / find-references)
      const pending = useEditorStore.getState().pendingNavigateTarget;
      if (
        pending &&
        pending.tabKey === tabKey &&
        pending.tabId === tabId
      ) {
        console.log(`[perf] handleCreateEditor applying pending: L${pending.line}:${pending.col}`);
        try {
          const line = view.state.doc.line(pending.line);
          const pos = line.from + pending.col;
          view.dispatch({
            selection: { anchor: pos, head: pos },
            effects: EditorView.scrollIntoView(pos, { y: 'center' }),
          });
        } catch {
          // line out of range, ignore
        }
        // Delay clear to survive React StrictMode double-mount
        queueMicrotask(() => {
          useEditorStore.getState().setPendingNavigateTarget(null);
        });
        editorRestoredRef.current = true;
        return;
      }

      const snap = getViewSnapshot(tabKey, tabId, 'editor');
      if (!snap) {
        editorRestoredRef.current = true;
        return;
      }

      // 等下一帧让 CodeMirror 完成首屏 measure 再 scroll，避免被覆盖
      requestAnimationFrame(() => {
        try {
          if (snap.selection) {
            const docLen = view.state.doc.length;
            const safe = snap.selection.ranges.every((r) => r.anchor <= docLen && r.head <= docLen);
            if (safe) {
              view.dispatch({
                selection: EditorSelection.fromJSON(snap.selection),
                scrollIntoView: false,
              });
            }
          }
          const maxScroll = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight);
          view.scrollDOM.scrollTop = Math.min(snap.scrollTop, maxScroll);
        } catch (e) {
          console.warn('[FileEditor] restore editor view failed', e);
        } finally {
          editorRestoredRef.current = true;
        }
      });
    },
    [tabKey, tabId, tab.projectId, absFilePath, bpSyncEffect],
  );

  // 卸载兜底：再保存一次（updateListener 大多已覆盖，但保险起见）
  useEffect(() => {
    return () => {
      saveEditorSnapshot();
      editorViewRef.current = null;
      editorRestoredRef.current = false;
    };
  }, [saveEditorSnapshot]);

  // Listen for pending LSP navigation target (existing tabs – go-to-definition / find-references)
  useEffect(() => {
    const unsubscribe = useEditorStore.subscribe((state) => {
      const pending = state.pendingNavigateTarget;
      if (
        pending &&
        pending.tabKey === tabKey &&
        pending.tabId === tabId
      ) {
        const view = editorViewRef.current;
        if (view) {
          try {
            const line = view.state.doc.line(pending.line);
            const pos = line.from + pending.col;
            view.dispatch({
              selection: { anchor: pos, head: pos },
              effects: EditorView.scrollIntoView(pos, { y: 'center' }),
            });
          } catch {
            // Ignore out-of-range navigation
          }
          useEditorStore.getState().setPendingNavigateTarget(null);
        }
      }
    });
    return unsubscribe;
  }, [tabKey, tabId]);

  // Build CodeMirror extensions
  const extensions = useMemo(() => {
    const exts: import('@codemirror/state').Extension[] = [];

    // Order: breakpoint gutter (optional) → line numbers (always) → rest.
    // lineNumbers is ALWAYS registered here so debug sessions never remove it.
    if (bpGutterExt.length > 0) {
      exts.push(...bpGutterExt);
    }
    exts.push(
      lineNumbers({
        formatNumber: (n) => String(n),
        domEventHandlers: {
          mousedown(view, line) {
            return lnClickRef.current(view, line.from);
          },
          mouseover(view, line) {
            return lnHoverRef.current(view, line.from);
          },
          mouseout(view) {
            return lnLeaveRef.current(view);
          },
        },
      }),
    );

    exts.push(
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      highlightActiveLine(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      saveKeymap,
      cmTheme,
      viewStateExt,
    );

    if (langExtension) exts.push(langExtension);

    // LSP: @codemirror/lsp-client plugin (hover, diagnostics, completion, document sync)
    // + custom keybinding (F12/Shift+F12) + link highlight (Cmd/Ctrl+hover underline)
    exts.push(...lspClientExt);
    exts.push(lspKeymap);
    exts.push(linkHighlightExt);

    return exts;
  }, [
    langExtension,
    fontFamily,
    fontSize,
    saveKeymap,
    theme,
    viewStateExt,
    lspClientExt,
    lspKeymap,
    linkHighlightExt,
    bpGutterExt,
  ]);

  // Breadcrumb path segments
  const pathSegments = tab.filePath.replace(/\\/g, '/').split('/');

  // Determine if file can be edited
  const canEdit = !tab.content.is_binary && tab.content.size <= 512 * 1024;

  // Binary file
  if (tab.content.is_binary) {
    return (
      <div className="flex-1 flex flex-col">
        <EditorHeader
          pathSegments={pathSegments}
          isDirty={false}
          canEdit={false}
          isMd={false}
          isHtml={false}
          previewMode="preview"
          isSaving={false}
          onSave={() => {}}
          onTogglePreview={() => {}}
        />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-text-secondary">
            <FileCode size={48} className="mx-auto mb-3 opacity-30" />
            <p>Binary file — cannot be displayed</p>
            <p className="text-xs mt-1 opacity-60">{formatFileSize(tab.content.size)}</p>
          </div>
        </div>
      </div>
    );
  }

  // Large file (view only)
  if (tab.content.size > 512 * 1024) {
    return (
      <div className="flex-1 flex flex-col">
        <EditorHeader
          pathSegments={pathSegments}
          isDirty={false}
          canEdit={false}
          isMd={false}
          isHtml={false}
          previewMode="preview"
          isSaving={false}
          onSave={() => {}}
          onTogglePreview={() => {}}
        />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-text-secondary">
            <FileCode size={48} className="mx-auto mb-3 opacity-30" />
            <p>File too large to edit (&gt; 500 KB)</p>
            <p className="text-xs mt-1 opacity-60">{formatFileSize(tab.content.size)}</p>
          </div>
        </div>
      </div>
    );
  }

  // Markdown / HTML preview mode
  const showPreview = (isMd || isHtml) && previewMode === 'preview';

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 外部文件修改 Modal */}
      {externallyModified && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-bg-primary border border-border rounded-lg shadow-xl p-6 w-[420px] max-w-[90vw] overflow-hidden">
            <h3 className="text-sm font-semibold text-text-primary mb-2">文件已在外部修改</h3>
            <p className="text-sm text-text-secondary mb-1">
              <span className="font-medium text-text-primary">{tab.fileName}</span>{' '}
              已被外部程序修改。
            </p>
            <p className="text-sm text-text-secondary mb-5">是否重新加载？你当前的编辑将会丢失。</p>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-sm rounded border border-border text-text-secondary hover:bg-bg-hover transition-colors"
                onClick={handleKeepEdits}
              >
                保留当前编辑
              </button>
              <button
                className="px-3 py-1.5 text-sm rounded bg-accent text-white hover:bg-accent/90 transition-colors"
                onClick={handleReload}
              >
                重新加载
              </button>
            </div>
          </div>
        </div>
      )}

      <EditorHeader
        pathSegments={pathSegments}
        isDirty={tab.isDirty}
        canEdit={canEdit}
        isMd={isMd}
        isHtml={isHtml}
        previewMode={previewMode}
        isSaving={isSaving}
        onSave={handleSave}
        onTogglePreview={() => setPreviewMode((m) => (m === 'preview' ? 'source' : 'preview'))}
        onOpenInBrowser={handleOpenInBrowser}
        canOpenInBrowser={canOpenInBrowser}
      />

      <div className="flex-1 min-h-0 overflow-hidden">
        {showPreview ? (
          isMd ? (
            <MarkdownScrollContainer tabKey={tabKey} tabId={tabId} content={currentContent}>
              <MarkdownPreview content={currentContent} theme={theme} basePath={basePath} />
            </MarkdownScrollContainer>
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
            extensions={extensions}
            onChange={handleEditorChange}
            onCreateEditor={handleCreateEditor}
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
        onAction={handleEditorAction}
        onClose={handleCloseToolbar}
        needsAgentTab={pending !== null}
        agentName="Agent"
        onCreateTab={handleCreateTab}
      />
    </div>
  );
}

// Header component for editor
interface EditorHeaderProps {
  pathSegments: string[];
  isDirty: boolean;
  canEdit: boolean;
  isMd: boolean;
  isHtml: boolean;
  previewMode: PreviewMode;
  isSaving: boolean;
  onSave: () => void;
  onTogglePreview: () => void;
  onOpenInBrowser?: () => void;
  canOpenInBrowser?: boolean;
}

function EditorHeader({
  pathSegments,
  isDirty,
  canEdit,
  isMd,
  isHtml,
  previewMode,
  isSaving,
  onSave,
  onTogglePreview,
  onOpenInBrowser,
  canOpenInBrowser,
}: EditorHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-secondary/50">
      {/* Breadcrumb */}
      <div className="flex-1 flex items-center gap-1 text-xs text-text-secondary min-w-0 overflow-hidden">
        {pathSegments.map((seg, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="opacity-40">/</span>}
            <span
              className={
                i === pathSegments.length - 1
                  ? 'text-text-primary font-medium truncate'
                  : 'truncate'
              }
            >
              {seg}
            </span>
          </React.Fragment>
        ))}
        {isDirty && <span className="ml-1 text-accent">●</span>}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Markdown / HTML preview toggle */}
        {(isMd || isHtml) && (
          <button
            className="px-2 py-1 text-xs rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            onClick={onTogglePreview}
            title={previewMode === 'preview' ? 'Switch to source' : 'Switch to preview'}
          >
            {previewMode === 'preview' ? (
              <span className="flex items-center gap-1">
                <FileCode size={12} /> Source
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Eye size={12} /> Preview
              </span>
            )}
          </button>
        )}

        {/* HTML: Open in Browser Panel */}
        {isHtml && canOpenInBrowser && (
          <button
            className="px-2 py-1 text-xs rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1"
            onClick={onOpenInBrowser}
            title="Open in Browser Panel"
          >
            <Globe size={12} /> Browser
          </button>
        )}

        {canEdit && (
          <button
            className="px-2 py-1 text-xs rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1 disabled:opacity-50"
            onClick={onSave}
            disabled={!isDirty || isSaving}
            title="Save (Ctrl+S)"
          >
            <Save size={12} /> {isSaving ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Markdown preview 滚动容器：在 tab 切换时保存/恢复 scrollTop。
 * 内容变化（content 改动）时，保留 scrollTop 但 clamp 到新的最大可滚动值。
 */
interface MarkdownScrollContainerProps {
  tabKey: string;
  tabId: string;
  content: string;
  children: React.ReactNode;
}

function MarkdownScrollContainer({
  tabKey,
  tabId,
  content,
  children,
}: MarkdownScrollContainerProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // 挂载 + 内容变化后恢复 scrollTop（用 layoutEffect 抢在浏览器绘制前）
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const snap = getViewSnapshot(tabKey, tabId, 'markdown');
    if (!snap) return;
    // 内容渲染可能尚未完成（图片/mermaid 异步）；先尝试一次，再 rAF 兜底
    const apply = () => {
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = Math.min(snap.scrollTop, max);
    };
    apply();
    const raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
  }, [tabKey, tabId, content]);

  const handleScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setViewSnapshot(tabKey, tabId, 'markdown', { scrollTop: el.scrollTop });
  }, [tabKey, tabId]);

  useEffect(() => {
    return () => {
      const el = ref.current;
      if (!el) return;
      setViewSnapshot(tabKey, tabId, 'markdown', { scrollTop: el.scrollTop });
    };
  }, [tabKey, tabId]);

  return (
    <div ref={ref} onScroll={handleScroll} className="h-full overflow-y-auto px-6 py-4">
      {children}
    </div>
  );
}

export default React.memo(FileViewer);
