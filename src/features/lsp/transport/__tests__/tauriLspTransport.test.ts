import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  rememberPendingCompletionId,
  summarizeCompletionDiagnostics,
  TauriLspTransport,
} from '../tauriLspTransport';

// 该模块被 vi.mock 替换；这里取回 mock 实例，供探针用例注入 completion 响应。

// 捕获 Tauri listen 注册的 (eventName, handler)，供测试触发服务端推送。
const listenHandlers: Record<string, (event: { payload: unknown }) => void> = {};

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((eventName: string, handler: (event: { payload: unknown }) => void) => {
    listenHandlers[eventName] = handler;
    return Promise.resolve(() => {
      delete listenHandlers[eventName];
    });
  }),
}));

// 工厂会被提升：mock 实例必须用 `vi.hoisted()` 创建，测试体再注入一次性响应。
// （不直接 import `@tauri-apps/api/core` —— 仓库 eslint 禁止绕过特性 API 封装。）
const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(() => Promise.resolve('{}')),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

vi.mock('@/shared/utils/safeUnlisten', () => ({
  safeUnlisten: (fn: () => void) => fn(),
}));

vi.mock('@/shared/store/notificationStore', () => ({
  useNotificationStore: { getState: () => ({ addNotification: vi.fn() }) },
}));

describe('TauriLspTransport — 服务端推送必须补全 JSON-RPC 信封', () => {
  beforeEach(() => {
    for (const key of Object.keys(listenHandlers)) delete listenHandlers[key];
    vi.clearAllMocks();
  });

  it('diagnostics 推送被包装为 textDocument/publishDiagnostics 通知', async () => {
    const transport = new TauriLspTransport('/proj', 'go');
    const received: string[] = [];
    transport.subscribe((message) => received.push(message));
    await Promise.resolve(); // listen 注册是异步的

    listenHandlers['lsp-diagnostics-/proj']?.({
      payload: {
        uri: 'file:///proj/cmd/agent/main_test.go',
        diagnostics: [
          {
            range: { start: { line: 55, character: 12 }, end: { line: 55, character: 15 } },
            severity: 1,
            message: 'undefined: fmt',
            source: 'compiler',
            code: 'UndeclaredName',
          },
        ],
      },
    });

    expect(received).toHaveLength(1);
    const message = JSON.parse(received[0]);
    expect(message.jsonrpc).toBe('2.0');
    expect(message.method).toBe('textDocument/publishDiagnostics');
    expect(message.params.uri).toBe('file:///proj/cmd/agent/main_test.go');
    expect(message.params.diagnostics[0].code).toBe('UndeclaredName');
  });

  it('progress 推送被包装为 $/progress 通知', async () => {
    const transport = new TauriLspTransport('/proj', 'go');
    const received: string[] = [];
    transport.subscribe((message) => received.push(message));
    await Promise.resolve();

    listenHandlers['lsp-progress-/proj']?.({
      payload: { token: 't1', value: { kind: 'begin', title: 'indexing' } },
    });

    expect(received).toHaveLength(1);
    const message = JSON.parse(received[0]);
    expect(message.method).toBe('$/progress');
    expect(message.params.token).toBe('t1');
    expect(message.params.value.kind).toBe('begin');
  });

  it('推送事件名与 projectPath 精确拼接（跨项目不串）', async () => {
    const transport = new TauriLspTransport('/other', 'go');
    transport.subscribe(() => {});
    await Promise.resolve();

    expect(listenHandlers['lsp-diagnostics-/other']).toBeDefined();
    expect(listenHandlers['lsp-diagnostics-/proj']).toBeUndefined();
  });
});

/**
 * 自动导包探针的响应摘要（纯函数）：「接受补全后 import 不落」时，
 * 需要一眼区分「服务端没给 additionalTextEdits」与「客户端应用层丢了」。
 */
