import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSessions = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock('@/features/lsp/store/lspStore', () => ({
  useLspStore: { getState: () => ({ sessions: mockSessions.value }) },
}));

import { isLspLanguageReady } from '../lspReadiness';

beforeEach(() => {
  mockSessions.value = {};
});

describe('isLspLanguageReady（LSP 会话就绪的唯一事实源）', () => {
  it('仅 status === "ready" 视为就绪，其余状态一律不就绪', () => {
    const busy = ['starting', 'initializing', 'indexing', 'error', 'stopped'];
    const results = busy.map((status) => {
      mockSessions.value = { '/proj': { java: { status } } };
      return [status, isLspLanguageReady('/proj', 'java')];
    });
    expect(results).toEqual([
      ['starting', false],
      ['initializing', false],
      ['indexing', false],
      ['error', false],
      ['stopped', false],
    ]);

    mockSessions.value = { '/proj': { java: { status: 'ready' } } };
    expect(isLspLanguageReady('/proj', 'java')).toBe(true);
  });

  it('按语言隔离：其它语言 ready 不代表本语言就绪', () => {
    mockSessions.value = { '/proj': { rust: { status: 'ready' } } };
    expect(isLspLanguageReady('/proj', 'java')).toBe(false);
    expect(isLspLanguageReady('/proj', 'rust')).toBe(true);
  });

  it('未知项目 / 缺字段 → 不就绪且不抛错', () => {
    expect(isLspLanguageReady('/never-opened', 'java')).toBe(false);
    mockSessions.value = { '/proj': {} };
    expect(isLspLanguageReady('/proj', 'java')).toBe(false);
    mockSessions.value = { '/proj': { java: {} } };
    expect(isLspLanguageReady('/proj', 'java')).toBe(false);
    mockSessions.value = { '/proj': { java: { status: 'ready', languageId: 'java' } } };
    expect(isLspLanguageReady('/proj', 'java')).toBe(true);
  });
});
