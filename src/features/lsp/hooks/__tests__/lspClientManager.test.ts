import { setDiagnostics } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 共享 client / transport 需要活体运行时：mock 掉，只验证"回调按视图注入"这一契约。
const { MockLSPClient } = vi.hoisted(() => {
  class MockLSPClient {
    /** 捕获装配传入的扩展（供「linter 波浪线渲染器在位」行为测试使用）。 */
    static lastExtensions: unknown[] = [];
    /** workspace 存根：重挂容忍补丁会包装其 openFile。 */
    workspace = {
      getFile: () => null,
      closeFile: () => {},
      openFile: () => {},
    };
    serverCapabilities = {};
    constructor(options: { extensions?: unknown[] } = {}) {
      MockLSPClient.lastExtensions = options.extensions ?? [];
    }
    connect(): void {}
    request(): Promise<null> {
      return Promise.resolve(null);
    }
    plugin(): [] {
      return [];
    }
  }
  return { MockLSPClient };
});
vi.mock('@codemirror/lsp-client', () => ({
  LSPClient: MockLSPClient,
  serverDiagnostics: () => [],
  signatureHelp: () => [],
}));
vi.mock('../transport/tauriLspTransport', () => ({
  TauriLspTransport: class {
    destroy(): void {}
  },
}));

import { applyBackendExtensionMap, getLspLanguageId } from '@/features/lsp/api/languageMap';

import {
  DEFAULT_LSP_REQUEST_TIMEOUT_MS,
  acquireLspPlugin,
  lspClientTimeout,
  lspMethodLabel,
  lspRequestTimeoutMessage,
  makeWorkspaceTolerantToRemount,
  releaseLspClient,
} from '../lspClientManager';
import { jdtLinkHandlerFacet, withJdtLinkHandler } from '../lspHoverExtension';

describe('lspClientTimeout', () => {
  afterEach(() => {
    applyBackendExtensionMap([]);
  });

  it('未声明的服务器走通用默认', () => {
    expect(lspClientTimeout('rust')).toBe(DEFAULT_LSP_REQUEST_TIMEOUT_MS);
    expect(lspClientTimeout('go')).toBe(DEFAULT_LSP_REQUEST_TIMEOUT_MS);
  });

  /// 红线 15 的消费侧护栏：**任意**插件在后端声明超时即生效 —— 前端没有语言列表。
  /// 用虚构语言（而非 java）断言，任何"照 languageId 抄一个分支"的实现都会挂。
  it('插件声明的超时对任意 languageId 生效（非按语言硬编码）', () => {
    applyBackendExtensionMap([
      {
        extension: 'ml',
        languageId: 'mylang',
        serverName: 'mls',
        isCustom: true,
        requestTimeoutMs: 42_000,
      },
    ]);
    expect(lspClientTimeout('mylang')).toBe(42_000);
  });

  it('同一次 apply 是整体替换（旧声明不残留）', () => {
    applyBackendExtensionMap([
      {
        extension: 'ml',
        languageId: 'mylang',
        serverName: 'mls',
        isCustom: true,
        requestTimeoutMs: 42_000,
      },
    ]);
    applyBackendExtensionMap([]);
    expect(lspClientTimeout('mylang')).toBe(DEFAULT_LSP_REQUEST_TIMEOUT_MS);
  });

  /// 同一份后端 extension map 既驱动语言解析、又驱动超时 —— 单一数据源，不漂移。
  it('同一份后端 map 同时服务于语言解析与超时', () => {
    applyBackendExtensionMap([
      {
        extension: 'ml',
        languageId: 'mylang',
        serverName: 'mls',
        isCustom: true,
        requestTimeoutMs: 9_000,
      },
    ]);
    expect(getLspLanguageId('a.ml')).toBe('mylang');
    expect(lspClientTimeout('mylang')).toBe(9_000);
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

describe('makeWorkspaceTolerantToRemount — 同 uri 重挂竞态容忍', () => {
  function makeFakeWorkspace() {
    return {
      getFile: vi.fn(),
      closeFile: vi.fn(),
      openFile: vi.fn(),
    };
  }

  it('同 uri 旧条目仍在 → 先摘旧（closeFile）再登记（openFile）', () => {
    const fake = makeFakeWorkspace();
    // 模拟 HMR 竞态：旧视图条目仍被 workspace 持有
    fake.getFile.mockReturnValueOnce({ uri: 'file:///p/main.go' });
    const originalOpenFile = fake.openFile; // 补丁会用包装器替换属性，先捕获原 spy
    makeWorkspaceTolerantToRemount(fake);

    fake.openFile('file:///p/main.go', 'go', {} as never);

    expect(fake.closeFile).toHaveBeenCalledWith('file:///p/main.go', {});
    expect(originalOpenFile).toHaveBeenCalledWith('file:///p/main.go', 'go', {});
  });

  it('全新 uri → 直接登记（无多余 didClose）', () => {
    const fake = makeFakeWorkspace();
    fake.getFile.mockReturnValue(null);
    const originalOpenFile = fake.openFile;
    makeWorkspaceTolerantToRemount(fake);

    fake.openFile('file:///p/other.go', 'go', {} as never);

    expect(fake.closeFile).not.toHaveBeenCalled();
    expect(originalOpenFile).toHaveBeenCalledWith('file:///p/other.go', 'go', {});
  });
});

describe('诊断渲染链 — 推送诊断在编辑器装配下渲染波浪线', () => {
  afterEach(() => {
    releaseLspClient('/pl', 'go');
  });

  it('setDiagnostics 产生 cm-lintRange-error 装饰（自组装：无 linter 挂载亦渲染）', () => {
    // 验证渲染链自组装：编辑器装配（无 linter）下，首次 setDiagnostics 经
    // maybeEnableLint 自动追加 lint 渲染扩展（lintState.provide 提供 wavy
    // decorations + hover tooltip）。**真实场景中波浪线缺失 = 诊断未到达视图**
    // （LS 会话未运行 / uri-version 不匹配被 serverDiagnostics 丢弃），
    // 而非渲染器缺失——归因见任务 design.md 勘误。
    // 注意：零长度文档下 0..3 诊断走 widget 路径而非 mark 波浪线，故 doc 必须有内容。
    acquireLspPlugin('/pl', 'go', 'file:///pl/main.go');
    const parent = document.createElement('div');
    const view = new EditorView({
      state: EditorState.create({
        doc: 'const value = fmt.Println(1);',
        extensions: MockLSPClient.lastExtensions as never,
      }),
      parent,
    });

    view.dispatch(
      setDiagnostics(view.state, [
        { from: 0, to: 3, severity: 'error', message: 'undefined: fmt' },
      ]),
    );

    expect(view.dom.querySelector('.cm-lintRange-error')).not.toBeNull();
    view.destroy();
  });
});
