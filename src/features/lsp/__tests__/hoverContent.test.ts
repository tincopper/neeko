import { describe, expect, it } from 'vitest';

import { normalizeHoverContents } from '../utils/hoverContent';

describe('normalizeHoverContents — LSP Hover.contents 归一化', () => {
  it('jdtls 的 MarkedString[] 数组：签名围栏 + javadoc 拼接为单个 markdown', () => {
    const doc = normalizeHoverContents([
      { language: 'java', value: 'void java.io.PrintStream.println(String x)' },
      'Prints a String and then terminates the line',
    ]);

    expect(doc).toEqual({
      kind: 'markdown',
      value:
        '```java\nvoid java.io.PrintStream.println(String x)\n```\n\nPrints a String and then terminates the line',
    });
  });

  it('MarkupContent 单对象原样透传（rust-analyzer 形态不受影响）', () => {
    const doc = normalizeHoverContents({ kind: 'markdown', value: '# Title\nbody' });
    expect(doc).toEqual({ kind: 'markdown', value: '# Title\nbody' });

    expect(normalizeHoverContents({ kind: 'plaintext', value: 'plain text' })).toEqual({
      kind: 'plaintext',
      value: 'plain text',
    });
  });

  it('裸字符串按 markdown 处理', () => {
    expect(normalizeHoverContents('**bold** doc')).toEqual({
      kind: 'markdown',
      value: '**bold** doc',
    });
  });

  it('空项被剔除：数组内空白项 / 空值项不产生空段', () => {
    const doc = normalizeHoverContents([
      { language: 'java', value: '  ' },
      { kind: 'markdown', value: 'real doc' },
      '   ',
      null,
      42,
    ]);
    expect(doc).toEqual({ kind: 'markdown', value: 'real doc' });
  });

  it('全空 / 无法识别 → null（不渲染 tooltip）', () => {
    expect(normalizeHoverContents(null)).toBeNull();
    expect(normalizeHoverContents(undefined)).toBeNull();
    expect(normalizeHoverContents([])).toBeNull();
    expect(normalizeHoverContents('   ')).toBeNull();
    expect(normalizeHoverContents({ language: 'java', value: '' })).toBeNull();
    expect(normalizeHoverContents({ foo: 'bar' })).toBeNull();
  });

  it('全 plaintext 数组归一为 plaintext（不做 markdown 解析）', () => {
    const doc = normalizeHoverContents([
      { kind: 'plaintext', value: 'line one' },
      { kind: 'plaintext', value: 'line two' },
    ]);
    expect(doc).toEqual({ kind: 'plaintext', value: 'line one\n\nline two' });
  });
});
