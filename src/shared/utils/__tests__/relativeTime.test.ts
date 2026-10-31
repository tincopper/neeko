import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from '../relativeTime';

/** 固定"现在"，让阈值边界可精确断言（口径与 `prototype.html` 的 `ago()` 一致）。 */
const NOW = Date.parse('2026-10-31T12:00:00.000Z');

function at(secondsAgo: number): string {
  return new Date(NOW - secondsAgo * 1000).toISOString();
}

describe('formatRelativeTime', () => {
  it('5 秒以内算「刚刚」', () => {
    expect(formatRelativeTime(at(0), NOW)).toBe('刚刚');
    expect(formatRelativeTime(at(5), NOW)).toBe('刚刚');
  });

  it('1 分钟以内用秒（6s 起）', () => {
    expect(formatRelativeTime(at(6), NOW)).toBe('6s');
    expect(formatRelativeTime(at(59), NOW)).toBe('59s');
  });

  it('1 小时以内用分钟', () => {
    expect(formatRelativeTime(at(60), NOW)).toBe('1m');
    expect(formatRelativeTime(at(150), NOW)).toBe('3m'); // 2.5 分钟四舍五入
    expect(formatRelativeTime(at(3599), NOW)).toBe('60m');
  });

  it('1 天以内用小时', () => {
    expect(formatRelativeTime(at(3600), NOW)).toBe('1h');
    expect(formatRelativeTime(at(7200), NOW)).toBe('2h');
    expect(formatRelativeTime(at(86399), NOW)).toBe('24h');
  });

  it('超过一天用天', () => {
    expect(formatRelativeTime(at(86400), NOW)).toBe('1d');
    expect(formatRelativeTime(at(86400 * 3), NOW)).toBe('3d');
  });

  it('无法解析的时间返回空串（调用方据此不渲染，而不是伪造 0s）', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('');
    expect(formatRelativeTime('', NOW)).toBe('');
  });

  it('未来时间（时钟回拨）按「刚刚」处理，不出现负秒', () => {
    expect(formatRelativeTime(at(-120), NOW)).toBe('刚刚');
  });
});
