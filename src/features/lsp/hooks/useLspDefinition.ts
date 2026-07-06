import { useCallback } from 'react';

import { lspRequest } from '../api/lspApi';
import type { LspLocation } from '../types';

function toLspLocation(raw: unknown): LspLocation | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  // LocationLink (rust-analyzer returns this): { targetUri, targetRange }
  if (typeof obj.targetUri === 'string' && obj.targetRange) {
    return { uri: obj.targetUri, range: obj.targetRange as LspLocation['range'] };
  }
  // Location: { uri, range }
  if (typeof obj.uri === 'string' && obj.range) {
    return { uri: obj.uri, range: obj.range as LspLocation['range'] };
  }
  return null;
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

        // Handle single location, LocationLink, or array
        if (Array.isArray(result)) {
          for (const item of result) {
            const loc = toLspLocation(item);
            if (loc) return loc;
          }
          return null;
        }
        return toLspLocation(result);
      } catch (e) {
        console.error('[LSP] Go to definition failed:', e);
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

  return { goToDefinition, findReferences };
}
