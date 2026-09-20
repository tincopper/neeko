// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  MENU_GAP,
  MIN_MENU_HEIGHT,
  VIEWPORT_MARGIN,
  computeMenuPosition,
} from '../quickFixMenuPosition';

const VIEWPORT = { width: 1000, height: 800 };
const MENU = { width: 200, height: 200 };

describe('computeMenuPosition', () => {
  it('下方空间充足时贴在锚点下方', () => {
    const pos = computeMenuPosition({ top: 100, bottom: 120, left: 50 }, MENU, VIEWPORT);

    expect(pos.openUpward).toBe(false);
    expect(pos.top).toBe(120 + MENU_GAP);
    expect(pos.left).toBe(50);
  });

  it('下方放不下且上方更宽裕时翻到上方', () => {
    const pos = computeMenuPosition({ top: 700, bottom: 720, left: 50 }, MENU, VIEWPORT);

    expect(pos.openUpward).toBe(true);
    expect(pos.top).toBe(700 - MENU_GAP - MENU.height);
  });

  it('放大侧空间不足时 maxHeight 收窄，长列表改为内部滚动', () => {
    // 翻到上方 → maxHeight 由上方空间决定
    const flipped = computeMenuPosition({ top: 100, bottom: 760, left: 50 }, MENU, VIEWPORT);
    expect(flipped.openUpward).toBe(true);
    expect(flipped.maxHeight).toBe(100 - VIEWPORT_MARGIN - MENU_GAP);
    expect(flipped.maxHeight).toBeGreaterThanOrEqual(MIN_MENU_HEIGHT);

    // 保持下方（下方装得下）→ maxHeight 由下方空间决定
    const below = computeMenuPosition(
      { top: 80, bottom: 100, left: 50 },
      { width: 200, height: 400 },
      VIEWPORT,
    );
    expect(below.openUpward).toBe(false);
    expect(below.maxHeight).toBe(800 - 100 - VIEWPORT_MARGIN - MENU_GAP);
  });

  it('靠右的锚点水平左移，避免溢出视口', () => {
    const pos = computeMenuPosition({ top: 100, bottom: 120, left: 980 }, MENU, VIEWPORT);

    expect(pos.left).toBe(VIEWPORT.width - MENU.width - VIEWPORT_MARGIN);
  });

  it('靠左越界的锚点被夹紧到左边距', () => {
    const pos = computeMenuPosition({ top: 100, bottom: 120, left: -40 }, MENU, VIEWPORT);

    expect(pos.left).toBe(VIEWPORT_MARGIN);
  });

  it('极小视口下 maxHeight 不低于可用下限（宁可靠内部滚动）', () => {
    const pos = computeMenuPosition({ top: 10, bottom: 20, left: 10 }, MENU, {
      width: 200,
      height: 30,
    });

    expect(pos.maxHeight).toBe(MIN_MENU_HEIGHT);
  });
});
