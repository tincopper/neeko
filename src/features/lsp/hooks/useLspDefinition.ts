import { useCallback } from 'react';

import { lspRequest } from '../api/lspApi';
import type { LspLocation } from '../types';
import { definitionCacheKey, getOrFetchDefinition } from './lspCache';
import { lspGoToDefinition } from '../api/lspApi';

function toLspLocation(raw: unknown): LspLocation | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  // LocationLink (rust-analyzer): { targetUri, targetRange, targetSelectionRange }
  if (typeof obj.targetUri === 'string') {
    // Prefer targetSelectionRange (symbol name) over targetRange (full definition)
    const range = (obj.targetSelectionRange || obj.targetRange) as LspLocation['range'] | undefined;
    if (!range) return null;
    return { uri: obj.targetUri, range };
  }
  // Location: { uri, range }
  if (typeof obj.uri === 'string' && obj.range) {
    return { uri: obj.uri, range: obj.range as LspLocation['range'] };
  }
  return null;
}

function unwrapLocation(raw: unknown): LspLocation | null {
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const loc = toLspLocation(item);
      if (loc) return loc;
    }
    return null;
  }
  return toLspLocation(raw);
}

export interface GoToDefinitionWithContentResult {
  location: LspLocation;
  fileContent: string | null;
}

/**
 * Hook for Go to Definition and Find References.
 */
export function useLspDefinition(projectPath: string | null) {
  const goToDefinition = useCallback(
    async (
      languageId: string,
      uri: string,
      line: number,
      character: number,
    ): Promise<LspLocation | null> => {
      if (!projectPath) return null;

      try {
        const result = await lspRequest(projectPath, languageId, 'textDocument/definition', {
          textDocument: { uri },
          position: { line, character },
        });

        if (!result) return null;
        return unwrapLocation(result);
      } catch (e) {
        console.error('[LSP] Go to definition failed:', e);
        return null;
      }
    },
    [projectPath],
  );

  const goToDefinitionWithContent = useCallback(
    async (
      languageId: string,
      uri: string,
      line: number,
      character: number,
    ): Promise<GoToDefinitionWithContentResult | null> => {
      if (!projectPath) return null;

      try {
        const key = definitionCacheKey(projectPath, uri, line, character);
        const wrapped = await getOrFetchDefinition(key, () =>
          lspGoToDefinition(projectPath, languageId, uri, line, character),
        );

        if (!wrapped || !wrapped.lspResult) return null;
        const location = unwrapLocation(wrapped.lspResult);
        if (!location) return null;
        return { location, fileContent: wrapped.fileContent ?? null };
      } catch (e) {
        console.error('[LSP] Go to definition (with content) failed:', e);
        return null;
      }
    },
    [projectPath],
  );

  const findReferences = useCallback(
    async (
      languageId: string,
      uri: string,
      line: number,
      character: number,
    ): Promise<LspLocation[]> => {
      if (!projectPath) return [];

      try {
        const result = await lspRequest(projectPath, languageId, 'textDocument/references', {
          textDocument: { uri },
          position: { line, character },
          context: { includeDeclaration: true },
        });

        if (!result) return [];
        if (!Array.isArray(result)) return [];
        return result.map((item) => toLspLocation(item)).filter(Boolean) as LspLocation[];
      } catch (e) {
        console.error('[LSP] Find references failed:', e);
        return [];
      }
    },
    [projectPath],
  );

  return { goToDefinition, goToDefinitionWithContent, findReferences };
}
