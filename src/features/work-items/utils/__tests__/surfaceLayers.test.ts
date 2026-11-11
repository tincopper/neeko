/**
 * `surfaceLayers` 的纯函数判据（不渲染、不读主题）。
 *
 * 这里只钉「配对是怎么算出来的」，真实渲染的可见性判据在
 * `components/__tests__/surfaceContrast.test.tsx`。
 */
import { describe, expect, it } from 'vitest';

import {
  collectSurfacePairs,
  findMultipleSurfaces,
  parseSurfacePair,
  surfaceOf,
  surfacesOf,
} from '../surfaceLayers';

/** 造一棵最小 DOM：`outer(bg-bg-secondary) > 透明 wrapper > inner(bg-bg-primary)`。 */
function buildTree(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="flex bg-bg-secondary" id="outer">
      <div class="flex min-h-0" id="transparent-wrapper">
        <div class="bg-bg-primary rounded" id="inner"></div>
      </div>
    </div>
    <div class="bg-bg-tertiary" id="lonely"></div>
  `;
  document.body.appendChild(root);
  return root;
}

describe('surfaceOf — 取表面 token', () => {
  it('返回第一个表面 token；没有则 null', () => {
    const el = document.createElement('div');

    el.className = 'flex bg-bg-secondary min-h-0';
    expect(surfaceOf(el)).toBe('bg-bg-secondary');

    el.className = 'flex min-h-0';
    expect(surfaceOf(el)).toBeNull();
  });

  it('不把 `bg-bg-hover` / `bg-bg-selected` 误当普通背景（它们也是表面档）', () => {
    const el = document.createElement('div');
    el.className = 'bg-bg-hover';
    expect(surfaceOf(el)).toBe('bg-bg-hover');
  });

  it('不匹配前缀相似的类（`bg-bg-primary/40` 这种带透明度的不算独立表面档）', () => {
    const el = document.createElement('div');
    // 带斜杠透明度不是整档表面：它是个「同一档的更淡版本」，不该进配对集合
    el.className = 'bg-bg-primary/40';
    expect(surfaceOf(el)).toBeNull();
  });
});

describe('collectSurfacePairs — 自动发现层叠', () => {
  it('隔着透明容器也能找到最近的外层表面（这是真实代码的形态）', () => {
    const root = buildTree();
    const pairs = collectSurfacePairs(root);

    // `inner` 与 `outer` 之间夹着 `#transparent-wrapper`（不画表面），
    // 但视觉上 inner 就是叠在 outer 上 ⇒ 必须算作一对。
    expect(pairs).toContain('bg-bg-secondary > bg-bg-primary');
    // 没有外层表面的元素（`#lonely`）不产生配对
    expect(pairs.filter((p) => p.startsWith('bg-bg-tertiary >'))).toEqual([]);
  });

  it('结果排序去重（同一对出现多次只留一份）', () => {
    const root = buildTree();
    // 再加两个与 inner 同形的东西，制造重复配对
    // `root` 是 detached 容器：`querySelector` 在它上面照样有效，但 `#id` 查找要用
    // `getElementById` 走 document 才稳（jsdom 对 detached 树的 id 索引不一致）。
    const wrapper = root.querySelector('div > div')!;
    for (let i = 0; i < 2; i += 1) {
      const clone = document.createElement('div');
      clone.className = 'bg-bg-primary';
      wrapper.appendChild(clone);
    }

    const pairs = collectSurfacePairs(root);
    expect(pairs).toEqual([...new Set(pairs)]);
    expect([...pairs].sort()).toEqual(pairs);
  });

  it('反证：缺陷形态（内外同色）也会被收集出来（不会被静默跳过）', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="bg-bg-tertiary" id="region">
        <div class="bg-bg-tertiary" id="card"></div>
      </div>
    `;
    // 卡片与所在分区同色 —— 这正是三次事故的形态。
    // 收集阶段**不判断可见性**（那是主题层的事），它只负责如实报告这一对存在。
    expect(collectSurfacePairs(root)).toEqual(['bg-bg-tertiary > bg-bg-tertiary']);
  });
});

describe('findMultipleSurfaces — 一个元素两个表面类', () => {
  it('正常（0 或 1 个）不报', () => {
    const root = buildTree();
    expect(findMultipleSurfaces(root)).toEqual([]);
  });

  it('同一元素写两个表面类会被抓到', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="bg-bg-primary bg-bg-secondary"></div>';
    expect(findMultipleSurfaces(root)).toHaveLength(1);
  });
});

describe('parseSurfacePair — 配对字符串往返', () => {
  it('合法配对解析回两个 token', () => {
    expect(parseSurfacePair('bg-bg-secondary > bg-bg-primary')).toEqual({
      outer: 'bg-bg-secondary',
      inner: 'bg-bg-primary',
    });
  });

  it('格式不对 / token 不认识 ⇒ null（调用方据此报错，不静默跳过）', () => {
    expect(parseSurfacePair('bg-bg-secondary')).toBeNull();
    expect(parseSurfacePair('bg-bg-secondary > oops')).toBeNull();
    expect(parseSurfacePair('a > b > c')).toBeNull();
  });
});

describe('surfacesOf — 全部表面类', () => {
  it('列出同一元素上的所有表面 token', () => {
    const el = document.createElement('div');
    el.className = 'bg-bg-primary bg-bg-secondary flex';
    expect(surfacesOf(el)).toEqual(['bg-bg-primary', 'bg-bg-secondary']);
  });
});
