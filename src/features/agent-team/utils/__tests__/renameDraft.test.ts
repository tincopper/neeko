import { describe, expect, it } from 'vitest';

import { renameDraftCommit } from '../renameDraft';

/**
 * 行内改名的**提交判据**（两处入口共用：列表行与面板头）。
 *
 * 两条都不该发请求：
 * - **空名**：后端判 `InvalidInput`（列表会出现一个点不中的空行）；
 * - **没改**：重写一遍同一个名字只是白写一条审计。
 *
 * 两端空白在提交前裁掉（后端也会裁，这里只是让「只加了空格」也算没改）。
 */
describe('renameDraftCommit', () => {
  it('改了就提交裁掉两端空白的新名字', () => {
    expect(renameDraftCommit('  求和小队  ', 'refactor')).toBe('求和小队');
  });

  it('空名 / 全空白 ⇒ `null`（不是空串：空串会被当成一个真的名字发出去）', () => {
    expect(renameDraftCommit('', 'refactor')).toBeNull();
    expect(renameDraftCommit('   ', 'refactor')).toBeNull();
  });

  it('去掉空白后与当前名字相同 ⇒ `null`（没改）', () => {
    expect(renameDraftCommit('refactor', 'refactor')).toBeNull();
    expect(renameDraftCommit('  refactor ', 'refactor')).toBeNull();
  });
});
