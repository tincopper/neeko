import { describe, expect, it } from 'vitest';
import {
  AUTO_SCAN_THROTTLE_MS,
  listLoadKey,
  resolveListAfterError,
  shouldAutoScan,
} from '@/features/conversation/utils/conversationListLoad';

describe('conversationListLoad', () => {
  it('builds stable load keys', () => {
    expect(listLoadKey('/a', 'claude-code')).toBe('/a::claude-code');
    expect(listLoadKey(null)).toBe('::');
  });

  it('throttles auto scan within window', () => {
    const now = 10_000;
    expect(shouldAutoScan(undefined, now)).toBe(true);
    expect(shouldAutoScan(now - AUTO_SCAN_THROTTLE_MS + 1, now)).toBe(false);
    expect(shouldAutoScan(now - AUTO_SCAN_THROTTLE_MS, now)).toBe(true);
  });

  it('keeps previous rows on soft error', () => {
    expect(resolveListAfterError([1, 2], true)).toEqual([1, 2]);
    expect(resolveListAfterError([], true)).toEqual([]);
  });
});
