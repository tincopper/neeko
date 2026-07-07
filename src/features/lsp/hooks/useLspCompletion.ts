import { useCallback, useRef } from 'react';

import { lspRequest } from '../api/lspApi';

interface LspCompletionContext {
  projectPath: string;
  languageId: string;
  uri: string;
}

/**
 * Hook providing an LSP completion source for CodeMirror autocompletion.
 * Returns a function that can be used as a CodeMirror completion source.
 */
export function useLspCompletion() {
  const ctxRef = useRef<LspCompletionContext | null>(null);

  const setContext = useCallback((projectPath: string, languageId: string, uri: string) => {
    ctxRef.current = { projectPath, languageId, uri };
  }, []);

  const getCompletions = useCallback(
    async (
      line: number,
      character: number,
    ): Promise<Array<{ label: string; detail?: string; type?: string }>> => {
      const ctx = ctxRef.current;
      if (!ctx) return [];

      try {
        const result = await lspRequest(
          ctx.projectPath,
          ctx.languageId,
          'textDocument/completion',
          {
            textDocument: { uri: ctx.uri },
            position: { line, character },
            context: {
              triggerKind: 1, // Invoked
            },
          },
        );

        if (!result) return [];

        // Handle both CompletionList and CompletionItem[]
        const items = result.items ?? result;
        if (!Array.isArray(items)) return [];

        return items.map(
          (item: { label: string; detail?: string; kind?: number; insertText?: string }) => ({
            label: item.insertText ?? item.label,
            detail: item.detail ?? undefined,
            type: kindToString(item.kind),
          }),
        );
      } catch {
        return [];
      }
    },
    [],
  );

  return { setContext, getCompletions };
}

function kindToString(kind: number | undefined): string | undefined {
  const kinds: Record<number, string> = {
    1: 'Text',
    2: 'Method',
    3: 'Function',
    4: 'Constructor',
    5: 'Field',
    6: 'Variable',
    7: 'Class',
    8: 'Interface',
    9: 'Module',
    10: 'Property',
    11: 'Unit',
    12: 'Value',
    13: 'Enum',
    14: 'Keyword',
    15: 'Snippet',
    16: 'Color',
    17: 'File',
    18: 'Reference',
    19: 'Folder',
    20: 'EnumMember',
    21: 'Constant',
    22: 'Struct',
    23: 'Event',
    24: 'Operator',
    25: 'TypeParameter',
  };
  return kind !== undefined ? kinds[kind] : undefined;
}
