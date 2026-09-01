import { describe, expect, it } from 'vitest';

import { computeTabOverflow, type OverflowTabEntry } from '../tabOverflow';

const entry = (id: string, width: number): OverflowTabEntry => ({ id, width });

describe('computeTabOverflow — 基础适配', () => {
  it('空 tabs → 空结果', () => {
    expect(computeTabOverflow({ tabs: [], containerWidth: 100 })).toEqual({
      visibleIds: [],
      hiddenIds: [],
    });
  });

  it('全部放得下 → 全部可见，无隐藏', () => {
    const result = computeTabOverflow({
      tabs: [entry('a', 40), entry('b', 30)],
      containerWidth: 100,
      gap: 0,
    });
    expect(result).toEqual({ visibleIds: ['a', 'b'], hiddenIds: [] });
  });

  it('放不下 → 前缀可见，其余进下拉', () => {
    const result = computeTabOverflow({
      tabs: [entry('a', 40), entry('b', 40), entry('c', 40)],
      containerWidth: 100,
      gap: 0,
    });
    expect(result).toEqual({ visibleIds: ['a', 'b'], hiddenIds: ['c'] });
  });

  it('gap 计入总宽度', () => {
    const result = computeTabOverflow({
      tabs: [entry('a', 50), entry('b', 50)],
      containerWidth: 110,
      gap: 10,
    });
    // 50 + 10 + 50 = 110 ≤ 110 → 全可见
    expect(result).toEqual({ visibleIds: ['a', 'b'], hiddenIds: [] });

    const overflowed = computeTabOverflow({
      tabs: [entry('a', 50), entry('b', 50)],
      containerWidth: 109,
      gap: 10,
    });
    expect(overflowed).toEqual({ visibleIds: ['a'], hiddenIds: ['b'] });
  });
});

describe('computeTabOverflow — 激活 tab 强制可见', () => {
  it('激活 tab 在溢出区 → 强制可见，从左往右第一个放不下的被挤出', () => {
    const result = computeTabOverflow({
      tabs: [entry('a', 40), entry('b', 40), entry('c', 40)],
      containerWidth: 100,
      activeTabId: 'c',
      gap: 0,
    });
    // c 保留槽位，a 装得下，b 是第一个放不下的
    expect(result).toEqual({ visibleIds: ['a', 'c'], hiddenIds: ['b'] });
  });

  it('激活 tab 本来就可见 → 不额外挤压', () => {
    const result = computeTabOverflow({
      tabs: [entry('a', 40), entry('b', 40), entry('c', 40)],
      containerWidth: 100,
      activeTabId: 'a',
      gap: 0,
    });
    expect(result).toEqual({ visibleIds: ['a', 'b'], hiddenIds: ['c'] });
  });

  it('激活 tab 宽度超过全部可用空间 → 仅激活 tab 可见', () => {
    const result = computeTabOverflow({
      tabs: [entry('a', 40), entry('huge', 200)],
      containerWidth: 100,
      activeTabId: 'huge',
      gap: 0,
    });
    expect(result).toEqual({ visibleIds: ['huge'], hiddenIds: ['a'] });
  });

  it('activeTabId 为 null / 不存在 → 纯前缀计算', () => {
    const result = computeTabOverflow({
      tabs: [entry('a', 40), entry('b', 40), entry('c', 40)],
      containerWidth: 100,
      activeTabId: null,
      gap: 0,
    });
    expect(result).toEqual({ visibleIds: ['a', 'b'], hiddenIds: ['c'] });

    const missing = computeTabOverflow({
      tabs: [entry('a', 40)],
      containerWidth: 100,
      activeTabId: 'not-exist',
      gap: 0,
    });
    expect(missing).toEqual({ visibleIds: ['a'], hiddenIds: [] });
  });
});

describe('computeTabOverflow — pinned 豁免', () => {
  it('pinned 占满空间 → 普通 tab 全部进下拉，pinned 不参与结果', () => {
    const result = computeTabOverflow({
      tabs: [entry('a', 40), entry('b', 40)],
      containerWidth: 100,
      pinnedTabs: [entry('p1', 60), entry('p2', 60)],
      gap: 0,
    });
    expect(result).toEqual({ visibleIds: [], hiddenIds: ['a', 'b'] });
  });

  it('pinned 占用宽度后剩余空间装部分普通 tab', () => {
    const result = computeTabOverflow({
      tabs: [entry('a', 40), entry('b', 40)],
      containerWidth: 100,
      pinnedTabs: [entry('p1', 30)],
      gap: 0,
    });
    expect(result).toEqual({ visibleIds: ['a'], hiddenIds: ['b'] });
  });

  it('激活 tab 与 pinned 同时存在 → 两者都强制占位', () => {
    const result = computeTabOverflow({
      tabs: [entry('a', 40), entry('b', 40)],
      containerWidth: 100,
      pinnedTabs: [entry('p1', 20)],
      activeTabId: 'b',
      gap: 0,
    });
    // 预算 100 - 20(pinned) - 40(激活 b) = 40 → a 可见
    expect(result).toEqual({ visibleIds: ['a', 'b'], hiddenIds: [] });
  });
});

describe('computeTabOverflow — 溢出按钮预留', () => {
  it('无溢出 → 不预留按钮宽度', () => {
    const result = computeTabOverflow({
      tabs: [entry('a', 40), entry('b', 30)],
      containerWidth: 72,
      overflowButtonWidth: 24,
      gap: 0,
    });
    expect(result).toEqual({ visibleIds: ['a', 'b'], hiddenIds: [] });
  });

  it('有溢出 → 二次计算预留按钮宽度，可见集合相应缩小', () => {
    const result = computeTabOverflow({
      tabs: [entry('a', 40), entry('b', 30)],
      containerWidth: 65,
      overflowButtonWidth: 24,
      gap: 0,
    });
    // 第一遍：40 + 30 = 70 > 65 → b 溢出；
    // 第二遍：预算 65 - 24 = 41 → 仅 a 可见
    expect(result).toEqual({ visibleIds: ['a'], hiddenIds: ['b'] });
  });
});
