/* eslint-disable testing-library/no-container, testing-library/no-node-access -- 拖拽事件需要直接派发到表格行/单元格，查询 API 无法表达 */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import DiffTable from '../DiffTable';
import SplitDiffTable from '../SplitDiffTable';
import type { DiffHunk, DiffResult } from '../types';

/** 两行 context + 变更，供单击/拖拽断言。 */
const simpleResult: DiffResult = {
  hunks: [
    {
      old_start: 1,
      old_lines: 2,
      new_start: 1,
      new_lines: 2,
      lines: [{ Context: 'c1' }, { Removed: 'old' }, { Added: 'new' }],
    },
  ],
};

/** 三个 hunk，行数 2/2/2，供跨 hunk 拖拽断言。 */
const multiHunkResult: DiffResult = {
  hunks: [
    {
      old_start: 1,
      old_lines: 2,
      new_start: 1,
      new_lines: 2,
      lines: [{ Context: 'a1' }, { Context: 'a2' }],
    },
    {
      old_start: 3,
      old_lines: 2,
      new_start: 3,
      new_lines: 2,
      lines: [{ Context: 'b1' }, { Context: 'b2' }],
    },
    {
      old_start: 5,
      old_lines: 2,
      new_start: 5,
      new_lines: 2,
      lines: [{ Context: 'c1' }, { Context: 'c2' }],
    },
  ],
};

/** 含折叠段（4 行被折叠）的 diff。 */
const collapsedResult: DiffResult = {
  hunks: [
    {
      old_start: 1,
      old_lines: 12,
      new_start: 1,
      new_lines: 12,
      lines: [
        { Context: 'c1' },
        { Context: 'c2' },
        { Context: 'c3' },
        { Collapsed: '4 unmodified lines' },
        { Context: 'c8' },
        { Context: 'c9' },
        { Context: 'c10' },
        { Removed: 'old' },
        { Added: 'new' },
      ],
    },
  ],
};

/** 与折叠段对应的全量（未折叠）hunk。 */
const fullHunks: DiffHunk[] = [
  {
    old_start: 1,
    old_lines: 12,
    new_start: 1,
    new_lines: 12,
    lines: [
      { Context: 'c1' },
      { Context: 'c2' },
      { Context: 'c3' },
      { Context: 'c4' },
      { Context: 'c5' },
      { Context: 'c6' },
      { Context: 'c7' },
      { Context: 'c8' },
      { Context: 'c9' },
      { Context: 'c10' },
      { Removed: 'old' },
      { Added: 'new' },
    ],
  },
];

/** 获取表格中第 n 个数据行（<tr>）。 */
function rowAt(container: HTMLElement, index: number): HTMLTableRowElement {
  const rows = container.querySelectorAll('tbody tr');
  const row = rows[index];
  if (!row) throw new Error(`row ${index} not found (${rows.length} rows)`);
  return row as HTMLTableRowElement;
}

/** 在某个行上完成一次拖拽（mousedown → mouseenter → window mouseup）。 */
function dragBetween(container: HTMLElement, from: number, to: number, shiftKey = false) {
  const start = rowAt(container, from);
  fireEvent.mouseDown(start.querySelector('td') as Element, { button: 0, shiftKey });
  fireEvent.mouseEnter(rowAt(container, to));
  fireEvent.mouseUp(window, { shiftKey });
}

