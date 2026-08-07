/* eslint-disable testing-library/no-container, testing-library/no-node-access -- 断言 DOM 结构与计算样式，testing-library 查询 API 不适用 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import DiffTable from '../DiffTable';
import SplitDiffTable from '../SplitDiffTable';
import type { DiffResult } from '../types';

const longLine = 'x'.repeat(200);

const diffResult: DiffResult = {
  hunks: [
    {
      old_start: 1,
      old_lines: 2,
      new_start: 1,
      new_lines: 2,
      lines: [{ Context: 'short' }, { Removed: longLine }, { Added: longLine }],
    },
  ],
};

/** 真实 diff.css 源码（行为级验证：不换行规则确实存在于仓库样式表） */
const cssSource = readFileSync(resolve(process.cwd(), 'src/styles/components/diff.css'), 'utf-8');

/** 从 CSS 源码提取指定选择器的规则体 */
function extractRule(selector: string): string {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const m = cssSource.match(re);
  if (!m) throw new Error(`CSS rule not found: ${selector}`);
  return m[1];
}

describe('diff 长行不自动换行', () => {
  it('unified 模式 line-content 使用 whitespace-pre，不使用 break-all', () => {
    const { container } = render(<DiffTable diffResult={diffResult} language="plaintext" />);
    const cells = container.querySelectorAll('.line-content');
    expect(cells.length).toBeGreaterThan(0);
    cells.forEach((cell) => {
      expect(cell.className).toContain('whitespace-pre');
      expect(cell.className).not.toContain('break-all');
    });
  });

  it('split 模式 cell 使用 whitespace-pre，不使用 break-all', () => {
    const { container } = render(<SplitDiffTable diffResult={diffResult} language="plaintext" />);
    const cells = container.querySelectorAll('.split-cell');
    expect(cells.length).toBeGreaterThan(0);
    cells.forEach((cell) => {
      expect(cell.className).toContain('whitespace-pre');
      expect(cell.className).not.toContain('break-all');
    });
  });

  it('split 模式是单一 table（左右并排同表，水平滚动天然同步）', () => {
    const { container } = render(<SplitDiffTable diffResult={diffResult} language="plaintext" />);
    // 单一 table 内左右两侧一起水平滚动，保证对比行同步
    expect(container.querySelectorAll('table')).toHaveLength(1);
  });

  // ── 行为级：真实 index.css 规则断言 ─────────────────────────────────────

  it('index.css 中 .split-cell 不换行（white-space: pre，无 pre-wrap/break-all）', () => {
    const rule = extractRule('.split-cell');
    expect(rule).toContain('white-space: pre');
    expect(rule).not.toContain('pre-wrap');
    expect(rule).not.toContain('break-all');
  });

  it('index.css 中 .diff-table-split 允许按内容撑宽（table-layout: auto + width: max-content）', () => {
    const rule = extractRule('.diff-table-split');
    expect(rule).toContain('table-layout: auto');
    expect(rule).not.toContain('table-layout: fixed');
    expect(rule).toContain('width: max-content');
    expect(rule).toContain('min-width: 100%');
  });

  it('index.css 中 .col-code 使用 min-width（列宽可随内容增长）', () => {
    const rule = extractRule('.diff-table-split .col-code');
    expect(rule).toContain('min-width');
  });

  // ── 行为级：注入真实规则到 jsdom，getComputedStyle 验证生效 ─────────────

  it('注入真实 CSS 后，split-cell 计算样式为 white-space: pre（不换行生效）', () => {
    // jsdom 不会自动加载仓库样式表，手动注入 diff 相关规则
    const style = document.createElement('style');
    style.textContent = `.split-cell { ${extractRule('.split-cell')} }`;
    document.head.appendChild(style);
    try {
      const { container } = render(<SplitDiffTable diffResult={diffResult} language="plaintext" />);
      const cell = container.querySelector('.split-cell');
      expect(cell).not.toBeNull();
      expect(getComputedStyle(cell as Element).whiteSpace).toBe('pre');
    } finally {
      style.remove();
    }
  });

  it('注入真实 CSS 后，diff-table-split 计算样式为 table-layout: auto（可滚动撑宽）', () => {
    const style = document.createElement('style');
    style.textContent = `.diff-table-split { ${extractRule('.diff-table-split')} }`;
    document.head.appendChild(style);
    try {
      const { container } = render(<SplitDiffTable diffResult={diffResult} language="plaintext" />);
      const table = container.querySelector('table');
      expect(table).not.toBeNull();
      expect(getComputedStyle(table as Element).tableLayout).toBe('auto');
    } finally {
      style.remove();
    }
  });

  // ── 行为级：单滚动容器 + scrollLeft 同步机制 ─────────────────────────────

  it('split 表格位于单一水平滚动容器内，scrollLeft 可读写（水平滚动同步的前提）', () => {
    const { container } = render(
      <div className="overflow-auto" data-testid="scroll-host">
        <SplitDiffTable diffResult={diffResult} language="plaintext" />
      </div>,
    );
    const host = container.querySelector('[data-testid="scroll-host"]');
    expect(host).not.toBeNull();
    // 单一表格 = 单一水平滚动内容，左右两侧必然同步滚动
    expect(host?.querySelectorAll('table')).toHaveLength(1);
    // jsdom 无布局，但 scrollLeft 属性应可读写（滚动机制存在）
    (host as HTMLElement).scrollLeft = 120;
    expect((host as HTMLElement).scrollLeft).toBe(120);
  });
});
