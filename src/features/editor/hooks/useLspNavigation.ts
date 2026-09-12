import { EditorView, keymap } from '@codemirror/view';
import { useCallback, useMemo } from 'react';

import { useLspDefinition } from '@/features/lsp';
import {
  jdtClassFileDisplayName,
  loadDefinitionTargetContent,
  showNavigationFailure,
} from '@/features/lsp/api/definitionTarget';
import { fromFileUri, toFileUri } from '@/features/lsp/api/languageMap';
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
import { fileRefFromLspUri, fileRefFromTabPath, sameFile } from '@/shared/utils/fileRef';
import { getFileName, getTabId } from '@/shared/utils/fileTree';
import { isJdtDisplayPath, isJdtUri, jdtDisplayPath, tabLspDocumentUri } from '@/shared/utils/jdt';

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
 * 编辑器 tab 的 LSP 文档 uri；无法确定返回 null（调用方跳过该 LSP 功能）。
 *
 * 三态来源：tab 自带的原始 `jdt://…?<query>` → 派生的 jdt 文档 uri → 常规文件 uri。
 * **守卫**：`jdt:/…` 展示身份（如调试停点打开的 JDK 源码 —— 只有解压缓存内容、
 * 没有原始 uri）不存在对应 jdtls 文档，必须返回 null，不得退回 `file://jdt:/…`
 * 这种 jdtls 认不出的伪造 uri。
 */
export function resolveLspDocumentUri(
  tab: { filePath: string; virtualUri?: string; content?: { path: string } },
  projectPath: string,
): string | null {
  if (tab.virtualUri) return tab.virtualUri;
  const derived = tabLspDocumentUri(tab);
  if (derived) return derived;
  if (isJdtDisplayPath(tab.filePath)) return null;
  return projectPath ? toFileUri(projectPath, tab.filePath) : null;
}

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
      projPath: string,
      tKey: string,
      projId: string,
      currentFilePath: string,
      preloadedContent?: string | null,
    ) => {
      // jdt:// 类文件 uri 不是文件路径：映射为 `jdt:/<module>/<pkg>/<Name>.java`
      // 展示路径（面包屑可读、.java 结尾让 getLanguageExtension 命中高亮；
      // tab id / NavLocation 也用它，重跳转命中同一 tab）。file:// 原样。
      const targetPath = isJdtUri(location.uri)
        ? jdtDisplayPath(location.uri)
        : fromFileUri(location.uri);
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

      // 同文件判定只在 FileRef 身份上比较（fileRef 是文件身份唯一所有权模块）：
      // LSP uri 结构化解析为准，解析不出（罕见非 file/jdt scheme）时回退目标
      // tab path。相对路径 tab（快速打开/最近文件）/绝对路径 tab/jdt 展示路径
      // tab 三态一次归一——字符串直接比较永不相等，会把同文件跳转误开成重复
      // tab；jdt uri 与其展示路径也收敛为同一身份。
      const targetRef = fileRefFromLspUri(location.uri) ?? fileRefFromTabPath(projPath, targetPath);
      if (sameFile(targetRef, fileRefFromTabPath(projPath, currentFilePath))) {
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
          // preauth 桶键是 fs path（后端 record/check 一致），UUID 在此恒 miss；
          // projId 只用于 NavLocation/tab 键，门控一律走 projPath。
          const loaded = await loadDefinitionTargetContent(
            projId,
            projPath,
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

        // jdt:// 目标：标题取类文件显示名（uri `?` 前最后一段）；tab 的
        // filePath / id 已用 jdt 展示路径（见上），内容只读。file:// 目标沿用路径推导。
        const title = isJdtUri(location.uri)
          ? jdtClassFileDisplayName(location.uri)
          : getFileName(targetPath);
        const newTab: Tab = {
          id: targetTabId,
          projectId: projId,
          title,
          order: 0,
          data: {
            kind: 'file' as const,
            filePath: targetPath,
            fileName: title,
            content,
            isDirty: false,
            readOnly: isExternalReadonly || undefined,
            // 原始 jdt:// uri：tab 内发起的 LSP 请求（definition/hover/…）必须
            // 带它，jdtls 才能定位 IClassFile（filePath 是展示路径，非有效文档）。
            virtualUri: isJdtUri(location.uri) ? location.uri : undefined,
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
      const uri = resolveLspDocumentUri(tab, projectPath);
      if (!uri) return false;

      // eslint-disable-next-line react-hooks/purity -- performance.now() in callback, not during render
      definition.goToDefinitionWithContent(lid, uri, line, character).then((result) => {
        if (!result) return;
        preloadLanguageExtension(jdtDisplayPath(result.location.uri));
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
      const uri = resolveLspDocumentUri(tab, projectPath);
      if (!uri) return false;

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
      const uri = resolveLspDocumentUri(tab, projectPath);
      if (!uri) return false;
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
    tab,
    tabKey,
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

  return { lspKeymap, cmdClickExt, navigateToLocation };
}
