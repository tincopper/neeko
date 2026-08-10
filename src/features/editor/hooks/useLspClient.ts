import { useEffect, useMemo, useRef, useState } from 'react';

import {
  acquireLspPlugin,
  getLspLanguageId,
  releaseLspClient,
  resolveLspLanguageId,
  toFileUri,
  useLspLinkHighlightExtension,
} from '@/features/lsp';

interface UseLspClientParams {
  projectPath: string | null;
  filePath: string;
}

/**
 * LSP 客户端状态：语言 id（同步映射 + 后端注册表收紧）、
 * @codemirror/lsp-client 插件扩展、链接高亮扩展与文件 URI。
 */
export function useLspClient({ projectPath, filePath }: UseLspClientParams) {
  // Build file URI (used by keybindings, Cmd+Click handler, and LSP client)
  const fileUri = useMemo(
    () => (projectPath ? toFileUri(projectPath, filePath) : ''),
    [projectPath, filePath],
  );

  // Language id: sync map first, then tighten with live backend registry (custom plugins).
  const [lspLanguageId, setLspLanguageId] = useState<string | null>(() =>
    getLspLanguageId(filePath),
  );
  const lspLanguageIdRef = useRef(lspLanguageId);
  useEffect(() => {
    lspLanguageIdRef.current = lspLanguageId;
  }, [lspLanguageId]);

  // Sync LSP language id when filePath changes + async tighten with live backend registry
  useEffect(() => {
    const sync = getLspLanguageId(filePath);
    // Defer to avoid sync setState in effect (can trigger cascading renders)
    Promise.resolve().then(() => setLspLanguageId(sync));
    void resolveLspLanguageId(filePath).then((live) => {
      if (live) {
        setLspLanguageId(live);
      }
    });
  }, [filePath]);

  // @codemirror/lsp-client plugin — handles hover, diagnostics, completion, document lifecycle
  // Shared per (projectPath, languageId) so switching between files of the same
  // language reuses the existing LSP client instead of destroying and re-initializing.
  const [lspClientExt, setLspClientExt] = useState<import('@codemirror/state').Extension[]>([]);

  // LSP client ext is released via effect cleanup when deps become invalid
  useEffect(() => {
    if (!projectPath || !lspLanguageId || !fileUri) return;

    const plugin = acquireLspPlugin(projectPath, lspLanguageId, fileUri);
    // Defer to avoid sync setState in effect
    Promise.resolve().then(() => setLspClientExt([plugin]));

    return () => {
      setLspClientExt([]);
      releaseLspClient(projectPath, lspLanguageId);
    };
  }, [projectPath, lspLanguageId, fileUri]);

  // LSP link highlight (Cmd/Ctrl+hover underline) — visual cue only, does not affect navigation
  const linkHighlightExt = useLspLinkHighlightExtension(
    projectPath,
    projectPath ? lspLanguageId : null,
    projectPath ? toFileUri(projectPath, filePath) : '',
  );

  return { fileUri, lspLanguageIdRef, lspClientExt, linkHighlightExt };
}
