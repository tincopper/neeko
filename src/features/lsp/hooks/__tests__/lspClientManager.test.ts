import { EditorState } from '@codemirror/state';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 共享 client / transport 需要活体运行时：mock 掉，只验证"回调按视图注入"这一契约。
vi.mock('@codemirror/lsp-client', () => ({
  LSPClient: class {
    serverCapabilities = {};
    connect(): void {}
    request(): Promise<null> {
      return Promise.resolve(null);
    }
    plugin(): [] {
      return [];
    }
  },
  serverDiagnostics: () => [],
  signatureHelp: () => [],
}));
vi.mock('../transport/tauriLspTransport', () => ({
  TauriLspTransport: class {
    destroy(): void {}
  },
}));

import {
  acquireLspPlugin,
  lspClientTimeout,
  lspMethodLabel,
  lspRequestTimeoutMessage,
  releaseLspClient,
} from '../lspClientManager';
import { jdtLinkHandlerFacet, withJdtLinkHandler } from '../lspHoverExtension';

describe('lspClientTimeout', () => {
  it('java 大超时（jdtls JVM 冷启动慢），其余 15s', () => {
    expect(lspClientTimeout('java')).toBe(120_000);
    expect(lspClientTimeout('rust')).toBe(15_000);
    expect(lspClientTimeout('typescript')).toBe(15_000);
  });
});

describe('lspMethodLabel', () => {
  it('映射常见 LSP 方法到友好功能名（英文）', () => {
    expect(lspMethodLabel('textDocument/hover')).toBe('Hover');
    expect(lspMethodLabel('textDocument/definition')).toBe('Go to Definition');
    expect(lspMethodLabel('textDocument/references')).toBe('Find References');
    expect(lspMethodLabel('textDocument/completion')).toBe('Code Completion');
  });

  it('未命中回退原始方法名', () => {
    expect(lspMethodLabel('textDocument/unknownThing')).toBe('textDocument/unknownThing');
  });
});

describe('lspRequestTimeoutMessage', () => {
  it('裸 "Request timed out" 附上功能名', () => {
    expect(
      lspRequestTimeoutMessage('textDocument/definition', new Error('Request timed out')),
    ).toBe('LSP request timed out (Go to Definition)');
  });

  it('非超时错误原样放行（返回 null）', () => {
    expect(
      lspRequestTimeoutMessage('textDocument/definition', new Error('server crashed')),
    ).toBeNull();
    expect(lspRequestTimeoutMessage('textDocument/definition', 'not an error')).toBeNull();
    expect(lspRequestTimeoutMessage('textDocument/definition', null)).toBeNull();
  });
});

describe('withJdtLinkHandler — jdt 链接回调按视图注入（共享 client 不持有宿主闭包）', () => {
  const HANDLER_A = (): void => {};
  const HANDLER_B = (): void => {};

  afterEach(() => {
    // 归还全部引用（'/p' 在两个用例里各 acquire 过一次），避免 idle 销毁定时器挂住测试进程。
    releaseLspClient('/p', 'java');
    releaseLspClient('/p', 'java');
    releaseLspClient('/p2', 'java');
    releaseLspClient('/p2', 'java');
  });

  it('同一 project+language 的两个文件各拿到自己的回调（不再"首建捕获"）', () => {
    // 回归：曾把回调挂在共享 client 上（pool 工厂只跑一次）→ 只有首个 tab 的回调
    // 生效，其余 tab 的 hover 会带着首个 tab 的 projectId/filePath 跳转。
    const pluginA = acquireLspPlugin('/p', 'java', 'file:///p/A.java');
    const pluginB = acquireLspPlugin('/p', 'java', 'file:///p/B.java');
    const stateA = EditorState.create({ extensions: withJdtLinkHandler(pluginA, HANDLER_A) });
    const stateB = EditorState.create({ extensions: withJdtLinkHandler(pluginB, HANDLER_B) });

    expect(stateA.facet(jdtLinkHandlerFacet)).toBe(HANDLER_A);
    expect(stateB.facet(jdtLinkHandlerFacet)).toBe(HANDLER_B);
  });

  it('未传回调 → facet 为空（调用方按缺失处理，不误跳）', () => {
    const plugin = acquireLspPlugin('/p2', 'java', 'file:///p2/C.java');
    const state = EditorState.create({ extensions: withJdtLinkHandler(plugin) });

    expect(state.facet(jdtLinkHandlerFacet)).toBeUndefined();
  });

  it('client 池不接受宿主回调（编译期无入口 → 不存在"首个 tab 独占"通道）', () => {
    // 契约锚点：acquireLspPlugin 签名不含任何回调参数；这里断言其返回值就是
    // client 自身的插件（mock 为 []），宿主扩展一律由视图侧组装。
    expect(acquireLspPlugin('/p2', 'java', 'file:///p2/C.java')).toEqual([]);
  });
});
