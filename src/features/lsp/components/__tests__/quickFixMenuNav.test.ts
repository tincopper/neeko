// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { QuickFixMenuSection } from '../../api/codeAction';
import { firstEnabledIndex, flattenMenuItems, stepEnabledIndex } from '../quickFixMenuNav';

const SECTIONS: QuickFixMenuSection[] = [
  {
    header: 'Quick Fix',
    items: [
      { title: 'Add import: "fmt"', hint: 'gopls', preferred: true },
      { title: 'Command only', disabledHint: '需 executeCommand · 首版不做' },
      { title: 'Other fix' },
    ],
  },
  {
    header: 'Source Action',
    items: [{ title: 'Organize Imports', disabledHint: '首版不做 · 留扩展点' }],
  },
];

describe('flattenMenuItems', () => {
  it('跨组摊平，顺序与渲染一致', () => {
    expect(flattenMenuItems(SECTIONS).map((i) => i.title)).toEqual([
      'Add import: "fmt"',
      'Command only',
      'Other fix',
      'Organize Imports',
    ]);
  });
});

describe('firstEnabledIndex', () => {
  it('取首个可执行项', () => {
    expect(firstEnabledIndex(flattenMenuItems(SECTIONS))).toBe(0);
  });

  it('全为置灰时返回 -1（无高亮）', () => {
    expect(firstEnabledIndex([{ title: 'a', disabledHint: 'x' }])).toBe(-1);
  });
});

describe('stepEnabledIndex', () => {
  const items = flattenMenuItems(SECTIONS);

  it('向下跳过置灰项', () => {
    expect(stepEnabledIndex(items, 0, 1)).toBe(2);
  });

  it('向上跳过置灰项', () => {
    expect(stepEnabledIndex(items, 2, -1)).toBe(0);
  });

  it('到达末尾停住（不回绕）', () => {
    expect(stepEnabledIndex(items, 2, 1)).toBe(2);
  });

  it('到达开头停住（不回绕）', () => {
    expect(stepEnabledIndex(items, 0, -1)).toBe(0);
  });

  it('无高亮时向下取首个可执行项、向上取最后一个可执行项', () => {
    expect(stepEnabledIndex(items, -1, 1)).toBe(0);
    expect(stepEnabledIndex(items, -1, -1)).toBe(2);
  });

  it('只剩置灰项时移动不产生高亮', () => {
    const disabledOnly = [{ title: 'a', disabledHint: 'x' }];
    expect(stepEnabledIndex(disabledOnly, -1, 1)).toBe(-1);
  });
});
