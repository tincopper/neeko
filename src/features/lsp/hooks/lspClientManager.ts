import { LSPClient, serverDiagnostics, signatureHelp } from '@codemirror/lsp-client';
import type { Extension } from '@codemirror/state';

import { lspRequestTimeoutMs } from '../api/languageMap';
import { IdleRefCountedCache } from '../idleRefCountedCache';
import { TauriLspTransport } from '../transport/tauriLspTransport';

import { createThemedServerCompletion } from './lspCompletionInfoRenderer';
import { createLspHoverTooltips } from './lspHoverExtension';

interface LspClientBundle {
  client: LSPClient;
  transport: TauriLspTransport;
}

/** 重挂容忍补丁所需的 workspace 最小结构面（Workspace 基类的相关方法子集）。 */
interface PatchableWorkspace {
  getFile(uri: string): unknown;
  closeFile(uri: string, view: unknown): void;
  openFile(uri: string, languageId: string, view: unknown): void;
}

/**
 * 把默认 workspace 的 openFile 包成「摘旧再登记」。
 *
 * 为什么：DefaultWorkspace.openFile 对同 uri 二次登记直接 throw（默认实现不支持
 * 同文件多视图）。HMR 热更新 / 快速切 tab 的销毁-创建竞态会命中——新视图装配失败
 * （openFile 抛错，插件缺失），后续该 uri 的诊断推送全部被 client 丢弃，用户实测
 * 表现为「波浪线出现后消失且不恢复」。摘旧 = closeFile（对旧视图补发 didClose，
 * 符合 LSP 语义），再登记新视图，重挂自愈。
 */
export function makeWorkspaceTolerantToRemount(workspace: PatchableWorkspace): void {
  const originalOpenFile = workspace.openFile.bind(workspace);
  workspace.openFile = (uri: string, languageId: string, view: unknown) => {
    if (workspace.getFile(uri) != null) workspace.closeFile(uri, view);
    originalOpenFile(uri, languageId, view);
  };
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
 * 通用请求超时（ms）：秒级响应的服务器都够用。冷启动/全量索引远超此预算的服务器在
 * `LspPlugin.request_timeout_ms` 自行声明，经 extension map 下发到
 * `languageMap.lspRequestTimeoutMs` —— **本模块不得按 languageId 分支**（红线 15）。
 */
export const DEFAULT_LSP_REQUEST_TIMEOUT_MS = 15_000;

export function lspClientTimeout(languageId: string): number {
  return lspRequestTimeoutMs(languageId) ?? DEFAULT_LSP_REQUEST_TIMEOUT_MS;
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
 * **本函数不接收任何宿主回调/视图状态**：同 project+language 的多个 tab 共享同一
 * client，而工厂只在首建时执行一次 —— 任何 client 级捕获都会变成"首个 tab 独占"，
 * 让后续 tab 的 hover 用错上下文（历史教训：曾按"各宿主回调行为等价"假设忽略该
 * 差异，实际回调闭包持有 per-tab 的 projectId/filePath）。需要按视图注入的扩展由
 * 视图侧组装（见 `withJdtLinkHandler`）。
 */
export function acquireLspPlugin(
  projectPath: string,
  languageId: string,
  fileUri: string,
): Extension {
  const key = clientKey(projectPath, languageId);
  const bundle = pool.acquire(key, () => {
    // timeout：插件声明优先（重冷启动服务器经 extension map 下发），否则通用 15s。
    const client = new LSPClient({
      // 注意：波浪线渲染**无需**在此挂 @codemirror/lint 的 linter()——首次
      // setDiagnostics 会经 maybeEnableLint 自动追加渲染扩展（lintState.provide
      // 自带 wavy decorations + hover tooltip）。在此挂空 source 的 linter 反而
      // 会在 idle 轮询时用空数组清掉服务器推送的诊断（自毁）。
      extensions: [
        createThemedServerCompletion(),
        createLspHoverTooltips(),
        serverDiagnostics(),
        signatureHelp(),
      ],
      timeout: lspClientTimeout(languageId),
    });
    // HMR / 快速切 tab 的重挂竞态容忍：同 uri 旧条目未摘除时 openFile 会 throw，
    // 新视图装配失败 → 后续诊断推送全被丢（波浪线出现后消失且不恢复的根因）。
    makeWorkspaceTolerantToRemount(client.workspace);
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
