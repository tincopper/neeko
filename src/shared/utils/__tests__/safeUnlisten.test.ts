import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reportFrontendError } from '../errorReporting';
import { safeUnlisten } from '../safeUnlisten';

vi.mock('../errorReporting', () => ({
  reportFrontendError: vi.fn(),
}));

const mockReport = vi.mocked(reportFrontendError);

/** 将 promise 拒绝转为同步 throw（模拟 async `_unlisten` 内同步抛错）。 */
function rejectFirstThenResolve(rejections: number, resolved: () => void) {
  let count = 0;
  return () => {
    if (count < rejections) {
      count += 1;
      return Promise.reject(
        new Error("undefined is not an object (evaluating 'listeners[eventId].handlerId')"),
      );
    }
    resolved();
    return Promise.resolve();
  };
}

describe('safeUnlisten', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls the underlying unlisten once on the happy path', () => {
    const inner = vi.fn(() => Promise.resolve());
    const safe = safeUnlisten(inner);

    safe();

    expect(inner).toHaveBeenCalledTimes(1);
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('retries after the race rejection and completes without reporting', async () => {
    const inner = vi.fn(rejectFirstThenResolve(1, () => {}));
    const safe = safeUnlisten(inner);

    safe();
    // 第一次调用 reject（竞态）→ 延后一拍重试
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(inner).toHaveBeenCalledTimes(2);
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('reports via reportFrontendError when retries are exhausted', async () => {
    const inner = vi.fn(() => Promise.reject(new Error('persistent failure')));
    const safe = safeUnlisten(inner);

    safe();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // 初次 + 2 次重试全部失败
    expect(inner).toHaveBeenCalledTimes(3);
    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport).toHaveBeenCalledWith('event.unlisten', expect.any(Error));
  });

  it('is idempotent: subsequent calls do not re-release the same listener', () => {
    const inner = vi.fn(() => Promise.resolve());
    const safe = safeUnlisten(inner);

    safe();
    safe();
    safe();

    expect(inner).toHaveBeenCalledTimes(1);
  });
});
