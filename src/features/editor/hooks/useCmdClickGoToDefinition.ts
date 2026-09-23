import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useMemo } from 'react';

import { clearLinkHighlight } from '@/features/lsp';
import type { LspLocation } from '@/features/lsp/types';
import { useReferencesPeekStore } from '@/features/symbol-nav/store/referencesPeekStore';
import { preloadLanguageExtension } from '@/shared/utils/codemirror';
import { fileRefFromLspUri, sameFile } from '@/shared/utils/fileRef';
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
  findReferences: (
    languageId: string,
    uri: string,
    line: number,
    character: number,
  ) => Promise<LspLocation[]>;
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
 * 同文档判定：一律落在**身份所有者**（`fileRefFromLspUri` + `sameFile`）上，
 * 不在消费侧自造字符串归一 / 别名匹配（红线 12）。两侧任一解析失败 → false（不猜）。
 */
function sameDocumentUri(a: string, b: string): boolean {
  if (a === b) return true;
  const ra = fileRefFromLspUri(a);
  const rb = fileRefFromLspUri(b);
  return ra !== null && rb !== null && sameFile(ra, rb);
}

/**
 * 点击是否落在定义名上：定义目标与当前文档同一，且点击位置落在定义 range 内。
 * 纯函数，可独立单测；语言无关（不读 languageId）。
 */
export function isOnDefinitionSite(
  currentUri: string,
  line: number,
  character: number,
  location: LspLocation,
): boolean {
  if (!sameDocumentUri(currentUri, location.uri)) return false;
  const { start, end } = location.range;
  if (start.line !== line) return false;
  // LSP Range 是半开区间 [start, end)：`end` 处已不属于该符号
  // （点 `myFn` 后面的 `(` 不算落在定义名上）。零宽 range 不命中，退回跳转语义。
  return character >= start.character && character < end.character;
}
/**
 * Cmd+Click / Ctrl+Click → 上下文感知：定义处弹调用窗，调用处跳转定义。
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
  findReferences,
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
  // 点在编辑器外 → null。`resolveLspPositionFromOffset` 同样会返回 null，但这里必须
  // 显式收窄类型，供下方 `wordAt(offset)` 使用。
  if (offset === null) return;
  const lspPos = resolveLspPositionFromOffset(offset, (p) => view.state.doc.lineAt(p));
  if (!lspPos) return;

  goToDefinition(lid, lspDocumentUri, lspPos.line, lspPos.character).then(async (result) => {
    if (!result) return;
    // 定义处 → Peek 调用窗；调用处 → 跳转定义（分流复用本次 definition 结果，不多发请求）。
    if (isOnDefinitionSite(lspDocumentUri, lspPos.line, lspPos.character, result.location)) {
      const word = view.state.wordAt(offset);
      const symbolHint = word ? view.state.sliceDoc(word.from, word.to) : undefined;
      const locations = await findReferences(lid, lspDocumentUri, lspPos.line, lspPos.character);
      useReferencesPeekStore.getState().openPeek({
        projectId,
        projectPath,
        languageId: lid,
        locations,
        symbolHint,
        // 跳转端口：editor 域是「打开一个 LSP 位置」的唯一所有者（jdt 类文件 /
        // 项目外只读 tab 只有它建得对：readOnly + virtualUri）。store 不持有实现。
        navigate: (location) =>
          navigateToLocation(location, projectPath, tabKey, projectId, filePath),
      });
      return;
    }
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
  findReferences: (
    languageId: string,
    uri: string,
    line: number,
    character: number,
  ) => Promise<LspLocation[]>;
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
  findReferences,
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
          findReferences,
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
    findReferences,
    navigateToLocation,
  ]);
}
