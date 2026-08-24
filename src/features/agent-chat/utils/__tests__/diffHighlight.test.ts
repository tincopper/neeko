import { describe, expect, it } from 'vitest';

import { classifyDiffLine, isDiffLine, type DiffLineKind } from '../diffHighlight';

describe('classifyDiffLine', () => {
  it('classifies hunk headers', () => {
    expect(classifyDiffLine('@@ -12,3 +12,7 @@')).toBe('hunk');
  });

  it('classifies additions (leading +, not +++ file header)', () => {
    expect(classifyDiffLine('+        for ev in map_many(&line) {')).toBe('add');
    expect(classifyDiffLine('+')).toBe('add');
  });

  it('classifies deletions (leading -, not --- file header)', () => {
    expect(classifyDiffLine('-        if let Some(ev) = map(&line) {')).toBe('rem');
    expect(classifyDiffLine('-')).toBe('rem');
  });

  it('treats --- / +++ file headers as context, not diff marks', () => {
    expect(classifyDiffLine('--- a/src/adapter.rs')).toBe('ctx');
    expect(classifyDiffLine('+++ b/src/adapter.rs')).toBe('ctx');
  });

  it('classifies context lines and blanks', () => {
    expect(classifyDiffLine('   some context line')).toBe('ctx');
    expect(classifyDiffLine('')).toBe('ctx');
    expect(classifyDiffLine('diff --git a/b b/b')).toBe('ctx');
  });
});

describe('isDiffLine', () => {
  it('returns true only for add / rem / hunk', () => {
    const cases: Array<[DiffLineKind, boolean]> = [
      ['add', true],
      ['rem', true],
      ['hunk', true],
      ['ctx', false],
    ];
    for (const [kind, expected] of cases) {
      expect(isDiffLine(kind)).toBe(expected);
    }
  });
});
