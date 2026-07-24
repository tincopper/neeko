import { describe, expect, it } from 'vitest';
import { groupConversationsByDate } from '@/features/conversation/utils/groupByDate';
import type { ConversationMeta } from '@/features/conversation/types';

// Fixed reference: 2026-07-24 12:00 local
const NOW = new Date(2026, 6, 24, 12, 0, 0).getTime();
const DAY = 86_400_000;

function meta(id: string, updatedAt: number): ConversationMeta {
  return {
    id,
    nativeSessionId: id,
    agentId: 'claude-code',
    title: `Conv ${id}`,
    startedAt: updatedAt,
    updatedAt,
    messageCount: 1,
    preview: '',
    filePath: `/tmp/${id}.json`,
    projectPath: '/tmp',
    userTitle: null,
    tags: [],
    supportsResume: true,
  };
}

describe('groupConversationsByDate', () => {
  it('buckets today / yesterday / previous 7 days', () => {
    const groups = groupConversationsByDate(
      [
        meta('a', NOW - 3600_000), // today
        meta('b', NOW - DAY - 3600_000), // yesterday
        meta('c', NOW - 4 * DAY), // previous 7 days
      ],
      NOW,
    );

    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Previous 7 Days']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['a']);
  });

  it('buckets previous 30 days and older months with absolute labels', () => {
    const groups = groupConversationsByDate(
      [
        meta('d', NOW - 20 * DAY), // previous 30 days
        meta('e', new Date(2026, 4, 3).getTime()), // May 2026
        meta('f', new Date(2025, 11, 25).getTime()), // December 2025
      ],
      NOW,
    );

    expect(groups.map((g) => g.label)).toEqual([
      'Previous 30 Days',
      'May 2026',
      'December 2025',
    ]);
    expect(groups[1].key).toBe('2026-05');
    expect(groups[2].key).toBe('2025-12');
  });

  it('preserves input order within a group', () => {
    const groups = groupConversationsByDate(
      [meta('x', NOW - 1000), meta('y', NOW - 2000), meta('z', NOW - 3000)],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual(['x', 'y', 'z']);
  });

  it('returns empty array for no conversations', () => {
    expect(groupConversationsByDate([], NOW)).toEqual([]);
  });
});
