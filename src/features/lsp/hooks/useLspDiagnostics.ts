import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

import type { LspDiagnostic, LspDiagnosticsEvent } from '../types';

/**
 * Hook that listens for LSP diagnostics events from the backend
 * and provides a map of file URI → diagnostics.
 */
export function useLspDiagnostics(projectId: string | null) {
  const [diagnosticsMap, setDiagnosticsMap] = useState<Record<string, LspDiagnostic[]>>({});

  useEffect(() => {
    if (!projectId) return;

    const eventName = `lsp-diagnostics-${projectId}`;

    const unlistenPromise = listen<LspDiagnosticsEvent>(eventName, (event) => {
      const { uri, diagnostics } = event.payload;
      setDiagnosticsMap((prev) => ({
        ...prev,
        [uri]: diagnostics,
      }));
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [projectId]);

  const getDiagnostics = (uri: string): LspDiagnostic[] => {
    return diagnosticsMap[uri] ?? [];
  };

  const clearDiagnostics = (uri: string) => {
    setDiagnosticsMap((prev) => {
      const next = { ...prev };
      delete next[uri];
      return next;
    });
  };

  return { diagnosticsMap, getDiagnostics, clearDiagnostics };
}
