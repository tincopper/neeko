import { LSPClient, serverDiagnostics, signatureHelp } from '@codemirror/lsp-client';
import type { Extension } from '@codemirror/state';

import { IdleRefCountedCache } from '../idleRefCountedCache';
import { TauriLspTransport } from '../transport/tauriLspTransport';

import { createThemedServerCompletion } from './lspCompletionInfoRenderer';
import { createLspHoverTooltips } from './lspHoverExtension';

interface LspClientBundle {
  client: LSPClient;
  transport: TauriLspTransport;
}

/**
 * Keep idle LSP clients warm long enough to survive tab switches during
 * go-to-definition (unmount source → mount target of the same language).
 * Previously the client was deleted immediately on refCount=0, forcing a
 * full reconnect + re-plugin on every cross-file jump (~0.5–3s perceived).
 */
const LSP_CLIENT_IDLE_DESTROY_MS = 15_000;

const pool = new IdleRefCountedCache<LspClientBundle>({
  destroyDelayMs: LSP_CLIENT_IDLE_DESTROY_MS,
  onDestroy: (_key, bundle) => {
    try {
      bundle.transport.destroy();
    } catch {
      // ignore cleanup errors
    }
  },
});

function clientKey(projectPath: string, languageId: string): string {
  return `${projectPath}:${languageId}`;
}

/**
 * LSP 请求超时（ms）：java 需大超时 —— jdtls 是 JVM + Eclipse 冷启动（`-Xms1G`），
 * 首次 initialize 常超 30s（后端初始化等待无超时，靠前端兜底）；其余语言服务器
 * 秒级响应，15s 足够。
 */
export function lspClientTimeout(languageId: string): number {
  return languageId === 'java' ? 120_000 : 15_000;
}

/** LSP 方法 → 友好功能名（超时/错误提示用；未命中回退原始方法名）。 */
export function lspMethodLabel(method: string): string {
  const LABELS: Record<string, string> = {
    'textDocument/hover': 'Hover',
    'textDocument/definition': 'Go to Definition',
    'textDocument/declaration': 'Go to Declaration',
    'textDocument/implementation': 'Go to Implementation',
    'textDocument/typeDefinition': 'Go to Type Definition',
    'textDocument/references': 'Find References',
    'textDocument/documentSymbol': 'Document Symbols',
    'textDocument/documentLink': 'Document Links',
    'textDocument/completion': 'Code Completion',
    'textDocument/signatureHelp': 'Signature Help',
    'textDocument/codeLens': 'CodeLens',
    'textDocument/formatting': 'Format Document',
    'textDocument/rename': 'Rename',
    'textDocument/semanticTokens/full': 'Semantic Highlighting',
    'workspace/symbol': 'Workspace Symbol Search',
    initialize: 'Initialize Handshake',
  };
  return LABELS[method] ?? method;
}

/** 若 `err` 为 LSP 客户端超时（裸 "Request timed out"）→ 返回带功能名的提示；否则 null。 */
export function lspRequestTimeoutMessage(method: string, err: unknown): string | null {
  if (err instanceof Error && err.message === 'Request timed out') {
    return `LSP request timed out (${lspMethodLabel(method)})`;
  }
  return null;
}

/**
 * 标注 LSP 请求错误来源：`@codemirror/lsp-client` 的 `timeoutRequest` 只抛裸
 * `"Request timed out"`，方法名/功能上下文全部丢失 —— 全局错误提示只剩一句
 * 超时，用户无法定位是哪个功能。包装 `request`：超时时把 LSP 方法名（映射为
 * 友好功能名）附进错误信息。
 */
function annotateLspRequestErrors(client: LSPClient): void {
  if (typeof client.request !== 'function') {
    return;
  }
  const originalRequest = client.request.bind(client);
  client.request = <P, R>(method: string, params: P): Promise<R> =>
    originalRequest<P, R>(method, params).catch((err: unknown) => {
      const timeoutMsg = lspRequestTimeoutMessage(method, err);
      if (timeoutMsg) {
        throw new Error(timeoutMsg);
      }
      throw err;
    });
}

/**
 * Acquire a shared LSP client for the given project + language.
 *
 * Returns a CodeMirror plugin extension for the specific file URI.
 * Multiple files of the same language share one LSP client + transport.
 * Tab switches cancel the idle destroy timer so the client is reused.
 *
 * `options` 仅在 client 首建（pool 工厂）时被捕获；后续同 key 调用的
 * options 被忽略。当前唯一消费方是 hover 的 `onOpenJdtLink` 回调——
 * 各宿主实例传入的回调行为等价（store 驱动、无 per-file 视图依赖），
 * 首建捕获不会产生行为漂移。
 */
export function acquireLspPlugin(
  projectPath: string,
  languageId: string,
  fileUri: string,
  options?: { onOpenJdtLink?: (uri: string) => void },
): Extension {
  const key = clientKey(projectPath, languageId);
  const bundle = pool.acquire(key, () => {
    // timeout: java 120s（jdtls JVM/Eclipse 冷启动慢，见 lspClientTimeout），其余 15s。
    const client = new LSPClient({
      extensions: [
        createThemedServerCompletion(),
        createLspHoverTooltips({ onOpenJdtLink: options?.onOpenJdtLink }),
        serverDiagnostics(),
        signatureHelp(),
      ],
      timeout: lspClientTimeout(languageId),
    });
    const transport = new TauriLspTransport(projectPath, languageId);
    annotateLspRequestErrors(client);
    client.connect(transport);
    return { client, transport };
  });

  return bundle.client.plugin(fileUri, languageId);
}

/**
 * Release a reference to a shared LSP client.
 *
 * When the last file using this client is closed, destruction is delayed
 * so a quick re-acquire (tab switch / go-to-definition) reuses the client.
 */
export function releaseLspClient(projectPath: string, languageId: string): void {
  pool.release(clientKey(projectPath, languageId));
}

/** @internal test helper */
export function __resetLspClientPoolForTests(): void {
  pool.clear();
}
