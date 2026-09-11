import type { Transport } from '@codemirror/lsp-client';
// eslint-disable-next-line no-restricted-imports -- invoke is needed for Tauri IPC calls to LSP backend
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { LSP_DIAG_EVENT_PREFIX, LSP_PROGRESS_EVENT_PREFIX } from '@/shared/events';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';

import { isVirtualDocLifecycleMessage } from '../jdt/jdtUtils';

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
    // 虚拟文档（jdtls 的 `jdt://` 类文件）不参与 LSP 文档生命周期——对齐
    // vscode-java：content-provider 文档不发 didOpen/didChange/didClose，
    // server 端从 uri 原生解析 IClassFile。发出去反而让 jdtls 把它当未知文档。
    if (isVirtualDocLifecycleMessage(message)) {
      return;
    }
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
    const diagEventName = `${LSP_DIAG_EVENT_PREFIX}${this.projectPath}`;
    listen<{ uri: string; diagnostics: unknown[] }>(diagEventName, (event) => {
      this.handlers.forEach((h) => h(JSON.stringify(event.payload)));
    }).then((unlisten) => {
      this.unlistenDiag = unlisten;
    });

    // Listen for work-done progress events
    const progressEventName = `${LSP_PROGRESS_EVENT_PREFIX}${this.projectPath}`;
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
    if (this.unlistenDiag) {
      safeUnlisten(this.unlistenDiag)();
      this.unlistenDiag = null;
    }
    if (this.unlistenProgress) {
      safeUnlisten(this.unlistenProgress)();
      this.unlistenProgress = null;
    }
  }
}
