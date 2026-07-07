import { useCallback, useRef, useState } from 'react';

import { lspRequest } from '../api/lspApi';
import type { LspHoverResult } from '../types';

interface HoverState {
  content: string;
  x: number;
  y: number;
}

/**
 * Hook for LSP hover tooltip functionality.
 * Manages debounced hover requests and tooltip positioning.
 */
export function useLspHover() {
  const [hoverState, setHoverState] = useState<HoverState | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docRef = useRef<{
    projectPath: string;
    languageId: string;
    uri: string;
  } | null>(null);

  const setDocument = useCallback((projectPath: string, languageId: string, uri: string) => {
    docRef.current = { projectPath, languageId, uri };
  }, []);

  const onMouseMove = useCallback((line: number, character: number, x: number, y: number) => {
    const doc = docRef.current;
    if (!doc) return;

    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
    }

    hoverTimerRef.current = setTimeout(async () => {
      try {
        const result = await lspRequest(doc.projectPath, doc.languageId, 'textDocument/hover', {
          textDocument: { uri: doc.uri },
          position: { line, character },
        });

        if (!result) {
          setHoverState(null);
          return;
        }

        const hoverResult = result as LspHoverResult;
        const content = extractHoverContent(hoverResult);
        if (content) {
          setHoverState({ content, x, y });
        } else {
          setHoverState(null);
        }
      } catch {
        setHoverState(null);
      }
    }, 300);
  }, []);

  const hideHover = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
    }
    setHoverState(null);
  }, []);

  return { hoverState, setDocument, onMouseMove, hideHover };
}

function extractHoverContent(hover: LspHoverResult): string | null {
  if (!hover.contents || hover.contents.length === 0) return null;

  return hover.contents
    .map((c) => {
      if (typeof c === 'string') return c;
      return c.value;
    })
    .join('\n---\n');
}