describe('DiffTable 拖拽选择（AI review 多行）', () => {
  it('单击 toggle 单行（无拖拽位移仍走 onClick）', () => {
    const onToggleLine = vi.fn();
    const { container } = render(
      <DiffTable diffResult={simpleResult} language="plaintext" onToggleLine={onToggleLine} />,
    );
    fireEvent.click(rowAt(container, 0).querySelector('td') as Element);
    expect(onToggleLine).toHaveBeenCalledWith(0, 0);
  });

  it('拖拽两行提交区间选区（replace 默认）', () => {
    const onDragCommit = vi.fn();
    const { container } = render(
      <DiffTable diffResult={simpleResult} language="plaintext" onDragCommit={onDragCommit} />,
    );
    dragBetween(container, 0, 1);
    expect(onDragCommit).toHaveBeenCalledTimes(1);
    const [keys, mode] = onDragCommit.mock.calls[0] as [Set<string>, string];
    expect([...keys].sort()).toEqual(['0:0', '0:1']);
    expect(mode).toBe('replace');
  });

  it('Shift 拖拽追加选区（append）', () => {
    const onDragCommit = vi.fn();
    const { container } = render(
      <DiffTable diffResult={simpleResult} language="plaintext" onDragCommit={onDragCommit} />,
    );
    dragBetween(container, 0, 1, true);
    expect(onDragCommit).toHaveBeenCalledTimes(1);
    const [, mode] = onDragCommit.mock.calls[0] as [Set<string>, string];
    expect(mode).toBe('append');
  });

  it('跨 hunk 拖拽包含中间 hunk 全部行', () => {
    const onDragCommit = vi.fn();
    const { container } = render(
      <DiffTable diffResult={multiHunkResult} language="plaintext" onDragCommit={onDragCommit} />,
    );
    // 从 hunk0 第 0 行拖到 hunk2 第 1 行
    const row0 = rowAt(container, 0);
    fireEvent.mouseDown(row0.querySelector('td') as Element, { button: 0 });
    fireEvent.mouseEnter(rowAt(container, 5));
    fireEvent.mouseUp(window);
    const [keys] = onDragCommit.mock.calls[0] as [Set<string>, string];
    expect([...keys].sort()).toEqual(['0:0', '0:1', '1:0', '1:1', '2:0', '2:1']);
  });

  it('拖拽结束后同一行的 click 被抑制（不重复 toggle）', () => {
    const onToggleLine = vi.fn();
    const onDragCommit = vi.fn();
    const { container } = render(
      <DiffTable
        diffResult={simpleResult}
        language="plaintext"
        onToggleLine={onToggleLine}
        onDragCommit={onDragCommit}
      />,
    );
    dragBetween(container, 0, 1);
    expect(onDragCommit).toHaveBeenCalledTimes(1);
    // 浏览器在 mouseup 后会补发 click，此时应被 suppressClick 吞掉
    fireEvent.click(rowAt(container, 0).querySelector('td') as Element);
    expect(onToggleLine).not.toHaveBeenCalled();
  });

  it('选中行样式应用 diff-line-selected（预览高亮）', () => {
    const selectedLines = new Set(['0:0']);
    const { container } = render(
      <DiffTable diffResult={simpleResult} language="plaintext" selectedLines={selectedLines} />,
    );
    const rows = container.querySelectorAll('tr.diff-line');
    expect(rows[0].className).toContain('diff-line-selected');
    expect(rows[1].className).not.toContain('diff-line-selected');
  });
});

describe('SplitDiffTable 拖拽选择', () => {
  it('拖拽两行提交区间选区（split 行号含 hunk-header 偏移，DOM 第 0 行 = rowIndex 1）', () => {
    const onDragCommit = vi.fn();
    const { container } = render(
      <SplitDiffTable diffResult={simpleResult} language="plaintext" onDragCommit={onDragCommit} />,
    );
    dragBetween(container, 0, 1);
    expect(onDragCommit).toHaveBeenCalledTimes(1);
    const [keys, mode] = onDragCommit.mock.calls[0] as [Set<string>, string];
    // buildSplitRows 首行为 hunk-header（rowIndex 0，不渲染），数据行从 rowIndex 1 起
    expect([...keys].sort()).toEqual(['0:1', '0:2']);
    expect(mode).toBe('replace');
  });
});

