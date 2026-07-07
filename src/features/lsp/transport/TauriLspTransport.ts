import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Transport } from '@codemirror/lsp-client';

/**
 * Bridges @codemirror/lsp-client to Neeko's Rust LSP backend via Tauri IPC.
 *
 * - `send()` fires an async Tauri invoke; responses are delivered
 *   asynchronously through `subscribe` handlers.
 * - Server→client notifications (diagnostics) are received via Tauri
 *   events, converted to JSON-RPC, and forwarded to the client.
 */
export class TauriLspTransport implements Transport {
  private handlers = new Set<(value: string) => void>();
  private unlistenDiag: UnlistenFn | null = null;
  private unlistenProgress: UnlistenFn | null = null;

  constructor(
    private projectPath: string,
    private languageId: string,
  ) {}

  /**
   * Send a JSON-RPC message to the LSP server (via Rust backend).
   * Responses come back through the subscribe handler, not synchronously.
   */
  send(message: string): void {
    invoke<string>('lsp_transport', {
      projectPath: this.projectPath,
      languageId: this.languageId,
      message,
    })
      .then((response) => {
        // Empty response ("{}") means it was a notification — no response expected
        if (response && response !== '{}') {
          for (const h of this.handlers) {
            h(response);
          }
        }
      })
      .catch((err) => {
        console.error('[TauriLspTransport] send error:', err);
        // Synthesize a JSON-RPC error response so the client can handle it
        const errorResponse = JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: String(err) },
        });
        for (const h of this.handlers) {
          h(errorResponse);
        }
      });
  }

  subscribe(handler: (value: string) => void): void {
    this.handlers.add(handler);

    // Listen for server-pushed diagnostics via Tauri events,
    // and convert them to LSP JSON-RPC notifications for the client.
    const diagEventName = `lsp-diagnostics-${this.projectPath}`;
    listen<{ uri: string; diagnostics: unknown[] }>(diagEventName, (event) => {
      const notification = JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: {
          uri: event.payload.uri,
          diagnostics: event.payload.diagnostics,
        },
      });
      handler(notification);
    }).then((unlisten) => {
      this.unlistenDiag = unlisten;
    });

    // Listen for work-done progress events
    const progressEventName = `lsp-progress-${this.projectPath}`;
    listen<{
      languageId: string;
      token: string;
      kind: string;
      message: string | null;
      percentage: number | null;
    }>(progressEventName, (event) => {
      const { token, kind, message, percentage } = event.payload;
      let value: unknown;
      if (kind === 'begin') {
        value = { kind: 'begin', title: message ?? '' };
      } else if (kind === 'report') {
        value = { kind: 'report', message, percentage };
      } else {
        value = { kind: 'end', message };
      }
      const notification = JSON.stringify({
        jsonrpc: '2.0',
        method: '$/progress',
        params: { token, value },
      });
      handler(notification);
    }).then((unlisten) => {
      this.unlistenProgress = unlisten;
    });
  }

  unsubscribe(handler: (value: string) => void): void {
    this.handlers.delete(handler);
  }

  /** Clean up all event listeners. */
  destroy(): void {
    this.handlers.clear();
    this.unlistenDiag?.();
    this.unlistenDiag = null;
    this.unlistenProgress?.();
    this.unlistenProgress = null;
  }
}
