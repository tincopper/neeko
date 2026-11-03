// @vitest-environment node
/**
 * `runFreshness`：执行快照的陈旧度判据（design §4.6）。
 *
 * 纯函数 100% 覆盖是仓库红线。边界是重点：`capturedAt` 正好等于阈值那一帧**不算**过期
 * （「超出」是严格大于），而落在未来的时间戳（时钟回拨 / 跨机快照）不该被标成过期。
 */
import { describe, expect, it } from 'vitest';

import { formatCapturedAt, isStale, RUN_STALE_THRESHOLD_MS } from '../runFreshness';

describe('isStale', () => {
  it('默认阈值是 60 秒（一处定义，调用方不用各写一遍）', () => {
    expect(RUN_STALE_THRESHOLD_MS).toBe(60_000);
  });

  it('差值为 0（刚拿到）不算过期', () => {
    expect(isStale(1_000, 1_000)).toBe(false);
  });

  it('正好等于阈值那一帧不算过期（「超出」= 严格大于）', () => {
    const capturedAt = 1_000;
    expect(isStale(capturedAt, capturedAt + RUN_STALE_THRESHOLD_MS)).toBe(false);
  });

  it('超出阈值 1ms 就算过期', () => {
    const capturedAt = 1_000;
    expect(isStale(capturedAt, capturedAt + RUN_STALE_THRESHOLD_MS + 1)).toBe(true);
  });

  it('capturedAt 落在未来（时钟回拨）不算过期', () => {
    expect(isStale(2_000, 1_000)).toBe(false);
  });

  it('阈值可注入：同一条快照在不同阈值下结论不同', () => {
    const capturedAt = 1_000;
    expect(isStale(capturedAt, capturedAt + 5_000, 10_000)).toBe(false);
    expect(isStale(capturedAt, capturedAt + 5_000, 1_000)).toBe(true);
  });
});

describe('formatCapturedAt', () => {
  it('绝对时间（跟随时区本地化），不是「N 分钟前」', () => {
    const at = Date.UTC(2026, 10, 2, 12, 34, 56);

    expect(formatCapturedAt(at)).toBe(new Date(at).toLocaleString());
  });
});
