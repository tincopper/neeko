// @vitest-environment node
/**
 * nativeBuild 纯工具测试
 *
 * 语言无关的共享原语（与各语言模块无关）。
 */
import { describe, expect, it } from 'vitest';

import { resolveBinaryPath } from '../nativeBuild';

describe('resolveBinaryPath', () => {
  it('should_join_relative_paths_with_cwd', () => {
    expect(resolveBinaryPath('target/debug/deps/neeko-abc', '/proj')).toBe(
      '/proj/target/debug/deps/neeko-abc',
    );
  });

  it('should_keep_absolute_paths_untouched', () => {
    expect(resolveBinaryPath('/abs/bin', '/proj')).toBe('/abs/bin');
  });
});
