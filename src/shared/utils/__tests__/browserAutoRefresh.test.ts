import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  armProjectAutoRefresh,
  disarmProjectAutoRefresh,
  isProjectAutoRefreshArmed,
} from '../browserAutoRefresh';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  disarmProjectAutoRefresh('p1');
  disarmProjectAutoRefresh('p2');
  vi.useRealTimers();
});

describe('browserAutoRefresh — tab 自动刷新门控', () => {
  it('starts disarmed', () => {
    expect(isProjectAutoRefreshArmed('p1')).toBe(false);
  });

  it('arm marks the project armed', () => {
    armProjectAutoRefresh('p1');
    expect(isProjectAutoRefreshArmed('p1')).toBe(true);
  });

  it('arming is per-project (does not arm others)', () => {
    armProjectAutoRefresh('p1');
    expect(isProjectAutoRefreshArmed('p1')).toBe(true);
    expect(isProjectAutoRefreshArmed('p2')).toBe(false);
  });

  it('disarm clears the armed state', () => {
    armProjectAutoRefresh('p1');
    disarmProjectAutoRefresh('p1');
    expect(isProjectAutoRefreshArmed('p1')).toBe(false);
  });

  it('auto-disarms after the 30s safety window', () => {
    armProjectAutoRefresh('p1');
    expect(isProjectAutoRefreshArmed('p1')).toBe(true);

    vi.advanceTimersByTime(29_000);
    expect(isProjectAutoRefreshArmed('p1')).toBe(true);

    vi.advanceTimersByTime(1_100);
    expect(isProjectAutoRefreshArmed('p1')).toBe(false);
  });

  it('re-arming resets the safety window', () => {
    armProjectAutoRefresh('p1');
    vi.advanceTimersByTime(20_000);
    armProjectAutoRefresh('p1');
    vi.advanceTimersByTime(29_000);
    // 第二次 arm 重置了 30s 窗口 → 仍应武装
    expect(isProjectAutoRefreshArmed('p1')).toBe(true);
  });
});