describe('summarizeCompletionDiagnostics', () => {
  it('数组形态（CompletionItem[]）统计附加编辑并取样本', () => {
    const items = [
      { label: 'Println', insertTextFormat: 2, additionalTextEdits: [{ newText: 'import "fmt"' }] },
      { label: 'Printf' },
    ];
    const summary = summarizeCompletionDiagnostics(items);
    expect(summary.total).toBe(2);
    expect(summary.withAdditionalEdits).toBe(1);
    expect(summary.samples).toEqual([{ label: 'Println', edits: 1, insertTextFormat: 2 }]);
  });

  it('对象形态（{ items }）等价处理', () => {
    const summary = summarizeCompletionDiagnostics({
      items: [{ label: 'a', additionalTextEdits: [{}, {}] }],
    });
    expect(summary.total).toBe(1);
    expect(summary.withAdditionalEdits).toBe(1);
    expect(summary.samples[0]).toEqual({ label: 'a', edits: 2, insertTextFormat: undefined });
  });

  it('异常 / 空载荷 → 全零且不抛错（不得因探针本身炸掉补全链路）', () => {
    for (const payload of [null, undefined, {}, { items: 'nope' }, 'nope', 42]) {
      const summary = summarizeCompletionDiagnostics(payload);
      expect(summary.total).toBe(0);
      expect(summary.withAdditionalEdits).toBe(0);
      expect(summary.samples).toEqual([]);
    }
  });

  it('空 additionalTextEdits 数组不算「有附加编辑」', () => {
    const summary = summarizeCompletionDiagnostics({
      items: [{ label: 'a', additionalTextEdits: [] }],
    });
    expect(summary.withAdditionalEdits).toBe(0);
  });
});

/**
 * 自动导包 DEV 探针：确认「响应侧摘要」真的接上了，并钉住 id 集合的有界性
 * （未回包的请求不得让集合无界增长 —— 常驻应用内存卫生）。
 */
describe('completion 探针（DEV）', () => {
  it('匹配到 completion 响应时打印 additionalTextEdits 摘要', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    invokeMock.mockResolvedValueOnce(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 11,
        result: [{ label: 'Println', additionalTextEdits: [{ newText: 'import "fmt"' }] }],
      }),
    );

    const transport = new TauriLspTransport('/proj', 'go');
    transport.send(
      JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'textDocument/completion', params: {} }),
    );
    await vi.waitFor(() => {
      expect(info).toHaveBeenCalledWith(
        expect.stringContaining('with-additionalTextEdits=1'),
        expect.anything(),
      );
    });
    info.mockRestore();
  });

  it('超过上限后淘汰最旧 id：最新请求仍可被摘要（集合有界）', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const transport = new TauriLspTransport('/proj', 'go');

    // 65 个未回包请求（上限 64）→ 最旧的 id=1 被淘汰
    for (let id = 1; id <= 65; id++) {
      transport.send(
        JSON.stringify({ jsonrpc: '2.0', id, method: 'textDocument/completion', params: {} }),
      );
    }

    // 最新 id（65）仍被摘要
    invokeMock.mockResolvedValueOnce(JSON.stringify({ jsonrpc: '2.0', id: 65, result: [] }));
    transport.send(
      JSON.stringify({ jsonrpc: '2.0', id: 65, method: 'textDocument/completion', params: {} }),
    );
    await vi.waitFor(() => {
      expect(info).toHaveBeenCalledWith(expect.stringContaining('with-additionalTextEdits=0'), []);
    });

    info.mockRestore();
  });

  it('id 集合有界且保新：超限淘汰最旧（纯函数不变量）', () => {
    const pending = new Set<number>();
    for (let id = 1; id <= 65; id++) {
      rememberPendingCompletionId(pending, id, 64);
    }
    expect(pending.size).toBe(64);
    expect(pending.has(1)).toBe(false); // 最旧被淘汰
    expect(pending.has(65)).toBe(true); // 最新保留

    // 响应会把 id 移出集合（配合 clear 形成"只留在途"的不变量）
    const single = new Set<number>();
    rememberPendingCompletionId(single, 7);
    expect([...single]).toEqual([7]);
  });
});
