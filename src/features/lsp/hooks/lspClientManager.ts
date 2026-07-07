import { LSPClient, hoverTooltips, serverCompletion, serverDiagnostics } from '@codemirror/lsp-client';
import type { Extension } from '@codemirror/state';

import { TauriLspTransport } from '../transport/TauriLspTransport';

interface LspClientEntry {
  client: LSPClient;
  transport: TauriLspTransport;
  refCount: number;
}

/** Shared LSP clients keyed by `projectPath:languageId`. */
const clients = new Map<string, LspClientEntry>();

function clientKey(projectPath: string, languageId: string): string {
  return `${projectPath}:${languageId}`;
}

/**
 * Acquire a shared LSP client for the given project + language.
 *
 * Returns a CodeMirror plugin extension for the specific file URI.
 * Multiple files of the same language share one LSP client + transport,
 * avoiding redundant LSP server processes and re-initialization on tab switch.
 */
export function acquireLspPlugin(
  projectPath: string,
  languageId: string,
  fileUri: string,
): Extension {
  const key = clientKey(projectPath, languageId);
  let entry = clients.get(key);

  if (!entry) {
    const client = new LSPClient({
      extensions: [serverCompletion(), hoverTooltips(), serverDiagnostics()],
      timeout: 10000,
    });
    const transport = new TauriLspTransport(projectPath, languageId);
    client.connect(transport);
    entry = { client, transport, refCount: 0 };
    clients.set(key, entry);
  }

  entry.refCount++;
  return entry.client.plugin(fileUri, languageId);
}

/**
 * Release a reference to a shared LSP client.
 *
 * When the last file using this client is closed, the transport is
 * destroyed after a short delay to allow pending didClose messages
 * to flush through the IPC layer.
 */
export function releaseLspClient(projectPath: string, languageId: string): void {
  const key = clientKey(projectPath, languageId);
  const entry = clients.get(key);
  if (!entry) return;

  entry.refCount--;
  if (entry.refCount <= 0) {
    const { transport } = entry;
    clients.delete(key);
    setTimeout(() => transport.destroy(), 200);
  }
}
