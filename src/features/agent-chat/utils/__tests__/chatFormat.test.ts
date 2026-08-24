import { describe, expect, it } from 'vitest';

import { formatChatTime, formatDuration } from '../chatFormat';

describe('formatChatTime', () => {
  it('formats a date as a 24h clock label like "10:32"', () => {
    const d = new Date(2024, 0, 1, 10, 32, 0);
    expect(formatChatTime(d)).toBe('10:32');
  });

  it('uses 24-hour clock without AM/PM suffix', () => {
    const d = new Date(2024, 0, 1, 15, 5, 0);
    expect(formatChatTime(d)).toBe('15:05');
    expect(formatChatTime(d)).not.toMatch(/(AM|PM)/);
  });

  it('pads midnight/noon hours to two digits', () => {
    expect(formatChatTime(new Date(2024, 0, 1, 0, 5, 0))).toBe('00:05');
    expect(formatChatTime(new Date(2024, 0, 1, 12, 0, 0))).toBe('12:00');
  });

  it('returns a stable short string (no seconds)', () => {
    const d = new Date(2024, 0, 1, 9, 0, 30);
    expect(formatChatTime(d).length).toBeLessThan(12);
  });
});

describe('formatDuration', () => {
  it('formats sub-minute durations as seconds', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(12_000)).toBe('12s');
    expect(formatDuration(59_900)).toBe('59s');
  });

  it('formats minute+second durations', () => {
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(65_000)).toBe('1m 05s');
    expect(formatDuration(125_000)).toBe('2m 05s');
  });

  it('rounds seconds down to whole values', () => {
    expect(formatDuration(5_400)).toBe('5s');
  });
});
