import { describe, expect, it } from 'vitest';

import { cn } from '../utils';

/**
 * `cn()` 的合并口径：**字号 token 与颜色类必须共存**。
 *
 * 事故形态：`tailwind-merge` 不认识 `text-micro` / `text-meta`（`@theme inline` 里的自定义阶梯），
 * 把它们归进「颜色」组，于是 `cn('text-meta', 'text-text-secondary')` 只剩颜色 —— 写了字号
 * 却不生效，而调用点看不出任何异常。修法在 `lib/utils.ts`（把阶梯登记进 font-size 组）。
 */
describe('cn', () => {
  it('保留字号 token 与颜色类（两者同属 text- 前缀，但不是同一组）', () => {
    const merged = cn('text-meta text-text-secondary');
    expect(merged).toContain('text-meta');
    expect(merged).toContain('text-text-secondary');
  });

  it('每一档字号都受保护（新增 token 必须同步登记）', () => {
    for (const token of ['micro', 'meta', 'ui', 'ui-md', 'ui-lg', 'section']) {
      const merged = cn(`text-${token}`, 'text-text-on-accent');
      expect(merged).toContain(`text-${token}`);
      expect(merged).toContain('text-text-on-accent');
    }
  });

  it('同组内的冲突仍然按后者胜出（合并本身没有被关掉）', () => {
    expect(cn('text-text-primary', 'text-text-muted')).toBe('text-text-muted');
    expect(cn('text-meta', 'text-ui-lg')).toBe('text-ui-lg');
  });
});