describe('折叠段单段展开', () => {
  it('点击折叠占位行触发 onToggleSection', () => {
    const onToggleSection = vi.fn();
    const { container } = render(
      <DiffTable
        diffResult={collapsedResult}
        language="plaintext"
        fullHunks={fullHunks}
        onToggleSection={onToggleSection}
      />,
    );
    const placeholder = container.querySelector('tr.cursor-pointer td') as Element;
    fireEvent.click(placeholder);
    expect(onToggleSection).toHaveBeenCalledWith(0, 3);
  });

  it('已展开的折叠段渲染全量 context 行并可收起', () => {
    const onToggleSection = vi.fn();
    const expandedSections = new Set(['0:3']);
    const { container } = render(
      <DiffTable
        diffResult={collapsedResult}
        language="plaintext"
        fullHunks={fullHunks}
        expandedSections={expandedSections}
        onToggleSection={onToggleSection}
      />,
    );
    // 折叠段展开后应出现被隐藏的 c4-c7
    const cellText = container.textContent ?? '';
    expect(cellText).toContain('c4');
    expect(cellText).toContain('c7');
    // 收起按钮存在
    const collapseBtn = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Collapse section'),
    );
    expect(collapseBtn).toBeDefined();
    fireEvent.click(collapseBtn as Element);
    expect(onToggleSection).toHaveBeenCalledWith(0, 3);
  });

  it('split 模式折叠段同样支持展开渲染', () => {
    // split 下展开 key 使用 rowIndex（buildSplitRows 首行为 hunk-header，
    // Collapsed 占位行 rowIndex=4，而非 hunk.lines 索引 3）
    const expandedSections = new Set(['0:4']);
    const { container } = render(
      <SplitDiffTable
        diffResult={collapsedResult}
        language="plaintext"
        fullHunks={fullHunks}
        expandedSections={expandedSections}
      />,
    );
    const cellText = container.textContent ?? '';
    expect(cellText).toContain('c4');
    expect(cellText).toContain('c7');
  });

  it('split 模式折叠占位行点击以 rowIndex 触发 onToggleSection', () => {
    const onToggleSection = vi.fn();
    const { container } = render(
      <SplitDiffTable
        diffResult={collapsedResult}
        language="plaintext"
        fullHunks={fullHunks}
        onToggleSection={onToggleSection}
      />,
    );
    // DOM 第 0 行 = rowIndex 1（header 不渲染），Collapsed 占位 = DOM 第 3 行 = rowIndex 4
    const placeholder = rowAt(container, 3);
    fireEvent.click(placeholder.querySelector('td') as Element);
    expect(onToggleSection).toHaveBeenCalledWith(0, 4);
  });

  it('split 模式从折叠行拖拽使用 rowIndex 语义（与普通行选区一致）', () => {
    const onDragCommit = vi.fn();
    const { container } = render(
      <SplitDiffTable
        diffResult={collapsedResult}
        language="plaintext"
        onDragCommit={onDragCommit}
      />,
    );
    // Collapsed 占位 rowIndex=4（DOM 第 3 行）→ 下一行 c8 rowIndex=5（DOM 第 4 行）
    dragBetween(container, 3, 4);
    expect(onDragCommit).toHaveBeenCalledTimes(1);
    const [keys] = onDragCommit.mock.calls[0] as [Set<string>, string];
    expect([...keys].sort()).toEqual(['0:4', '0:5']);
  });

  it('未展开的折叠段不渲染全量行', () => {
    const { container } = render(
      <DiffTable diffResult={collapsedResult} language="plaintext" fullHunks={fullHunks} />,
    );
    const cellText = container.textContent ?? '';
    expect(cellText).toContain('4 unmodified lines');
    expect(cellText).not.toContain('c4');
  });
});

