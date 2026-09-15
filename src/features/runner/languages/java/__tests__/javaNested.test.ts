import { beforeEach, describe, expect, it, vi } from 'vitest';

// runner/java.ts 的其它依赖（launcher 供给 / 通知 / debug 面板）与本用例无关，按仓库惯例隔离。
vi.mock('@tauri-apps/api/path', () => ({ homeDir: vi.fn(async () => '/home/tester') }));
vi.mock('@/features/runner/api/debugBuildApi', () => ({ buildTestBinaryRemote: vi.fn() }));
vi.mock('@/features/runner/store/debugStore', () => ({ useDebugStore: { getState: () => ({}) } }));
vi.mock('@/features/file/api/fileApi', () => ({
  fileExists: vi.fn(async () => false),
  readFileContent: vi.fn(async () => ({ content: '' })),
}));
vi.mock('@/shared/store/notificationStore', () => ({
  useNotificationStore: { getState: () => ({ addNotification: vi.fn() }) },
}));

const mockLspRequest = vi.hoisted(() => vi.fn());
const mockReady = vi.hoisted(() => vi.fn(() => true));
vi.mock('@/features/lsp/api/lspApi', () => ({ lspRequest: mockLspRequest }));
vi.mock('../../../utils/lspReadiness', () => ({ isLspLanguageReady: mockReady }));

import { langIo } from '../../io';
import { withJavaNestedClassPath } from '../symbols';

const ctx = {
  projectId: 'p1',
  filePath: 'src/test/java/com/example/AppTest.java',
  projectPath: '/proj',
};

/** 真机捕获的扁平 documentSymbol 载荷（同 javaDocumentSymbol.test 夹具，见 design §7.7.3.1）。 */
const flatSymbols = (): unknown[] => [
  {
    name: 'testTop()',
    kind: 6,
    location: { range: { start: { line: 7 } } },
    containerName: 'AppTest',
  },
  {
    name: 'testNested()',
    kind: 6,
    location: { range: { start: { line: 12 } } },
    containerName: 'InnerCases',
  },
  {
    name: 'InnerCases',
    kind: 5,
    location: { range: { start: { line: 10 } } },
    containerName: 'AppTest',
  },
  {
    name: 'AppTest',
    kind: 5,
    location: { range: { start: { line: 5 } } },
    containerName: 'AppTest.java',
  },
];

beforeEach(() => {
  mockLspRequest.mockReset();
  mockReady.mockReset().mockReturnValue(true);
});

describe('withJavaNestedClassPath（@Nested 内层类富化）', () => {
  it('命中嵌套方法 → 附加 containerPath；uri 走 canonical 助手', async () => {
    mockLspRequest.mockResolvedValue(flatSymbols());
    const testCase = { name: 'testNested', line: 12, lang: 'java' as const };

    const enriched = await withJavaNestedClassPath(ctx, testCase, langIo);

    expect(enriched).toEqual({ ...testCase, containerPath: ['InnerCases'] });
    expect(mockLspRequest).toHaveBeenCalledWith('/proj', 'java', 'textDocument/documentSymbol', {
      textDocument: { uri: 'file:///proj/src/test/java/com/example/AppTest.java' },
    });
  });

  it('顶层方法 → 不附加字段（与历史形态一致）', async () => {
    mockLspRequest.mockResolvedValue(flatSymbols());
    const testCase = { name: 'testTop', line: 7, lang: 'java' as const };

    expect(await withJavaNestedClassPath(ctx, testCase, langIo)).toEqual(testCase);
  });

  it('java 会话未就绪 → 不发请求、原样返回（降级为现状表单）', async () => {
    mockReady.mockReturnValue(false);
    const testCase = { name: 'testNested', line: 12, lang: 'java' as const };

    expect(await withJavaNestedClassPath(ctx, testCase, langIo)).toEqual(testCase);
    expect(mockLspRequest).not.toHaveBeenCalled();
  });

  it('请求失败 → 原样返回且不抛错（最坏等于今天）', async () => {
    mockLspRequest.mockRejectedValue(new Error('lsp down'));
    const testCase = { name: 'testNested', line: 12, lang: 'java' as const };

    expect(await withJavaNestedClassPath(ctx, testCase, langIo)).toEqual(testCase);
  });

  it('载荷里找不到该方法 → 原样返回', async () => {
    mockLspRequest.mockResolvedValue([
      { name: 'other()', kind: 6, location: { range: { start: { line: 1 } } }, containerName: 'X' },
    ]);
    const testCase = { name: 'testNested', line: 12, lang: 'java' as const };

    expect(await withJavaNestedClassPath(ctx, testCase, langIo)).toEqual(testCase);
  });

  it('无项目根（projectPath 为 null）→ 不发请求、原样返回', async () => {
    const testCase = { name: 'testNested', line: 12, lang: 'java' as const };

    expect(await withJavaNestedClassPath({ ...ctx, projectPath: null }, testCase, langIo)).toEqual(
      testCase,
    );
    expect(mockLspRequest).not.toHaveBeenCalled();
  });
});
