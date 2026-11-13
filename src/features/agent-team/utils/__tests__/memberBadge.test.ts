import { describe, expect, it } from 'vitest';

import type { MemberState } from '@/shared/types/team';

import { memberBadge, memberRoleLabel } from '../memberBadge';

/**
 * 六态徽标（`prototype-agent-team.html` 视图 ②）。
 *
 * 这里钉两件事：
 * 1. **一个都不能合并** —— 任意两个状态的文案互不相同（合并会让两种不同处境长得一样）；
 * 2. **AC2 的判据** —— `idle` + `unverified` 与 `idle` + `verified` 在文案、语义色、可访问文本
 *    三者上都不同。只按 `state` 出文案时两者都写「空闲」，用户会以为活干完了。
 */
const ALL_STATES: MemberState[] = [
  'spawned',
  'running',
  'awaiting',
  'idle',
  'done',
  'failed',
  'offline',
  'stalled',
];

describe('memberBadge — 六态徽标', () => {
  it('每个状态都有非空文案', () => {
    for (const state of ALL_STATES) {
      const badge = memberBadge({ state, verification: 'verified' });
      // 断言里带上 state 才能知道是哪一个状态没文案（vitest 的 expect 无消息参数）。
      expect({ state, text: badge.text.trim() }.text).not.toBe('');
      expect({ state, ariaLabel: badge.ariaLabel.trim() }.ariaLabel).not.toBe('');
    }
  });

  it('任意两个状态的文案互不相同（合并任一状态都会丢信息）', () => {
    const byState = ALL_STATES.map(
      (state) => memberBadge({ state, verification: 'verified' }).text,
    );
    expect(new Set(byState).size).toBe(ALL_STATES.length);
  });

  it('AC2：空闲 + 未声明 与 空闲 + 已声明 在文案/语义色/可访问文本上都不同', () => {
    const unverified = memberBadge({ state: 'idle', verification: 'unverified' });
    const verified = memberBadge({ state: 'idle', verification: 'verified' });

    expect(unverified.text).toBe('空闲 ⚠ 未声明');
    expect(verified.text).toBe('空闲 ✓ 已声明');
    expect(unverified.text).not.toBe(verified.text);
    expect(unverified.tone).not.toBe(verified.tone);
    expect(unverified.ariaLabel).not.toBe(verified.ariaLabel);
    // 未声明那句必须解释「为什么」，否则 ⚠ 只是个装饰。
    expect(unverified.ariaLabel).toContain('任务仍在进行中');
  });

  it('取证只改变「空闲」的文案：其他状态两种取证同形', () => {
    for (const state of ALL_STATES.filter((s) => s !== 'idle')) {
      expect(memberBadge({ state, verification: 'unverified' }).text).toBe(
        memberBadge({ state, verification: 'verified' }).text,
      );
    }
  });

  it('L3 的文案不写「正在工作」（诚实优先于好看）', () => {
    const badge = memberBadge({ state: 'stalled', verification: 'unverified' });
    expect(badge.text).toBe('可能等待输入');
    expect(badge.text).not.toContain('工作');
  });
});

describe('memberRoleLabel', () => {
  it('区分队长与成员', () => {
    expect(memberRoleLabel('lead')).toBe('队长');
    expect(memberRoleLabel('worker')).toBe('成员');
  });
});
