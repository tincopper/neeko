import { useCallback, useRef } from 'react';

import { lspOpenDocument, lspChangeDocument, lspCloseDocument, lspRequest } from '../api/lspApi';

interface LspDocumentState {
  uri: string;
  languageId: string;
  version: number;
  projectPath: string;
}

const LANGUAGE_MAP: Record<string, string> = {
  rs: 'rust',
  py: 'python',
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  jsx: 'javascriptreact',
  go: 'go',
  java: 'java',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  kt: 'kotlin',
  scala: 'scala',
  lua: 'lua',
  ex: 'elixir',
  r: 'r',
  sql: 'sql',
};

function getLanguageId(ext: string): string | null {
  return LANGUAGE_MAP[ext] ?? null;
}

/** Convert a possibly-relative filePath to a proper file:// URI. */
export function toFileUri(projectPath: string, filePath: string): string {
  const absPath = filePath.startsWith('/') ? filePath : `${projectPath}/${filePath}`;
  return `file://${absPath}`;
}

/**
 * Hook managing an LSP session for a single open document.
 * Tracks document version and handles open/change/close lifecycle.
 */
export function useLsp() {
  const docRef = useRef<LspDocumentState | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openDocument = useCallback(async (projectPath: string, filePath: string, text: string): Promise<boolean> => {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const languageId = getLanguageId(ext);
    if (!languageId) return false;

    const uri = toFileUri(projectPath, filePath);
    docRef.current = { uri, languageId, version: 1, projectPath };

    try {
      await lspOpenDocument(projectPath, languageId, uri, text, 1);
      return true;
    } catch (e) {
      console.error('[LSP] Failed to open document:', e);
      return false;
    }
  }, []);

  const changeDocument = useCallback(async (newText: string) => {
    const doc = docRef.current;
    if (!doc) return;

    doc.version += 1;
    const version = doc.version;

    // Debounce rapid changes
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      try {
        await lspChangeDocument(doc.projectPath, doc.languageId, doc.uri, version, [
          { text: newText },
        ]);
      } catch (e) {
        console.error('[LSP] Failed to change document:', e);
      }
    }, 300);
  }, []);

  const closeDocument = useCallback(async () => {
    const doc = docRef.current;
    if (!doc) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    try {
      await lspCloseDocument(doc.projectPath, doc.languageId, doc.uri);
    } catch (e) {
      console.error('[LSP] Failed to close document:', e);
    }

    docRef.current = null;
  }, []);

  const getCurrentLanguageId = useCallback((): string | null => {
    return docRef.current?.languageId ?? null;
  }, []);

  const request = useCallback(async (method: string, params: unknown) => {
    const doc = docRef.current;
    if (!doc) throw new Error('No active LSP document');

    return lspRequest(doc.projectPath, doc.languageId, method, params);
  }, []);

  return { openDocument, changeDocument, closeDocument, request, getCurrentLanguageId, getLanguageId };
}
