import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLspRequest = vi.hoisted(() => vi.fn());
const mockSessions = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock('../../io', () => ({ langIo: { lspRequest: mockLspRequest } }));
vi.mock('@/features/lsp/store/lspStore', () => ({
  useLspStore: { getState: () => ({ sessions: mockSessions.value }) },
}));

import {
  clearRunnableCache,
  fetchRunnablesForLines,
  isRustAnalyzerReady,
  MAX_CACHE_ENTRIES,
} from '../overlayProvider';

/** 真机实测载荷（同 runnable.test.ts 夹具）。 */
const specific = (testPath: string): unknown[] => [
  {
    label: `cargo test -p api --bin stock-buddy -- ${testPath} --exact`,
    kind: 'cargo',
    args: {
      cwd: '/proj/crates/api',
      cargoArgs: ['test', '--package', 'api', '--bin', 'stock-buddy'],
      executableArgs: [testPath, '--exact'],
    },
  },
  { label: 'cargo check -p api', kind: 'cargo', args: { cwd: '/proj', cargoArgs: ['check'] } },
];

const args = (targets: { line: number; kind: 'test' | 'main' }[]) => ({
  projectId: 'p1',
  projectPath: '/proj',
  absFilePath: '/proj/crates/api/src/routes/sentiment.rs',
  targets,
});

beforeEach(() => {
  clearRunnableCache();
  mockLspRequest.mockReset();
  mockSessions.value = {};
});

describe('isRustAnalyzerReady', () => {
  it('仅 status==="ready" 视为就绪（starting/indexing/error 均不就绪）', () => {
    const busy = ['starting', 'initializing', 'indexing', 'error', 'stopped'].map((status) => {
      mockSessions.value = { '/proj': { rust: { status } } };
      return [status, isRustAnalyzerReady('/proj')];
    });
    expect(busy).toEqual([
      ['starting', false],
      ['initializing', false],
      ['indexing', false],
      ['error', false],
      ['stopped', false],
    ]);
    mockSessions.value = { '/proj': { rust: { status: 'ready' } } };
    expect(isRustAnalyzerReady('/proj')).toBe(true);
    // 其它语言 ready 不算数
    mockSessions.value = { '/proj': { go: { status: 'ready' } } };
    expect(isRustAnalyzerReady('/proj')).toBe(false);
  });
});

