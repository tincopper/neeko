import { describe, expect, it } from 'vitest';

import { classifyDiffLine, isDiffLine, isDiffOutput, type DiffLineKind } from '../diffHighlight';

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

describe('isDiffOutput', () => {
  it('强信号：hunk 头 / diff --git 文件头判定为 diff', () => {
    expect(isDiffOutput('@@ -12,3 +12,7 @@\n+foo\n-bar')).toBe(true);
    expect(isDiffOutput('diff --git a/src/a.ts b/src/a.ts')).toBe(true);
    expect(isDiffOutput('--- a/src/a.ts\n+++ b/src/a.ts\n+line')).toBe(true);
  });

  it('弱信号：变更行占比 > 40% 判定为 diff', () => {
    expect(isDiffOutput('+a\n+b\n+c\n+d\n ctx')).toBe(true);
    expect(isDiffOutput('-a\n-b\n-c\n ctx\n ctx')).toBe(true);
  });

  it('弱信号：变更行占比 <= 40% 判定为非 diff', () => {
    expect(isDiffOutput('+a\n ctx\n ctx\n ctx')).toBe(false);
  });

  it('markdown 列表 `- `/`+ `（后跟空格）不计为 diff 行', () => {
    expect(isDiffOutput('- item1\n- item2\n- item3\n- item4')).toBe(false);
    expect(isDiffOutput('+ item1\n+ item2\n+ item3\n+ item4')).toBe(false);
  });

  it('markdown 水平线 `---` 整行不计为文件头', () => {
    expect(isDiffOutput('---\n\n正文段落')).toBe(false);
  });

  it('空输出 / 纯文本返回 false', () => {
    expect(isDiffOutput('')).toBe(false);
    expect(isDiffOutput('**Error**: could not find oldString.')).toBe(false);
    expect(isDiffOutput('普通说明文本\n没有变更行')).toBe(false);
  });
});
