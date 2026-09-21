import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TauriLspTransport } from '../tauriLspTransport';

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
 * 自动导包 DEV 探针（集成侧）：确认「响应侧摘要」真的接上了，并钉住 id 集合的有界性
 * （未回包的请求不得让集合无界增长 —— 常驻应用内存卫生）。
 * 纯函数摘要的用例住 `lspCompletionProbe.test.ts`（随 `lspCompletionProbe.ts` 搬移）。
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
      expect(info).toHaveBeenCalledWith(
        expect.stringContaining('with-additionalTextEdits=0'),
        [],
        expect.anything(),
      );
    });

    info.mockRestore();
  });
});

describe('TauriLspTransport — 诊断推送必须带 version', () => {
  beforeEach(() => {
    for (const key of Object.keys(listenHandlers)) delete listenHandlers[key];
    vi.clearAllMocks();
  });

  /// lsp-client 的版本门是 `params.version != file.version 即丢弃`：诊断坐标属于哪一版
  /// 文本全靠它。后端事件里带 version 时必须原样透传，否则旧版本的诊断会被按当前文本
  /// 套用（波浪线整体偏移，2026-09-21 实测）。
  it('后端事件里的 version 进入 publishDiagnostics 通知', async () => {
    const transport = new TauriLspTransport('/proj', 'rust');
    const received: string[] = [];
    transport.subscribe((message) => received.push(message));
    await Promise.resolve();

    listenHandlers['lsp-diagnostics-/proj']?.({
      payload: { uri: 'file:///proj/src/main.rs', diagnostics: [], version: 14 },
    });

    const params = (JSON.parse(received[0]) as { params: { version?: number } }).params;
    expect(params.version).toBe(14);
  });

  /// 服务器没声明版本（`null` / 缺字段）时不得写进 `null`：lsp-client 对显式 `null` 与
  /// 缺失同样不拦截，但显式 `null` 会让载荷含义含糊（协议里 version 是可选 number）。
  it('version 缺失/为 null 时不产出该字段', async () => {
    const transport = new TauriLspTransport('/proj', 'rust');
    const received: string[] = [];
    transport.subscribe((message) => received.push(message));
    await Promise.resolve();

    listenHandlers['lsp-diagnostics-/proj']?.({
      payload: { uri: 'file:///proj/src/main.rs', diagnostics: [], version: null },
    });

    const params = JSON.parse(received[0]).params as Record<string, unknown>;
    expect('version' in params).toBe(false);
    expect(params.uri).toBe('file:///proj/src/main.rs');
  });
});

describe('TauriLspTransport — 销毁后不得再写服务器', () => {
  beforeEach(() => {
    for (const key of Object.keys(listenHandlers)) delete listenHandlers[key];
    vi.clearAllMocks();
  });

  /// destroy() 只清订阅；若不设闸，被插件僵尸 client 仍可把 didOpen/didChange
  /// 写进后端**仍活着**的会话（会话按 project+language 复用），用自己那套版本号
  /// 覆盖真实文档状态 → 服务器报 duplicate DidOpenTextDocument 后停止分析。
  it('destroy 之后的 send 一律丢弃（不触发 IPC）', async () => {
    const transport = new TauriLspTransport('/proj', 'rust');
    await Promise.resolve();

    transport.send(
      JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/didChange', params: {} }),
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);

    transport.destroy();
    transport.send(
      JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/didChange', params: {} }),
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
