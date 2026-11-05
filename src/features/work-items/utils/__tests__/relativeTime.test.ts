/**
 * `relativeUpdatedAt`：卡片的相对时间文案（纯函数，`now` 注入）。
 *
 * 判据是「纯"与「分档"两件事：
 * 1. **纯**：同一 `(updatedAt, now)` 两次调用结果相等（不读时钟 ⇒ `React.memo` 站得住）；
 * 2. **分档**：每个档位的**边界**都钉住 —— 边界错一格，用户看到的是「1d ago"而实际是
 *    「23h ago"，这种错没有任何测试会自然失败。
 */
import { describe, expect, it } from 'vitest';

import { cardTimeOf, relativeUpdatedAt } from '../relativeTime';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = 1_700_000_000_000;

describe('relativeUpdatedAt — 分档与边界', () => {
  it('每个档位的下界与上界', () => {
    const cases: Array<[number, string]> = [
      [0, 'just now'],
      [59 * 1000, 'just now'],
      [MIN, '1m ago'],
      [59 * MIN, '59m ago'],
      [HOUR, '1h ago'],
      [23 * HOUR, '23h ago'],
      [DAY, '1d ago'],
      [6 * DAY, '6d ago'],
      [7 * DAY, '1w ago'],
      [29 * DAY, '4w ago'],
      [30 * DAY, '1mo ago'],
      [364 * DAY, '12mo ago'],
      [365 * DAY, '1y ago'],
      [800 * DAY, '2y ago'],
    ];

    for (const [elapsed, expected] of cases) {
      expect(relativeUpdatedAt(NOW - elapsed, NOW)).toBe(expected);
    }
  });

  it('未来时间戳 / 非法输入 → 空串（不猜，也不画「-2m ago"）', () => {
    expect(relativeUpdatedAt(NOW + DAY, NOW)).toBe('');
    expect(relativeUpdatedAt(Number.NaN, NOW)).toBe('');
    expect(relativeUpdatedAt(NOW, Number.NaN)).toBe('');
  });

  it('纯：同一入参两次调用结果相等（不读时钟，React.memo 才站得住）', () => {
    const first = relativeUpdatedAt(NOW - 3 * DAY, NOW);
    const second = relativeUpdatedAt(NOW - 3 * DAY, NOW);
    expect(first).toBe(second);
  });
});

describe('cardTimeOf — 取 updatedAt 而不是 createdAt', () => {
  it('用 updatedAt：3mo ago创建、昨天刚流转的卡片显示「1d ago"', () => {
    const threeMonthsAgo = NOW - 90 * DAY;
    const yesterday = NOW - DAY;

    expect(cardTimeOf({ updatedAt: yesterday }, NOW)).toBe('1d ago');
    // 反证：如果实现改成读 createdAt，这条会得到「3mo ago"——与「多久没动过"语义相反
    expect(cardTimeOf({ updatedAt: threeMonthsAgo }, NOW)).toBe('3mo ago');
  });
});
