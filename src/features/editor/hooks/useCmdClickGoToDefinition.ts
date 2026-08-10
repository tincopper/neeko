import type { EditorView } from '@codemirror/view';
import { useEffect } from 'react';

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

interface UseCmdClickGoToDefinitionParams {
  editorViewRef: React.MutableRefObject<EditorView | null>;
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
 * Cmd+Click / Ctrl+Click — go to definition, clearing link highlight first.
 */
export function useCmdClickGoToDefinition({
  editorViewRef,
  projectPath,
  tabKey,
  tab,
  lspLanguageIdRef,
  goToDefinition,
  navigateToLocation,
}: UseCmdClickGoToDefinitionParams) {
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
    };

    editorEl.addEventListener('click', handler);
    return () => editorEl.removeEventListener('click', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs read inside event handler only
  }, [projectPath, tab.filePath, tabKey, tab.projectId, goToDefinition, navigateToLocation]);
}
