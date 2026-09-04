import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/terminalApi', () => ({
  closeTerminalSession: vi.fn().mockResolvedValue(undefined),
  resizeTerminal: vi.fn(),
}));

vi.mock('../../../agent/api/agentApi', () => ({
  getAgent: vi.fn().mockResolvedValue(null),
}));

import { findSessionIdForProject } from '../terminalCache';

type Cache = Map<string, { sessionId: string | null }>;

function cacheOf(entries: Array<[string, string | null]>): Cache {
  return new Map(entries.map(([key, sessionId]) => [key, { sessionId }]));
}

describe('findSessionIdForProject', () => {
  it('命中项目段返回会话', () => {
    const cache = cacheOf([['wsl:Ubuntu:proj1:tabA:p1', 's1']]);
    expect(findSessionIdForProject(cache, 'proj1', null, 'wsl:Ubuntu:')).toBe('s1');
  });

  it('子串不误判：proj 不匹配 proj-1 的 key', () => {
    const cache = cacheOf([['wsl:Ubuntu:proj-1:tabA:p1', 's1']]);
    expect(findSessionIdForProject(cache, 'proj', null, 'wsl:Ubuntu:')).toBeNull();
  });

  it('projectId 含冒号仍可命中（split 切分会永远 miss）', () => {
    const cache = cacheOf([['wsl:Ubuntu:a:b:tabA:p1', 's1']]);
    expect(findSessionIdForProject(cache, 'a:b', null, 'wsl:Ubuntu:')).toBe('s1');
  });

  it('tabId 含冒号时优先命中活动 tab（split 切分会掉到项目兜底）', () => {
    const cache = cacheOf([
      ['remote:e1:proj:other:p1', 's-other'],
      ['remote:e1:proj:proj:src/a.ts:p1', 's-tab'],
    ]);
    expect(findSessionIdForProject(cache, 'proj', 'proj:src/a.ts', 'remote:')).toBe('s-tab');
  });

  it('scope 收敛：distro 不一致的 key 不参与匹配', () => {
    const cache = cacheOf([
      ['wsl:Debian:proj1:tabA:p1', 's-debian'],
      ['wsl:Ubuntu:proj1:tabA:p1', 's-ubuntu'],
    ]);
    expect(findSessionIdForProject(cache, 'proj1', null, 'wsl:Ubuntu:')).toBe('s-ubuntu');
  });

  it('无 sessionId 的条目被跳过，全部 miss 返回 null', () => {
    const cache = cacheOf([
      ['wsl:Ubuntu:proj1:tabA:p1', null],
      ['wsl:Ubuntu:other:tabA:p1', 's-other'],
    ]);
    expect(findSessionIdForProject(cache, 'proj1', null, 'wsl:Ubuntu:')).toBeNull();
  });

  it('无 scope 时跨命名空间按段匹配', () => {
    const cache = cacheOf([['remote:e1:proj:tabA:p1', 's1']]);
    expect(findSessionIdForProject(cache, 'proj', null)).toBe('s1');
  });
});
