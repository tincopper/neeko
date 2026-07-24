import { describe, expect, it } from 'vitest';
import {
  AUTO_SCAN_THROTTLE_MS,
  listLoadKey,
  mergeConversationPages,
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

  it('merges pages by id without reordering existing rows', () => {
    const prev = [{ id: 'a' }, { id: 'b' }];
    const next = [{ id: 'b' }, { id: 'c' }];
    expect(mergeConversationPages(prev, next)).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(mergeConversationPages([], next)).toEqual(next);
    expect(mergeConversationPages(prev, [])).toEqual(prev);
  });
});