describe('行号列宽度自适应（方案 B）', () => {
  it('unified 行号列宽度随最大行号位数自适应', () => {
    const { container } = render(<DiffTable diffResult={simpleResult} language="plaintext" />);
    // simpleResult 最大行号为 3（1 位）
    const oldNumTd = rowAt(container, 0).querySelector('td') as Element;
    expect(oldNumTd).toHaveStyle('width: calc(1ch + 6px)');
  });

  it('unified 多位数行号列宽度随之加宽', () => {
    const largeResult: DiffResult = {
      hunks: [
        {
          old_start: 95,
          old_lines: 6,
          new_start: 95,
          new_lines: 6,
          lines: [
            { Context: 'c1' },
            { Context: 'c2' },
            { Context: 'c3' },
            { Context: 'c4' },
            { Context: 'c5' },
            { Context: 'c6' },
          ],
        },
      ],
    };
    const { container } = render(<DiffTable diffResult={largeResult} language="plaintext" />);
    // 95..100 → 100 是 3 位
    const oldNumTd = rowAt(container, 0).querySelector('td') as Element;
    expect(oldNumTd).toHaveStyle('width: calc(3ch + 6px)');
  });

  it('split 行号列（--linenum-w）宽度随最大行号位数自适应', () => {
    const { container } = render(<SplitDiffTable diffResult={simpleResult} language="plaintext" />);
    // 宽度经 table 上的 CSS 变量 --linenum-w 下发到 col-linenum
    const table = container.querySelector('table') as Element;
    expect(table).toHaveStyle({ '--linenum-w': 'calc(1ch + 6px)' });
  });

  it('split 行号列右对齐（数字紧贴代码列，间隙由代码列 padding 提供）', () => {
    const { container } = render(<SplitDiffTable diffResult={simpleResult} language="plaintext" />);
    const firstLinenum = rowAt(container, 0).querySelector('.split-linenum') as Element;
    expect(firstLinenum.className).toContain('text-right');
  });

  it('代码列左侧保留 8px 间隙（数字与代码之间）', () => {
    const { container } = render(<DiffTable diffResult={simpleResult} language="plaintext" />);
    const codeTd = rowAt(container, 0).querySelector('.line-content') as Element;
    // pl-2 = 8px（Tailwind class，jsdom 不解析样式，断言 class 而非 computed style）
    expect(codeTd.className).toContain('pl-2');
  });

  it('评论按钮定位在行号右侧（覆盖式，hover 显示）', () => {
    const onCommentLine = vi.fn();
    const { container } = render(
      <SplitDiffTable
        diffResult={simpleResult}
        language="plaintext"
        onCommentLine={onCommentLine}
      />,
    );
    // split 模式 Removed+Added 合并为一行（change 行），新行号列有评论按钮
    const changeRow = rowAt(container, 1);
    const btn = changeRow.querySelector('.split-linenum button') as Element;
    expect(btn.className).toContain('right-0');
    expect(btn.className).toContain('group-hover:opacity-100');
  });

  it('unified 折叠段展开后行号列保持自适应宽度（与普通行一致，不回落固定 40px）', () => {
    // expandedSections key 使用 hunk.lines 索引（Collapsed 占位行在索引 3）
    const expandedSections = new Set(['0:3']);
    const { container } = render(
      <DiffTable
        diffResult={collapsedResult}
        language="plaintext"
        fullHunks={fullHunks}
        expandedSections={expandedSections}
      />,
    );
    // 找到展开段第一行（含被隐藏的 c4）
    const rows = container.querySelectorAll('tbody tr');
    const expandedRow = [...rows].find((r) => r.textContent?.includes('c4')) as Element;
    const oldNumTd = expandedRow.querySelector('td') as Element;
    // 与普通行号列同一宽度公式（collapsedResult 最大行号 1 位）
    expect(oldNumTd).toHaveStyle('width: calc(1ch + 6px)');
    // 不应残留固定 40px 类
    expect(oldNumTd.className).not.toContain('w-[40px]');
  });

  it('unified 折叠段展开行与普通行同列数（不残留多余占位列）', () => {
    const expandedSections = new Set(['0:3']);
    const { container } = render(
      <DiffTable
        diffResult={collapsedResult}
        language="plaintext"
        fullHunks={fullHunks}
        expandedSections={expandedSections}
      />,
    );
    const rows = container.querySelectorAll('tbody tr');
    const expandedRow = [...rows].find((r) => r.textContent?.includes('c4')) as Element;
    // unified 普通行 3 列（old-linenum / new-linenum / code），展开行应一致
    expect(expandedRow.querySelectorAll('td').length).toBe(3);
  });
});
