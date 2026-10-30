import { describe, expect, it } from 'vitest';

import type { AgentConfig } from '@/features/agent/types';
import type { ConversationMeta } from '@/features/conversation/types';
import {
  buildAgentOptions,
  countByAgent,
  filterConversations,
  matchesSearch,
} from '@/features/conversation/utils/conversationFilters';

function meta(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: 'pi:a',
    nativeSessionId: 'a',
    agentId: 'pi',
    title: 'Auth refactor',
    startedAt: 0,
    updatedAt: 0,
    messageCount: 0,
    preview: 'token refresh',
    filePath: '/tmp/a.jsonl',
    projectPath: '/tmp/p',
    userTitle: null,
    tags: [],
    ...overrides,
  };
}

const agents: AgentConfig[] = [
  { id: 'pi', name: 'Pi', command: 'pi', args: [], env: {}, icon: null, enabled: true },
  { id: 'codex', name: 'Codex', command: 'codex', args: [], env: {}, icon: null, enabled: true },
];

describe('countByAgent', () => {
  it('counts rows per agent', () => {
    const counts = countByAgent([
      meta(),
      meta({ id: 'pi:b' }),
      meta({ id: 'codex:c', agentId: 'codex' }),
    ]);
    expect(counts.get('pi')).toBe(2);
    expect(counts.get('codex')).toBe(1);
  });

  it('returns an empty map for no rows', () => {
    expect(countByAgent([]).size).toBe(0);
  });
});

describe('matchesSearch / filterConversations', () => {
  it('matches title, preview and agent id case-insensitively', () => {
    expect(matchesSearch(meta(), 'auth')).toBe(true);
    expect(matchesSearch(meta(), 'TOKEN')).toBe(true);
    expect(matchesSearch(meta(), 'pi')).toBe(true);
    expect(matchesSearch(meta(), 'nope')).toBe(false);
  });

  it('prefers the user title over the generated one', () => {
    expect(matchesSearch(meta({ userTitle: 'Renamed chat' }), 'renamed')).toBe(true);
  });

  it('returns the same list for an empty query and filters otherwise', () => {
    const rows = [meta(), meta({ id: 'pi:b', title: 'Release' })];
    expect(filterConversations(rows, '   ')).toBe(rows);
    expect(filterConversations(rows, 'release')).toHaveLength(1);
  });
});

describe('buildAgentOptions', () => {
  it('sorts by display name and maps counts', () => {
    const options = buildAgentOptions({
      catalog: new Map([
        ['pi', 3],
        ['codex', 1],
      ]),
      agents,
      agentFilter: null,
      total: 4,
    });
    expect(options.map((o) => o.id)).toEqual(['codex', 'pi']);
    expect(options.map((o) => o.count)).toEqual([1, 3]);
    expect(options[0].agent?.name).toBe('Codex');
  });

  /**
   * 选中的 agent chip 用**服务端** `total`（此时列表已被服务端过滤），
   * 这一条是无限滚动不错位的口径来源。
   *
   * 变异验证：把 `agentFilter === id ? total : …` 改成总是 `catalog.get(id)` → 红。
   */
  it('uses the server total for the selected agent chip', () => {
    const options = buildAgentOptions({
      catalog: new Map([['pi', 3]]),
      agents,
      agentFilter: 'pi',
      total: 42,
    });
    expect(options.find((o) => o.id === 'pi')?.count).toBe(42);
  });

  it('keeps a selected agent chip visible even when it left the catalog', () => {
    const options = buildAgentOptions({
      catalog: new Map([['pi', 1]]),
      agents,
      agentFilter: 'codex',
      total: 2,
    });
    expect(options.map((o) => o.id)).toContain('codex');
    expect(options.find((o) => o.id === 'codex')?.count).toBe(2);
    expect(options.find((o) => o.id === 'codex')?.agent?.name).toBe('Codex');
  });
});
