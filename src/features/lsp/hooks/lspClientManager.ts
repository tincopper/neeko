import { LSPClient, serverCompletion, serverDiagnostics } from '@codemirror/lsp-client';
import type { Extension } from '@codemirror/state';

import { IdleRefCountedCache } from '../idleRefCountedCache';
import { TauriLspTransport } from '../transport/TauriLspTransport';

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
 * Acquire a shared LSP client for the given project + language.
 *
 * Returns a CodeMirror plugin extension for the specific file URI.
 * Multiple files of the same language share one LSP client + transport.
 * Tab switches cancel the idle destroy timer so the client is reused.
 */
export function acquireLspPlugin(
  projectPath: string,
  languageId: string,
  fileUri: string,
): Extension {
  const key = clientKey(projectPath, languageId);
  const bundle = pool.acquire(key, () => {
    // timeout: 15000ms covers slow LSP server startup (spawn + init handshake).
    const client = new LSPClient({
      extensions: [serverCompletion(), createLspHoverTooltips(), serverDiagnostics()],
      timeout: 15000,
    });
    const transport = new TauriLspTransport(projectPath, languageId);
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
