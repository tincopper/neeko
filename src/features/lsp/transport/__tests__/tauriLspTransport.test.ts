import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve('{}')),
}));

vi.mock('@/shared/utils/safeUnlisten', () => ({
  safeUnlisten: (fn: () => void) => fn(),
}));

vi.mock('@/shared/store/notificationStore', () => ({
  useNotificationStore: { getState: () => ({ addNotification: vi.fn() }) },
}));

import { TauriLspTransport } from '../tauriLspTransport';

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
