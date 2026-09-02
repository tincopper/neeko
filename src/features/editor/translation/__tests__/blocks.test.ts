import { describe, expect, it } from 'vitest';

import { splitHtmlBlocks, splitMarkdownBlocks, splitTextBlocks } from '../blocks';

describe('splitMarkdownBlocks — 基础切块', () => {
  it('标题（含层级）与段落各自成块，代码块与分隔线跳过', () => {
    const md = [
      '# Title',
      '',
      'Intro paragraph.',
      '',
      '```js',
      'const x = 1; // not translated',
      '```',
      '',
      '## Section',
      '',
      '---',
      '',
      'Body text.',
    ].join('\n');

    expect(splitMarkdownBlocks(md)).toEqual([
      { id: 'b0', kind: 'heading', level: 1, text: 'Title' },
      { id: 'b1', kind: 'paragraph', text: 'Intro paragraph.' },
      { id: 'b2', kind: 'heading', level: 2, text: 'Section' },
      { id: 'b3', kind: 'paragraph', text: 'Body text.' },
    ]);
  });

  it('行内标记（粗体/斜体/行内代码/链接/删除线）原样保留', () => {
    const md = 'Use `pnpm dev` with **bold** and *em* plus ~~gone~~ and [link](https://x.y).';

    const [block] = splitMarkdownBlocks(md);
    expect(block.text).toBe(
      'Use `pnpm dev` with **bold** and *em* plus ~~gone~~ and [link](https://x.y).',
    );
  });

  it('列表项拍平（含嵌套），不含列表标记', () => {
    const md = ['- outer one', '- outer two', '  - inner a', '  - inner b', '- outer three'].join(
      '\n',
    );

    expect(splitMarkdownBlocks(md).map((b) => b.text)).toEqual([
      'outer one',
      'outer two',
      'inner a',
      'inner b',
      'outer three',
    ]);
    expect(splitMarkdownBlocks(md).every((b) => b.kind === 'list-item')).toBe(true);
  });

  it('引用块内的段落成为独立块', () => {
    const md = ['> quoted one.', '', '> quoted two.'].join('\n');

    expect(splitMarkdownBlocks(md)).toEqual([
      { id: 'b0', kind: 'quote', text: 'quoted one.' },
      { id: 'b1', kind: 'quote', text: 'quoted two.' },
    ]);
  });

  it('GFM 表格逐单元格成块，分隔行跳过', () => {
    const md = ['| Name | Desc |', '| --- | --- |', '| alpha | first |', '| beta | second |'].join(
      '\n',
    );

    expect(splitMarkdownBlocks(md)).toEqual([
      { id: 'b0', kind: 'table-cell', text: 'Name' },
      { id: 'b1', kind: 'table-cell', text: 'Desc' },
      { id: 'b2', kind: 'table-cell', text: 'alpha' },
      { id: 'b3', kind: 'table-cell', text: 'first' },
      { id: 'b4', kind: 'table-cell', text: 'beta' },
      { id: 'b5', kind: 'table-cell', text: 'second' },
    ]);
  });

  it('空文档 / 仅代码块 → 无块', () => {
    expect(splitMarkdownBlocks('')).toEqual([]);
    expect(splitMarkdownBlocks('   \n  ')).toEqual([]);
    expect(splitMarkdownBlocks('```\nonly code\n```')).toEqual([]);
  });
});

describe('splitHtmlBlocks — DOM 解析切块', () => {
  it('标题/段落/列表项/单元格提取，script/style/pre 跳过，空白折叠，实体解码', () => {
    const html = [
      '<h1>  Getting   Started </h1>',
      '<p>Use &amp; enjoy.</p>',
      '<script>var x = "<p>fake</p>";</script>',
      '<style>p { color: red }</style>',
      '<pre><code>const keep = 1;</code></pre>',
      '<ul><li>first item</li><li>second item</li></ul>',
      '<table><tr><td>cell A</td><td>cell B</td></tr></table>',
    ].join('\n');

    expect(splitHtmlBlocks(html)).toEqual([
      { id: 'b0', kind: 'heading', level: 1, text: 'Getting Started' },
      { id: 'b1', kind: 'paragraph', text: 'Use & enjoy.' },
      { id: 'b2', kind: 'list-item', text: 'first item' },
      { id: 'b3', kind: 'list-item', text: 'second item' },
      { id: 'b4', kind: 'table-cell', text: 'cell A' },
      { id: 'b5', kind: 'table-cell', text: 'cell B' },
    ]);
  });

  it('嵌套列表拍平；引用内段落归属 quote', () => {
    const html = [
      '<ul><li>outer<ul><li>inner</li></ul></li></ul>',
      '<blockquote><p>wisdom</p></blockquote>',
    ].join('\n');

    expect(splitHtmlBlocks(html)).toEqual([
      { id: 'b0', kind: 'list-item', text: 'outer' },
      { id: 'b1', kind: 'list-item', text: 'inner' },
      { id: 'b2', kind: 'quote', text: 'wisdom' },
    ]);
  });

  it('空文档 / 仅不可译元素 → 无块', () => {
    expect(splitHtmlBlocks('')).toEqual([]);
    expect(splitHtmlBlocks('<div><script>x</script></div>')).toEqual([]);
  });
});

describe('splitTextBlocks — 纯文本分段', () => {
  it('按空行分段，首尾空白忽略', () => {
    const txt = [
      '',
      'First paragraph line 1',
      'first paragraph line 2',
      '',
      '',
      'Second paragraph',
      '',
    ].join('\n');

    expect(splitTextBlocks(txt)).toEqual([
      { id: 'b0', kind: 'paragraph', text: 'First paragraph line 1\nfirst paragraph line 2' },
      { id: 'b1', kind: 'paragraph', text: 'Second paragraph' },
    ]);
  });

  it('空文本 → 无块', () => {
    expect(splitTextBlocks('')).toEqual([]);
    expect(splitTextBlocks('\n \n\n')).toEqual([]);
  });
});
