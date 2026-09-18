import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useMemo } from 'react';

import { clearLinkHighlight } from '@/features/lsp';
import type { LspLocation } from '@/features/lsp/types';
import { preloadLanguageExtension } from '@/shared/utils/codemirror';
import { jdtDisplayPath } from '@/shared/utils/jdt';
import { resolveLspPositionFromOffset } from '@/shared/utils/lspPosition';
import { IS_MACOS } from '@/shared/utils/platform';

type GoToDefinition = (
  languageId: string,
  uri: string,
  line: number,
  character: number,
) => Promise<{
  location: LspLocation;
  fileContent?: string | null;
} | null>;

interface HandleCmdClickParams {
  event: MouseEvent;
  view: EditorView;
  projectPath: string;
  tabKey: string;
  /** 派生后的 LSP 文档 uri（唯一派生点 `resolveLspDocumentUri`；null = 该 tab 无有效文档身份）。 */
  lspDocumentUri: string | null;
  projectId: string;
  filePath: string;
  lspLanguageIdRef: React.MutableRefObject<string | null>;
  goToDefinition: GoToDefinition;
  navigateToLocation: (
    location: LspLocation,
    projectPath: string,
    tabKey: string,
    projectId: string,
    currentFilePath: string,
    preloadedContent?: string | null,
  ) => Promise<void>;
}

/**
 * Cmd+Click / Ctrl+Click → go to definition.
 *
 * Pure handler (testable): uses the click coordinates — not the current
 * selection — so it jumps to the symbol under the mouse, matching the
 * link-highlight hover behavior.
 *
 * 只接收**显式标量**（uri / projectId / filePath）：闭包捕获整个 tab 对象会让本
 * 扩展的身份随宿主每次渲染抖动，进而触发 CodeMirror 全量 reconfigure。
 */
export function handleCmdClickToDefinition({
  event,
  view,
  projectPath,
  tabKey,
  lspDocumentUri,
  projectId,
  filePath,
  lspLanguageIdRef,
  goToDefinition,
  navigateToLocation,
}: HandleCmdClickParams): void {
  const modKey = IS_MACOS ? event.metaKey : event.ctrlKey;
  if (!modKey || event.button !== 0) return;

  event.preventDefault();

  // Clear link highlight immediately to prevent visual stutter
  clearLinkHighlight(view);

  const lid = lspLanguageIdRef.current;
  if (!lid) return;

  // 无有效文档身份（如 jdt 展示路径）→ 不发请求：伪造 `file://jdt:/…` 只会得到
  // 空结果，且与 F12 keymap（同样跳过）保持同一判定。
  if (!lspDocumentUri) return;

  const offset = view.posAtCoords({ x: event.clientX, y: event.clientY });
  const lspPos = resolveLspPositionFromOffset(offset, (p) => view.state.doc.lineAt(p));
  if (!lspPos) return;

  goToDefinition(lid, lspDocumentUri, lspPos.line, lspPos.character).then((result) => {
    if (!result) return;
    preloadLanguageExtension(jdtDisplayPath(result.location.uri));
    return navigateToLocation(
      result.location,
      projectPath,
      tabKey,
      projectId,
      filePath,
      result.fileContent,
    );
  });
}

interface UseCmdClickGoToDefinitionParams {
  projectPath: string | null;
  tabKey: string;
  lspDocumentUri: string | null;
  projectId: string;
  filePath: string;
  lspLanguageIdRef: React.MutableRefObject<string | null>;
  goToDefinition: GoToDefinition;
  navigateToLocation: (
    location: LspLocation,
    projectPath: string,
    tabKey: string,
    projectId: string,
    currentFilePath: string,
    preloadedContent?: string | null,
  ) => Promise<void>;
}

/**
 * Cmd+Click / Ctrl+Click — go to definition.
 *
 * Implemented as a CodeMirror `domEventHandlers` extension (same mechanism as
 * the link-highlight probe) so the listener is bound for the whole
 * EditorView lifetime. A plain `useEffect` reading `editorViewRef.current?.dom`
 * races view creation — the effect runs before `EditorView` mounts and its
 * dependency list has no view-ready signal — so the listener silently never
 * gets bound and Cmd+Click becomes a no-op.
 */
export function useCmdClickGoToDefinition({
  projectPath,
  tabKey,
  lspDocumentUri,
  projectId,
  filePath,
  lspLanguageIdRef,
  goToDefinition,
  navigateToLocation,
}: UseCmdClickGoToDefinitionParams): Extension {
  // 入参全是显式标量 + 稳定引用（ref 只被传递、不在渲染期解引用），
  // 故无需任何 lint 抑制：依赖数组完整且扩展身份稳定。
  return useMemo(() => {
    if (!projectPath) return [];

    return EditorView.domEventHandlers({
      click: (event, view) => {
        handleCmdClickToDefinition({
          event,
          view,
          projectPath,
          tabKey,
          lspDocumentUri,
          projectId,
          filePath,
          lspLanguageIdRef,
          goToDefinition,
          navigateToLocation,
        });
      },
    });
  }, [
    projectPath,
    tabKey,
    lspDocumentUri,
    projectId,
    filePath,
    lspLanguageIdRef,
    goToDefinition,
    navigateToLocation,
  ]);
}
