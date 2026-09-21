import { useEffect, useMemo, useRef, useState } from 'react';

import {
  acquireLspPlugin,
  releaseLspClient,
  useLspLinkHighlightExtension,
  withJdtLinkHandler,
} from '@/features/lsp';
import {
  claimDocumentOwnership,
  releaseDocumentOwnership,
} from '@/features/lsp/api/documentOwnership';
import { getLspLanguageId, resolveLspLanguageId, toFileUri } from '@/features/lsp/api/languageMap';

interface UseLspClientParams {
  projectPath: string | null;
  filePath: string;
  /**
   * LSP 虚拟文档 uri（如 jdtls 的 `jdt://` 类文件）。存在时取代 toFileUri(filePath)
   * 作为本 tab 全部 LSP 请求的 textDocument.uri —— 虚拟文档不是磁盘文件，
   * jdtls 只认原始 jdt:// uri（见 FileTabData.virtualUri）。
   */
  virtualUri?: string;
  /**
   * hover 文档里 `jdt://` 链接的宿主导航回调（见 createLspHoverTooltips）。
   * 经 `jdtLinkHandlerFacet` 随本文件视图注入，不受"共享 client 首建捕获"影响 ——
   * 每个 tab 拿到自己的回调（仍建议传稳定引用，减少插件扩展重建）。
   */
  onOpenJdtLink?: (uri: string) => void;
}

/**
 * LSP 客户端状态：语言 id（同步映射 + 后端注册表收紧）、
 * @codemirror/lsp-client 插件扩展、链接高亮扩展与文件 URI。
 */
export function useLspClient({
  projectPath,
  filePath,
  virtualUri,
  onOpenJdtLink,
}: UseLspClientParams) {
  // Build file URI (used by keybindings, Cmd+Click handler, and LSP client)
  const fileUri = useMemo(
    () => (virtualUri ? virtualUri : projectPath ? toFileUri(projectPath, filePath) : ''),
    [projectPath, filePath, virtualUri],
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
    // 视图持有声明：必须在 CM 插件挂载（didOpen）**之前**发出 —— 否则请求可能先到，
    // 后端会用磁盘文本代开，服务器按旧文本报出错位诊断（谁编辑谁负责打开）。
    claimDocumentOwnership(projectPath, lspLanguageId, fileUri);
    // 按本视图注入 jdt 链接回调（共享 client 不持有宿主闭包）
    const perFile = withJdtLinkHandler(plugin, onOpenJdtLink);
    // Defer to avoid sync setState in effect
    Promise.resolve().then(() => setLspClientExt([perFile]));

    return () => {
      setLspClientExt([]);
      releaseDocumentOwnership(projectPath, lspLanguageId, fileUri);
      releaseLspClient(projectPath, lspLanguageId);
    };
  }, [projectPath, lspLanguageId, fileUri, onOpenJdtLink]);

  // LSP link highlight (Cmd/Ctrl+hover underline) — visual cue only, does not affect navigation
  const linkHighlightExt = useLspLinkHighlightExtension(
    projectPath,
    projectPath ? lspLanguageId : null,
    projectPath ? toFileUri(projectPath, filePath) : '',
  );

  return { fileUri, lspLanguageIdRef, lspClientExt, linkHighlightExt };
}
