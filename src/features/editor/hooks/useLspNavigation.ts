import { EditorView, keymap } from '@codemirror/view';
import { useCallback, useMemo } from 'react';

import {
  fromFileUri,
  loadDefinitionTargetContent,
  showNavigationFailure,
  toFileUri,
  useLspDefinition,
} from '@/features/lsp';
import type { LspLocation } from '@/features/lsp/types';
import { useSymbolNavStore } from '@/features/symbol-nav/store/symbolNavStore';
import { useCodeMirrorBinding } from '@/shared/hooks/useResolvedShortcuts';
import { useEditorStore } from '@/shared/store/editorStore';
import type { NavLocation } from '@/shared/store/navigationHistory';
import {
  captureCurrentNavLocation,
  recordNavigationJump,
} from '@/shared/store/navigationHistoryStore';
import type { FileTab, Tab } from '@/shared/types';
import { getLanguageExtension, preloadLanguageExtension } from '@/shared/utils/codemirror';
import { getFileName, getTabId } from '@/shared/utils/fileTree';

import { applyNavigateCaret } from '../navigateCaret';

import { useCmdClickGoToDefinition } from './useCmdClickGoToDefinition';

interface UseLspNavigationParams {
  projectPath: string | null;
  tabKey: string;
  tab: FileTab;
  lspLanguageIdRef: React.MutableRefObject<string | null>;
  editorViewRef: React.MutableRefObject<EditorView | null>;
}

/**
 * LSP 导航能力：go-to-definition / find-references / file structure 快捷键、
 * 跨文件导航（含历史记录与语言预加载）、Cmd+Click 跳转。
 */
