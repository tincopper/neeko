import { useState, useEffect } from 'react';

import { useNotificationStore } from '@/features/notification/notificationStore';

import { lspRequest } from '../api/lspApi';

/**
 * Capabilities advertised by the LSP server after initialization.
 * Used for graceful degradation — disable features the server doesn't support.
 */
export interface LspCapabilities {
  definitionProvider: boolean;
  referencesProvider: boolean;
  hoverProvider: boolean;
  completionProvider: boolean;
  documentHighlightProvider: boolean;
  renameProvider: boolean;
  formattingProvider: boolean;
}

const EMPTY_CAPABILITIES: LspCapabilities = {
  definitionProvider: false,
  referencesProvider: false,
  hoverProvider: false,
  completionProvider: false,
  documentHighlightProvider: false,
  renameProvider: false,
  formattingProvider: false,
};

/**
 * Extract capabilities from the server's initialize response result.
 * The capabilities are cached by the Rust backend and returned via the
 * lsp_transport command when @codemirror/lsp-client sends initialize.
 *
 * For now, returns the full set as a best-effort since the Rust backend
 * already validated capabilities during the handshake.
 * Falls back to EMPTY_CAPABILITIES if the LSP session isn't available.
 */
export function useLspCapabilities(
  projectPath: string | null,
  languageId: string | null,
): LspCapabilities {
  const [caps, setCaps] = useState<LspCapabilities>(EMPTY_CAPABILITIES);

  useEffect(() => {
    if (!projectPath || !languageId) {
      setCaps(EMPTY_CAPABILITIES);
      return;
    }

    let cancelled = false;

    // Probe the server by sending a dummy hover request at position 0,0
    // If it responds without error, the server is ready.
    // A real capability check would use the initialize response,
    // but for graceful degradation we just verify connectivity.
    lspRequest(projectPath, languageId, 'textDocument/hover', {
      textDocument: { uri: `file://${projectPath}/_probe_` },
      position: { line: 0, character: 0 },
    })
      .then(() => {
        if (!cancelled) {
          setCaps({
            definitionProvider: true,
            referencesProvider: true,
            hoverProvider: true,
            completionProvider: true,
            documentHighlightProvider: true,
            renameProvider: false, // not yet supported
            formattingProvider: false, // not yet supported
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCaps(EMPTY_CAPABILITIES);
          useNotificationStore.getState().addNotification({
            type: 'warning',
            title: 'LSP Server Unavailable',
            message: `LSP for ${languageId} is not responding. Language features are disabled.`,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectPath, languageId]);

  return caps;
}