describe('fetchRunnablesForLines', () => {
  it('RA 未就绪 → 不发请求、返回空（静默回退快路径）', async () => {
    mockSessions.value = { '/proj': { rust: { status: 'indexing' } } };
    const out = await fetchRunnablesForLines(args([{ line: 1260, kind: 'test' }]));
    expect(out.size).toBe(0);
    expect(mockLspRequest).not.toHaveBeenCalled();
  });

  it('逐目标行请求（position 为 0-based）并按目标类型选择具体 runnable', async () => {
    mockSessions.value = { '/proj': { rust: { status: 'ready' } } };
    mockLspRequest.mockImplementation(
      (_p: string, _l: string, _m: string, params: { position: { line: number } }) =>
        Promise.resolve(specific(`tests::case_${params.position.line}`)),
    );
    const out = await fetchRunnablesForLines(
      args([
        { line: 1260, kind: 'test' },
        { line: 1300, kind: 'test' },
      ]),
    );
    expect([...out.keys()].sort((a, b) => a - b)).toEqual([1260, 1300]);
    expect(out.get(1260)?.args.executableArgs?.[0]).toBe('tests::case_1259');
    expect(mockLspRequest).toHaveBeenCalledWith('/proj', 'rust', 'experimental/runnables', {
      textDocument: { uri: 'file:///proj/crates/api/src/routes/sentiment.rs' },
      position: { line: 1259, character: 0 },
    });
  });

  it('单行失败不影响其它行（异常吞掉，不抛到渲染路径）', async () => {
    mockSessions.value = { '/proj': { rust: { status: 'ready' } } };
    mockLspRequest
      .mockRejectedValueOnce(new Error('lsp down'))
      .mockResolvedValueOnce(specific('tests::ok'));
    const out = await fetchRunnablesForLines(
      args([
        { line: 10, kind: 'test' },
        { line: 20, kind: 'test' },
      ]),
    );
    expect(out.size).toBe(1);
    expect(out.has(20)).toBe(true);
  });

  it('无命中（只有 check 之类）→ 空结果，不缓存', async () => {
    mockSessions.value = { '/proj': { rust: { status: 'ready' } } };
    mockLspRequest.mockResolvedValue([
      { label: 'cargo check -p api', kind: 'cargo', args: { cwd: '/proj', cargoArgs: ['check'] } },
    ]);
    const out = await fetchRunnablesForLines(args([{ line: 5, kind: 'test' }]));
    expect(out.size).toBe(0);
  });

  it('命中后缓存：同参数第二次调用不再往返', async () => {
    mockSessions.value = { '/proj': { rust: { status: 'ready' } } };
    mockLspRequest.mockResolvedValue(specific('tests::cached'));
    const first = await fetchRunnablesForLines(args([{ line: 7, kind: 'test' }]));
    expect(first.size).toBe(1);
    expect(mockLspRequest).toHaveBeenCalledTimes(1);
    const second = await fetchRunnablesForLines(args([{ line: 7, kind: 'test' }]));
    expect(second.size).toBe(1);
    expect(mockLspRequest).toHaveBeenCalledTimes(1);
    // 目标集合变化 → 换 key，重新请求
    await fetchRunnablesForLines(args([{ line: 8, kind: 'test' }]));
    expect(mockLspRequest).toHaveBeenCalledTimes(2);
  });

  it('空目标集合 → 零请求', async () => {
    mockSessions.value = { '/proj': { rust: { status: 'ready' } } };
    const out = await fetchRunnablesForLines(args([]));
    expect(out.size).toBe(0);
    expect(mockLspRequest).not.toHaveBeenCalled();
  });
});

/**
 * 缓存上限（P6 常驻内存）：键含「目标行集合」，每次增删用例/入口都会换 key ——
 * 无上限时旧条目永不再命中却永久滞留，随编辑次数单调增长。
 */
describe('fetchRunnablesForLines — 缓存上限与 LRU', () => {
  /** 用「是否再次往返 LSP」观测缓存命中（无需暴露测试专用 API）。 */
  const fetchOnce = (line: number) => fetchRunnablesForLines(args([{ line, kind: 'test' }]));

  beforeEach(() => {
    mockSessions.value = { '/proj': { rust: { status: 'ready' } } };
    mockLspRequest.mockResolvedValue(specific('tests::x'));
  });

  it('超出上限 → 淘汰最旧条目（不再单调增长）', async () => {
    for (let line = 1; line <= MAX_CACHE_ENTRIES + 1; line++) await fetchOnce(line);
    const afterFill = mockLspRequest.mock.calls.length;
    expect(afterFill).toBe(MAX_CACHE_ENTRIES + 1);

    // 最早那条已被淘汰 → 重新往返（若缓存无上限，此处命中、次数不变）
    await fetchOnce(1);
    expect(mockLspRequest.mock.calls.length).toBe(afterFill + 1);

    // 最新那条仍在缓存
    const beforeRecent = mockLspRequest.mock.calls.length;
    await fetchOnce(MAX_CACHE_ENTRIES + 1);
    expect(mockLspRequest.mock.calls.length).toBe(beforeRecent);
  });

  it('命中会刷新 LRU 位置：被再次使用的条目不被优先淘汰', async () => {
    await fetchOnce(1); // 最旧
    for (let line = 2; line <= MAX_CACHE_ENTRIES; line++) await fetchOnce(line);

    await fetchOnce(1); // 命中 → 变为最新
    const before = mockLspRequest.mock.calls.length;

    await fetchOnce(MAX_CACHE_ENTRIES + 1); // 溢出：应淘汰 line 2，而非 line 1
    await fetchOnce(1); // 仍应命中（无新往返）
    expect(mockLspRequest.mock.calls.length).toBe(before + 1);
  });
});
