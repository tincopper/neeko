import { describe, expect, it } from 'vitest';

import { sortableCardStyle } from '../sortableCardStyle';

/**
 * 「项目卡片浮起来、像被拖走没放下」的成因：dnd-kit 的 `transform` 残留。
 * CSS 不会自己恢复，所以按语义重新判一次 —— 只有「真的在动」才写位移。
 */
describe('sortableCardStyle', () => {
  it('既不在拖、也不在让位 ⇒ 不写 transform（残留值会让卡片永久偏移）', () => {
    expect(
      sortableCardStyle({
        isDragging: false,
        transition: undefined,
        transform: { x: 0, y: 40, scaleX: 1, scaleY: 1 },
      }),
    ).toEqual({ transform: undefined, transition: undefined });
  });

  it('正在拖 ⇒ 写位移（跟手是本职）', () => {
    expect(
      sortableCardStyle({
        isDragging: true,
        transition: undefined,
        transform: { x: 0, y: 12, scaleX: 1, scaleY: 1 },
      }).transform,
    ).toBe('translate3d(0px, 12px, 0) scaleX(1) scaleY(1)');
  });

  it('正在让位（别的卡被拖）⇒ 写位移，否则让位动画消失', () => {
    const style = sortableCardStyle({
      isDragging: false,
      transition: 'transform 200ms ease',
      transform: { x: 0, y: 8, scaleX: 1, scaleY: 1 },
    });
    expect(style.transform).toBe('translate3d(0px, 8px, 0) scaleX(1) scaleY(1)');
    expect(style.transition).toBe('transform 200ms ease');
  });

  it('没有 transform 时不算「在动」', () => {
    expect(sortableCardStyle({ isDragging: false, transition: null, transform: null })).toEqual({
      transform: undefined,
      transition: undefined,
    });
  });
});
