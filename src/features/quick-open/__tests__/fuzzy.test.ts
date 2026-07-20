import { describe, expect, it } from 'vitest';

import { fuzzyFilter, fuzzyScore } from '../fuzzy';

describe('fuzzyScore', () => {
  it('should_prefer_substring_in_basename', () => {
    const a = fuzzyScore('main', 'src/main.go');
    const b = fuzzyScore('main', 'src/domain/maintain.go');
    expect(a).toBeGreaterThan(b);
  });

  it('should_return_negative_when_no_match', () => {
    expect(fuzzyScore('xyz', 'hello.rs')).toBe(-1);
  });

  it('should_return_zero_for_empty_query', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
  });
});

describe('fuzzyFilter', () => {
  it('should_rank_and_limit', () => {
    const items = ['src/a/foo.ts', 'src/b/bar.ts', 'src/foo/index.ts'];
    const out = fuzzyFilter(items, 'foo', (x) => x, 10);
    expect(out[0]).toContain('foo');
    expect(out.length).toBeLessThanOrEqual(10);
  });
});
