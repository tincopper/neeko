import type { Transport } from '@codemirror/lsp-client';
// eslint-disable-next-line no-restricted-imports -- invoke is needed for Tauri IPC calls to LSP backend
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { LSP_DIAG_EVENT_PREFIX, LSP_PROGRESS_EVENT_PREFIX } from '@/shared/events';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';

import { isVirtualDocLifecycleMessage } from '../jdt/jdtUtils';

/** 自动导包探针的样本项（最多取 `MAX_SAMPLES` 条）。 */
interface CompletionDiagnosticSample {
  label: string;
  /** `additionalTextEdits` 条数（>0 即"该补全自带 import 编辑"）。 */
  edits: number;
  insertTextFormat: number | undefined;
}

/** 需要 import 的候选（`label` + 模块路径）—— 自动导包探针的关键判据。 */
interface ImportCandidateSample {
  label: string;
  /** 模块路径（r-a 放在 `labelDetails.detail`；未声明 labelDetailsSupport 时降级到 `detail`）。 */
  modulePath: string;
  /** 该项自带的附加编辑数：>0 = 接受补全即自动落 import。 */
  edits: number;
  hasData: boolean;
}

/** 自动导包探针的响应摘要。 */
export interface CompletionDiagnostics {
  total: number;
  /** 带 `additionalTextEdits` 的项数 —— 0 表示**服务端**没给 import 编辑。 */
  withAdditionalEdits: number;
  /**
   * 需要 import 的候选（最多 [`MAX_SAMPLES`] 条）。
   *
   * 存在的理由：`withAdditionalEdits=0` 有两种截然不同的含义 —— ① 列表里**没有**
   * 需要导包的符号（例如该类型在本文件已导入，或前缀没匹配到）②有候选但服务器把编辑
   * 藏起来了（jdtls 式 resolve 延迟）。只看 0 无法区分，会让排查误判方向。
   */
  importCandidates: ImportCandidateSample[];
  samples: CompletionDiagnosticSample[];
}

/**
 * 文档同步探针（仅 DEV）：把「发给服务器的文档生命周期」摊平成一行。
 *
 * 判据用途：补全列表**不随前缀收敛**（例如前缀 1..6 个字符恒为同一份 167 项、
 * 第 7 个字符突然 0 项）是"服务器手里的文本停在 didOpen 那一刻"的典型症状 ——
 * 前缀恒空 + 位置越界即空列表。此探针与补全请求探针的 uri 对照即可定位同步断点。
 */
export function summarizeLifecycleMessage(message: string): string | null {
  let parsed: {
    method?: string;
    params?: {
      textDocument?: { uri?: string; version?: number; text?: string };
      contentChanges?: { text?: string; range?: unknown }[];
    };
  };
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  const method = parsed.method ?? '';
  if (!method.startsWith('textDocument/did')) return null;
  const uri = parsed.params?.textDocument?.uri ?? '?';
  const name = uri.split('/').pop() ?? uri;
  const changes = parsed.params?.contentChanges ?? [];
  const text = parsed.params?.textDocument?.text;
  const detail = changes.length
    ? `changes=${changes.length} full=${changes.some((c) => !c.range)} len=${changes
        .map((c) => c.text?.length ?? -1)
        .join(',')}`
    : text != null
      ? `open-len=${text.length}`
      : 'no-payload';
  return `${method} ${name} v=${parsed.params?.textDocument?.version ?? '-'} ${detail}`;
}

/** 从补全请求里取「目标 uri 尾段 + 位置」：与生命周期探针的 uri 必须一致。 */
export function summarizeCompletionRequest(message: string): string | null {
  let parsed: {
    id?: unknown;
    params?: { textDocument?: { uri?: string }; position?: { line: number; character: number } };
  };
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  if (parsed.id == null) return null;
  const uri = parsed.params?.textDocument?.uri ?? '?';
  const pos = parsed.params?.position;
  return `id=${String(parsed.id)} ${uri.split('/').pop() ?? uri} @${pos?.line}:${pos?.character}`;
}

/** 路径关键字不是导包候选（r-a 的 `self::` / `crate::` / `super::` 补全项）。 */
const PATH_KEYWORDS = new Set(['self::', 'crate::', 'super::', 'Self::', 'macro_rules!']);

