import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useMemo } from 'react';

import {
  clearLinkHighlight,
  fromFileUri,
  resolveLspPositionFromOffset,
  toFileUri,
} from '@/features/lsp';
import type { LspLocation } from '@/features/lsp/types';
import type { FileTab } from '@/shared/types';
import { preloadLanguageExtension } from '@/shared/utils/codemirror';
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
  tab: FileTab;
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
 */
export function handleCmdClickToDefinition({
  event,
  view,
  projectPath,
  tabKey,
  tab,
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

  const offset = view.posAtCoords({ x: event.clientX, y: event.clientY });
  const lspPos = resolveLspPositionFromOffset(offset, (p) => view.state.doc.lineAt(p));
  if (!lspPos) return;

  const uri = toFileUri(projectPath, tab.filePath);

  goToDefinition(lid, uri, lspPos.line, lspPos.character).then((result) => {
    if (!result) return;
    preloadLanguageExtension(fromFileUri(result.location.uri));
    return navigateToLocation(
      result.location,
      projectPath,
      tabKey,
      tab.projectId,
      tab.filePath,
      result.fileContent,
    );
  });
}

interface UseCmdClickGoToDefinitionParams {
  projectPath: string | null;
  tabKey: string;
  tab: FileTab;
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
  tab,
  lspLanguageIdRef,
  goToDefinition,
  navigateToLocation,
}: UseCmdClickGoToDefinitionParams): Extension {
  /* eslint-disable react-hooks/refs, react-hooks/exhaustive-deps -- the ref is
     only read inside the click handler (never during render) and is stable. */
  return useMemo(() => {
    if (!projectPath) return [];

    return EditorView.domEventHandlers({
      click: (event, view) => {
        handleCmdClickToDefinition({
          event,
          view,
          projectPath,
          tabKey,
          tab,
          lspLanguageIdRef,
          goToDefinition,
          navigateToLocation,
        });
      },
    });
    // eslint-disable-next-line react-hooks/refs, react-hooks/exhaustive-deps -- ref read only inside the click handler, never during render; stable
  }, [projectPath, tab.filePath, tabKey, tab.projectId, goToDefinition, navigateToLocation]);
  /* eslint-enable react-hooks/refs, react-hooks/exhaustive-deps */
}
