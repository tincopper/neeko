/* eslint-disable testing-library/no-container, testing-library/no-node-access -- 断言 `hljs-*` 类名与「无 word-diff span」，Testing Library 无按类查询 API */
import { render } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import DiffTable from '../DiffTable';
import { ensureLanguageRegistered } from '../highlight';
import SplitDiffTable from '../SplitDiffTable';
import type { DiffResult } from '../types';

const LANGUAGE = 'typescript';

/**
 * 一行 removed + 一行 added 的配对。
 * 旧实现会为这对行算词级 LCS，并包出 `<span class="word-diff-removed|added">` ——
 * 所以这份夹具正是「行内底块」这条旧通道的触发器。
 */
const pairedDiff: DiffResult = {
  hunks: [
    {
      old_start: 1,
      old_lines: 1,
      new_start: 1,
      new_lines: 1,
      lines: [{ Removed: 'const a = 1;' }, { Added: 'const a = 2;' }],
    },
  ],
};

function contentCells(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('td.line-content')];
}

/**
 * 两个渲染面必须共用同一条口径：**行级底色是唯一的变更标记，行内不叠底块**。
 * 契约与样式判据见 `.trellis/spec/frontend/design-tokens.md`「变更高亮」。
 */
describe('Diff 表格：变更行走整行高亮，不产生行内底块', () => {
  beforeAll(async () => {
    // DiffTable / SplitDiffTable 不自带语言注册（只有 SingleDiffBody 会注册），
    // 这里显式注册，避免断言依赖异步注册时序。
    await ensureLanguageRegistered(LANGUAGE);
  });

  it('unified：变更行输出 hljs token，且不含 word-diff span', () => {
    const { container } = render(<DiffTable diffResult={pairedDiff} language={LANGUAGE} />);
    const cells = contentCells(container);

    expect(cells).toHaveLength(2);
    expect(cells.map((c) => c.textContent)).toEqual(['const a = 1;', 'const a = 2;']);
    for (const cell of cells) {
      expect(cell.querySelector('.word-diff-added, .word-diff-removed')).toBeNull();
      expect(cell.querySelector('.hljs-keyword')?.textContent).toBe('const');
    }
  });

  it('side-by-side：change 行左右单元格各自整行高亮，且不含 word-diff span', () => {
    const { container } = render(<SplitDiffTable diffResult={pairedDiff} language={LANGUAGE} />);
    const cells = contentCells(container);

    expect(cells).toHaveLength(2);
    expect(cells.map((c) => c.textContent)).toEqual(['const a = 1;', 'const a = 2;']);
    for (const cell of cells) {
      expect(cell.querySelector('.word-diff-added, .word-diff-removed')).toBeNull();
      expect(cell.querySelector('.hljs-keyword')?.textContent).toBe('const');
    }
  });

  it('两侧语义仍靠行级类名区分（removed / added 不因删词级而丢失）', () => {
    const { container: unifiedContainer } = render(
      <DiffTable diffResult={pairedDiff} language={LANGUAGE} />,
    );
    const unifiedRows = [...unifiedContainer.querySelectorAll('tr')];
    expect(unifiedRows[0].className).toContain('bg-diff-removed');
    expect(unifiedRows[1].className).toContain('bg-diff-added');

    const { container: splitContainer } = render(
      <SplitDiffTable diffResult={pairedDiff} language={LANGUAGE} />,
    );
    const splitCells = contentCells(splitContainer).map((c) => c.className);
    expect(splitCells[0]).toContain('removed');
    expect(splitCells[1]).toContain('added');
  });
});