/**
 * 从候选里提取「模块路径」：`labelDetails.detail` 优先，其次 `detail`。
 * `detail` 里的函数签名（`fn(…)`）等不含 `::`，天然被下面的过滤排除。
 */
function modulePathOf(item: Record<string, unknown>): string | null {
  const labelDetails = item.labelDetails as { detail?: unknown; description?: unknown } | undefined;
  for (const raw of [labelDetails?.detail, labelDetails?.description, item.detail]) {
    const text = typeof raw === 'string' ? raw : '';
    if (text.includes('::')) return text;
  }
  return null;
}

const MAX_SAMPLES = 3;

/**
 * DEV 探针保留的在途 completion id 上限。
 *
 * 未回包/被 cancelRequest 的请求不会走响应分支，id 若只增不删就会在长开发会话里
 * 无界增长（常驻应用的内存卫生）。超过上限时淘汰**最旧**的一条（Set 保持插入序），
 * 保证最新请求仍可被摘要。
 */
const MAX_PENDING_COMPLETION_IDS = 64;

/**
 * 登记一个在途 completion id，并保持集合有界（超限淘汰**最旧**，Set 保持插入序）。
 *
 * 抽成纯函数：`Set` 的"只增不删"是常驻应用的内存卫生隐患，而它的不变量（有界 +
 * 保新）只能通过对集合本身断言来钉住，走 `send()` 无法构造（响应只可能来自已登记的
 * 请求，再发一次就会重新登记）。
 */
export function rememberPendingCompletionId(
  pending: Set<string | number>,
  id: string | number,
  max = MAX_PENDING_COMPLETION_IDS,
): void {
  if (pending.size >= max) {
    const oldest = pending.values().next().value;
    if (oldest !== undefined) pending.delete(oldest);
  }
  pending.add(id);
}

/**
 * 从 `textDocument/completion` 响应里抽出「是否携带 additionalTextEdits」的事实。
 *
 * 存在的理由：「接受补全后 import 不落」有两个互斥的分叉——服务器没给附加编辑，
 * 或客户端应用层丢掉了。此摘要把两分叉变成日志里的一行数字（配合
 * `lspCompletionInfoRenderer` 的结果探针）。响应可能是数组或 `{items}`；
 * 任何异常载荷一律退化为空摘要——**探针绝不能炸掉补全链路**。
 */
export function summarizeCompletionDiagnostics(result: unknown): CompletionDiagnostics {
  const raw = Array.isArray(result)
    ? result
    : result && typeof result === 'object' && Array.isArray((result as { items?: unknown }).items)
      ? (result as { items: unknown[] }).items
      : [];

  const items = raw.filter((i): i is Record<string, unknown> => !!i && typeof i === 'object');
  const withEdits = items.filter(
    (i) => Array.isArray(i.additionalTextEdits) && i.additionalTextEdits.length > 0,
  );

  const importCandidates = items
    .filter((i) => !PATH_KEYWORDS.has(String(i.label ?? '')))
    .flatMap((i) => {
      const modulePath = modulePathOf(i);
      if (!modulePath) return [];
      return [
        {
          label: typeof i.label === 'string' ? i.label : '(no label)',
          modulePath,
          edits: Array.isArray(i.additionalTextEdits) ? i.additionalTextEdits.length : 0,
          hasData: i.data != null,
        },
      ];
    })
    .slice(0, MAX_SAMPLES);

  return {
    total: items.length,
    withAdditionalEdits: withEdits.length,
    importCandidates,
    samples: withEdits.slice(0, MAX_SAMPLES).map((i) => ({
      label: typeof i.label === 'string' ? i.label : '(no label)',
      edits: (i.additionalTextEdits as unknown[]).length,
      insertTextFormat: typeof i.insertTextFormat === 'number' ? i.insertTextFormat : undefined,
    })),
  };
}

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
    listen<{ uri: string; diagnostics: unknown[] }>(diagEventName, (event) => {
      this.handlers.forEach((h) =>
        h(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'textDocument/publishDiagnostics',
            params: event.payload,
          }),
        ),
      );
    }).then((unlisten) => {
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
