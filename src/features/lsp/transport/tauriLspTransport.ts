import type { Transport } from '@codemirror/lsp-client';
// eslint-disable-next-line no-restricted-imports -- invoke is needed for Tauri IPC calls to LSP backend
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { resolveEditorViewFromUri } from '@/features/editor/api/editorViews';
import {
  LSP_APPLY_EDIT_EVENT_PREFIX,
  LSP_DIAG_EVENT_PREFIX,
  LSP_PROGRESS_EVENT_PREFIX,
} from '@/shared/events';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';

import { applyWorkspaceEdit, targetUrisOf, type LspWorkspaceEdit } from '../hooks/lspWorkspaceEdit';
import { isVirtualDocLifecycleMessage } from '../jdt/jdtUtils';

import {
  rememberPendingCompletionId,
  summarizeCompletionDiagnostics,
  summarizeCompletionRequest,
  summarizeLifecycleMessage,
} from './lspCompletionProbe';

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
  private unlistenApplyEdit: UnlistenFn | null = null;
  private subscribed = false;
  /** 已销毁：此后 `send()` 一律丢弃（见 `send()` 注释）。 */
  private destroyed = false;
  /** DEV 探针：在途 completion 请求 id（响应回来时据此识别并摘要）。 */
  private pendingCompletionIds = new Set<string | number>();

  constructor(
    private projectPath: string,
    private languageId: string,
  ) {}

  /**
   * Send a JSON-RPC message to the LSP server (via Rust backend).
   * Responses come back through the subscribe handler, not synchronously.
   */
  send(message: string): void {
    // 已销毁的 transport 必须是**哑的**：destroy() 只清订阅，若不设闸，一个仍被
    // 插件的僵尸 client 能继续把 didOpen/didChange 写进后端**仍然活着**的会话
    // （会话按 project+language 复用），用自己那套版本号覆盖真实文档状态 ——
    // 实测症状：服务器报 `duplicate DidOpenTextDocument` 后停止分析该文档。
    if (this.destroyed) {
      if (import.meta.env.DEV) {
        console.info(`[LSP-probe] send after destroy ignored (${this.languageId})`);
      }
      return;
    }
    // 虚拟文档（jdtls 的 `jdt://` 类文件）不参与 LSP 文档生命周期——对齐
    // vscode-java：content-provider 文档不发 didOpen/didChange/didClose，
    // server 端从 uri 原生解析 IClassFile。发出去反而让 jdtls 把它当未知文档。
    if (isVirtualDocLifecycleMessage(message)) {
      return;
    }
    // 文档同步探针（仅 DEV）：补全前必须能看到 didChange（否则服务器文本停在打开那一刻）。
    if (import.meta.env.DEV) {
      const lifecycle = summarizeLifecycleMessage(message);
      if (lifecycle) console.info(`[LSP-probe] ⇐ ${lifecycle} (${this.languageId})`);
    }
    // 自动导包探针（仅 DEV）：记录在途请求 id，响应侧据此打印「服务端是否给了
    // additionalTextEdits」——这是「接受补全后 import 不落」的分叉点。
    if (import.meta.env.DEV && message.includes('"textDocument/completion"')) {
      console.info('[LSP] ⇒ completion request', summarizeCompletionRequest(message));
      try {
        const id = (JSON.parse(message) as { id?: string | number }).id;
        if (id != null) rememberPendingCompletionId(this.pendingCompletionIds, id);
      } catch {
        // 非 JSON 载荷：忽略探针，不影响调用。
      }
    }
    invoke<string>('lsp_transport', {
      projectPath: this.projectPath,
      languageId: this.languageId,
      message,
    })
      .then((response) => {
        // Empty response ("{}") means it was a notification — no response expected
        if (response && response !== '{}') {
          this.probeCompletionResponse(response);
          for (const h of this.handlers) {
            h(response);
          }
        }
      })
      .catch((err) => {
        // DEV 探针：失败的请求不会回包，其 id 再也匹配不上 —— 清掉避免集合无界增长。
        this.pendingCompletionIds.clear();
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

  /**
   * 自动导包探针（仅 DEV）：若响应属于一个在途 completion 请求，打印
   * 「服务端是否给了 additionalTextEdits」——0 即服务端未提供（服务器侧），
   * >0 而 import 仍不落即客户端应用层（补丁/渲染层）问题。
   */
  private probeCompletionResponse(response: string): void {
    if (!import.meta.env.DEV || this.pendingCompletionIds.size === 0) return;
    let parsed: { id?: string | number; result?: unknown };
    try {
      parsed = JSON.parse(response) as { id?: string | number; result?: unknown };
    } catch {
      return;
    }
    if (parsed.id == null || !this.pendingCompletionIds.delete(parsed.id)) return;
    const summary = summarizeCompletionDiagnostics(parsed.result);
    console.info(
      `[LSP-probe] completion response: ${summary.total} items, ` +
        `with-additionalTextEdits=${summary.withAdditionalEdits}, ` +
        `import-candidates=${summary.importCandidates.length}`,
      summary.samples,
      summary.importCandidates,
    );
  }

  subscribe(handler: (value: string) => void): void {
    this.handlers.add(handler);
    // Guard against double-call: only register Tauri listeners once
    if (this.subscribed) return;
    this.subscribed = true;

    // Listen for server-pushed diagnostics via Tauri events,
    // and convert them to LSP JSON-RPC notifications for the client.
    // Rust 侧只发 {uri, diagnostics} 裸载荷；lsp-client 按 JSON-RPC method 路由
    // 消息——必须补全信封，否则通知被静默丢弃（「有诊断、无波浪线」的根因）。
    const diagEventName = `${LSP_DIAG_EVENT_PREFIX}${this.projectPath}`;
    listen<{ uri: string; diagnostics: unknown[]; version?: number | null }>(
      diagEventName,
      (event) => {
        const { uri, diagnostics, version } = event.payload;
        this.handlers.forEach((h) =>
          h(
            JSON.stringify({
              jsonrpc: '2.0',
              method: 'textDocument/publishDiagnostics',
              params: {
                uri,
                diagnostics,
                // `version` 决定 lsp-client 的版本门是否生效（诊断坐标属于哪一版文本）。
                // Rust 侧序列化 `Option<i64>` 会给出显式 `null`，而 lsp-client 的门是
                // `params.version != null && ...` —— 显式 `null` 与"字段缺失"等价（都是
                // 不拦截），但显式 `undefined` 会让 JSON.stringify 丢掉该字段，语义更清楚。
                ...(version == null ? {} : { version }),
              },
            }),
          ),
        );
      },
    ).then((unlisten) => {
      this.unlistenDiag = unlisten;
    });

    // Listen for work-done progress events（同病同修：$/progress 通知也需信封）
    const progressEventName = `${LSP_PROGRESS_EVENT_PREFIX}${this.projectPath}`;
    listen<{
      token: string;
      value: { kind: string; title?: string; message?: string; percentage?: number };
    }>(progressEventName, (event) => {
      this.handlers.forEach((h) =>
        h(
          JSON.stringify({
            jsonrpc: '2.0',
            method: '$/progress',
            params: { token: event.payload.token, value: event.payload.value },
          }),
        ),
      );
    }).then((unlisten) => {
      this.unlistenProgress = unlisten;
    });

    // 服务端请示的 `workspace/applyEdit`（Rust 侧已回 `{applied:true}`）：这里真正落
    // 编辑。按 languageId 分流 —— 同一 project 下每种语言各有一个 transport，
    // 不分流会把 Go 的编辑当成 Rust 的重复应用。
    const applyEditEventName = `${LSP_APPLY_EDIT_EVENT_PREFIX}${this.projectPath}`;
    listen<{ languageId: string; edit: LspWorkspaceEdit }>(applyEditEventName, (event) => {
      const payload = event.payload;
      if (!payload || payload.languageId !== this.languageId) return;
      // 每个目标文件一次 dispatch：文件内多 edit 仍是单事务（单步撤销）
      for (const uri of targetUrisOf(payload.edit)) {
        applyWorkspaceEdit(payload.edit, uri, resolveEditorViewFromUri);
      }
    }).then((unlisten) => {
      this.unlistenApplyEdit = unlisten;
    });
  }

  unsubscribe(handler: (value: string) => void): void {
    this.handlers.delete(handler);
  }

  /** Clean up all event listeners（此后 `send()` 变为 no-op）。 */
  destroy(): void {
    this.destroyed = true;
    this.handlers.clear();
    if (this.unlistenDiag) {
      safeUnlisten(this.unlistenDiag)();
      this.unlistenDiag = null;
    }
    if (this.unlistenProgress) {
      safeUnlisten(this.unlistenProgress)();
      this.unlistenProgress = null;
    }
    if (this.unlistenApplyEdit) {
      safeUnlisten(this.unlistenApplyEdit)();
      this.unlistenApplyEdit = null;
    }
  }
}
