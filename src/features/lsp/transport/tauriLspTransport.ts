import type { Transport } from '@codemirror/lsp-client';
// eslint-disable-next-line no-restricted-imports -- invoke is needed for Tauri IPC calls to LSP backend
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { useNotificationStore } from '@/shared/store/notificationStore';

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
  private subscribed = false;

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
        useNotificationStore.getState().addNotification({
          type: 'error',
          title: 'LSP Connection Error',
          message: String(err),
        });
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

    // Guard against double-call: only register Tauri listeners once
    if (this.subscribed) return;
    this.subscribed = true;

    // Listen for server-pushed diagnostics via Tauri events,
    // and convert them to LSP JSON-RPC notifications for the client.
    const diagEventName = `lsp-diagnostics-${this.projectPath}`;
    listen<{ uri: string; diagnostics: unknown[] }>(diagEventName, (event) => {
      this.handlers.forEach((h) => h(JSON.stringify(event.payload)));
    }).then((unlisten) => {
      this.unlistenDiag = unlisten;
    });

    // Listen for work-done progress events
    const progressEventName = `lsp-progress-${this.projectPath}`;
    listen<{
      token: string;
      value: { kind: string; title?: string; message?: string; percentage?: number };
    }>(progressEventName, (event) => {
      this.handlers.forEach((h) => h(JSON.stringify(event.payload)));
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
