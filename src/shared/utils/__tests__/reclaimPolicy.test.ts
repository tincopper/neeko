import { describe, expect, it } from 'vitest';

import { decideReclaims, DEFAULT_RECLAIM_POLICY, type WebviewUsage } from '../reclaimPolicy';

const NOW = 1_000_000_000_000;

function usage(key: string, over: Partial<WebviewUsage> = {}): WebviewUsage {
  return {
    key,
    lastActiveAt: NOW,
    isCreated: true,
    isActive: false,
    ...over,
  };
}

describe('decideReclaims', () => {
  it('never reclaims the active project webview', () => {
    const usages = [
      usage('p1', { isActive: true, lastActiveAt: NOW - 999_999_999 }), // 闲置极久但活跃
      usage('p2', { lastActiveAt: NOW - DEFAULT_RECLAIM_POLICY.maxIdleMs - 1 }),
    ];
    const reclaims = decideReclaims(usages, DEFAULT_RECLAIM_POLICY, NOW);
    expect(reclaims).not.toContain('p1');
    expect(reclaims).toContain('p2');
  });

  it('reclaims idle webviews beyond maxIdleMs', () => {
    const usages = [
      usage('p1', { lastActiveAt: NOW - DEFAULT_RECLAIM_POLICY.maxIdleMs }),
      usage('p2', { lastActiveAt: NOW - DEFAULT_RECLAIM_POLICY.maxIdleMs + 1 }), // 差 1ms,未超时
    ];
    const reclaims = decideReclaims(usages, DEFAULT_RECLAIM_POLICY, NOW);
    expect(reclaims).toEqual(['p1']);
  });

  it('skips projects without a created webview', () => {
    const usages = [usage('p1', { isCreated: false, lastActiveAt: NOW - 999_999_999 })];
    expect(decideReclaims(usages, DEFAULT_RECLAIM_POLICY, NOW)).toEqual([]);
  });

  it('reclaims least-recently-used when total exceeds maxWebviews', () => {
    // 上限 2:1 活跃 + 3 非活跃(均未超闲置)
    const usages = [
      usage('active', { isActive: true, lastActiveAt: NOW }),
      usage('oldest', { lastActiveAt: NOW - 3000 }),
      usage('middle', { lastActiveAt: NOW - 2000 }),
      usage('newest', { lastActiveAt: NOW - 1000 }),
    ];
    const policy = { maxIdleMs: 60_000, maxWebviews: 2 };
    const reclaims = decideReclaims(usages, policy, NOW);
    // 需回收 1+3-2 = 2 个,最久未用的 oldest/middle
    expect(reclaims).toEqual(['oldest', 'middle']);
  });

  it('does not reclaim when under maxWebviews and nothing idle', () => {
    const usages = [usage('active', { isActive: true }), usage('p1', { lastActiveAt: NOW - 1000 })];
    const policy = { maxIdleMs: 60_000, maxWebviews: 8 };
    expect(decideReclaims(usages, policy, NOW)).toEqual([]);
  });

  it('does not over-reclaim idle webviews beyond the limit', () => {
    // 上限 8,1 活跃 + 5 闲置 + 2 非闲置 = 8,恰好不超限
    const usages = [
      usage('active', { isActive: true }),
      ...['i1', 'i2', 'i3', 'i4', 'i5'].map((id) =>
        usage(id, { lastActiveAt: NOW - DEFAULT_RECLAIM_POLICY.maxIdleMs - 1 }),
      ),
      usage('n1', { lastActiveAt: NOW - 1000 }),
      usage('n2', { lastActiveAt: NOW - 2000 }),
    ];
    const reclaims = decideReclaims(usages, DEFAULT_RECLAIM_POLICY, NOW);
    // 仅回收 5 个闲置,不额外回收 n1/n2(总数恰好 = 上限)
    expect(reclaims.sort()).toEqual(['i1', 'i2', 'i3', 'i4', 'i5']);
  });
});