export function useLspNavigation({
  projectPath,
  tabKey,
  tab,
  lspLanguageIdRef,
  editorViewRef,
}: UseLspNavigationParams) {
  // LSP go-to-definition / find-references — keep custom handlers for cross-file navigation
  const definition = useLspDefinition(projectPath);

  // Navigation helper for go-to-definition (+ IDEA-style history)
  const navigateToLocation = useCallback(
    async (
      location: LspLocation,
      _projPath: string,
      tKey: string,
      projId: string,
      currentFilePath: string,
      preloadedContent?: string | null,
    ) => {
      const targetPath = fromFileUri(location.uri);
      const targetLine = location.range.start.line;
      const targetChar = location.range.start.character;

      const from = captureCurrentNavLocation();
      const to: NavLocation = {
        projectId: projId,
        tabKey: tKey,
        filePath: targetPath,
        line: targetLine + 1,
        column: targetChar,
      };
      recordNavigationJump(from, to);

      if (targetPath === currentFilePath) {
        // Same file – caret + flash + focus so the landing spot is obvious
        const v = editorViewRef.current;
        if (!v) return;
        if (!applyNavigateCaret(v, targetLine + 1, targetChar)) {
          console.warn('[LSP] Navigation within file failed: invalid position');
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
        useEditorStore.getState().activateTab(tKey, targetTabId);
        return;
      }

      try {
        // Await language first-time import so FileViewer mounts with lang ready
        await langWarm;

        // 目标内容：后端已随 definition 预读优先；否则按「项目内 / 项目外只读」
        // 策略加载（loadDefinitionTargetContent 区分失败原因，反馈可见）
        let content: { path: string; content: string; size: number; is_binary: boolean };
        let isExternalReadonly = false;
        // 契约防御：预读内容必须是纯文本——对象误入 doc 会让 react-codemirror
        // 渲染崩溃（整页降级）。非 string 一律丢弃预读，走下方兜底加载
        if (typeof preloadedContent === 'string' && preloadedContent.length > 0) {
          // size 契约为字节（对齐后端 FileContent.size 与兑底加载路径）：
          // string.length 是 UTF-16 单元数，多字节内容会低估
          content = {
            path: targetPath,
            content: preloadedContent,
            size: new TextEncoder().encode(preloadedContent).byteLength,
            is_binary: false,
          };
        } else {
          const loaded = await loadDefinitionTargetContent(
            projId,
            lspLanguageIdRef.current ?? '',
            location.uri,
          );
          if (loaded.kind === 'unavailable') {
            useEditorStore.getState().setPendingNavigateTarget(null);
            showNavigationFailure(loaded.reason);
            return;
          }
          content = loaded.content;
          isExternalReadonly = loaded.kind === 'external-readonly';
        }

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
            readOnly: isExternalReadonly || undefined,
          },
        };
        useEditorStore.getState().addTab(tKey, newTab);
      } catch (e) {
        useEditorStore.getState().setPendingNavigateTarget(null);
        showNavigationFailure('read-failed');
        console.error('[LSP] Failed to open definition target:', e);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable; parity with original []
    [],
  );

  // LSP keybindings — chords from shortcut registry (F12 / Ctrl+B / Shift+F12 / Alt+F7 / Ctrl+F12).
  const gotoDefCmKey = useCodeMirrorBinding('gotoDefinition');
  const gotoDefAltCmKey = useCodeMirrorBinding('gotoDefinitionAlt');
  const findRefsCmKey = useCodeMirrorBinding('findReferences');
  const findRefsAltCmKey = useCodeMirrorBinding('findReferencesAlt');
  const fileStructureCmKey = useCodeMirrorBinding('fileStructure');
  /* eslint-disable react-hooks/refs */
  const lspKeymap = useMemo(() => {
    if (!projectPath) return [];
    const bindings: { key: string; run: (view: EditorView) => boolean }[] = [];

    const runGotoDef = (view: EditorView): boolean => {
      const lid = lspLanguageIdRef.current;
      if (!lid) return false;

      const pos = view.state.selection.main.head;
      const lineObj = view.state.doc.lineAt(pos);
      const line = lineObj.number - 1;
      const character = pos - lineObj.from;
      const uri = projectPath ? toFileUri(projectPath, tab.filePath) : '';

      // eslint-disable-next-line react-hooks/purity -- performance.now() in callback, not during render
      definition.goToDefinitionWithContent(lid, uri, line, character).then((result) => {
        if (!result) return;
        preloadLanguageExtension(fromFileUri(result.location.uri));
        navigateToLocation(
          result.location,
          projectPath,
          tabKey,
          tab.projectId,
          tab.filePath,
          result.fileContent,
        );
      });

      return true;
    };

    const runFindRefs = (view: EditorView): boolean => {
      const lid = lspLanguageIdRef.current;
      if (!lid) return false;

      const pos = view.state.selection.main.head;
      const lineObj = view.state.doc.lineAt(pos);
      const line = lineObj.number - 1;
      const character = pos - lineObj.from;
      const uri = projectPath ? toFileUri(projectPath, tab.filePath) : '';

      // Best-effort symbol name for the palette title
      const word = view.state.wordAt(pos);
      const symbolHint = word ? view.state.sliceDoc(word.from, word.to) : undefined;

      definition.findReferences(lid, uri, line, character).then((results) => {
        if (results.length === 0) {
          useSymbolNavStore.getState().openFindUsages({
            projectId: tab.projectId,
            locations: [],
            symbolHint,
          });
          return;
        }
        useSymbolNavStore.getState().openFindUsages({
          projectId: tab.projectId,
          locations: results,
          symbolHint,
        });
      });

      return true;
    };

    const runFileStructure = (): boolean => {
      const lid = lspLanguageIdRef.current;
      if (!lid || !projectPath) return false;
      const uri = toFileUri(projectPath, tab.filePath);
      useSymbolNavStore.getState().openStructure({
        projectId: tab.projectId,
        projectPath,
        languageId: lid,
        uri,
        filePath: tab.filePath,
      });
      return true;
    };

    for (const key of [gotoDefCmKey, gotoDefAltCmKey]) {
      if (key) bindings.push({ key, run: runGotoDef });
    }
    for (const key of [findRefsCmKey, findRefsAltCmKey]) {
      if (key) bindings.push({ key, run: runFindRefs });
    }
    if (fileStructureCmKey) {
      bindings.push({ key: fileStructureCmKey, run: runFileStructure });
    }

    return bindings.length > 0 ? keymap.of(bindings) : [];
  }, [
    projectPath,
    tab.filePath,
    tabKey,
    tab.projectId,
    definition,
    navigateToLocation,
    gotoDefCmKey,
    gotoDefAltCmKey,
    findRefsCmKey,
    findRefsAltCmKey,
    fileStructureCmKey,
    lspLanguageIdRef,
  ]);
  /* eslint-enable react-hooks/refs */

  // Cmd+Click / Ctrl+Click — go to definition, clearing link highlight first.
  // Bound as a CodeMirror domEventHandlers extension (view-lifetime binding).
  const cmdClickExt = useCmdClickGoToDefinition({
    projectPath,
    tabKey,
    tab,
    lspLanguageIdRef,
    goToDefinition: definition.goToDefinitionWithContent,
    navigateToLocation,
  });

  return { lspKeymap, cmdClickExt };
}
