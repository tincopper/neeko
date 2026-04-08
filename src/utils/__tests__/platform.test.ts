import { describe, it, expect } from 'vitest';
import { IS_WINDOWS, IS_MACOS } from '../../utils/platform';

describe('platform detection', () => {
  it('导出布尔值常量', () => {
    expect(typeof IS_WINDOWS).toBe('boolean');
    expect(typeof IS_MACOS).toBe('boolean');
  });

  it('两个平台标志不能同时为 true', () => {
    expect(IS_WINDOWS && IS_MACOS).toBe(false);
  });
});
