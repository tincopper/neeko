// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  PAN_CLICK_THRESHOLD,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  clampZoom,
  isPanClick,
  zoomFromWheel,
} from '../flowViewport';

/**
 * 视口纯逻辑的判据（design §11.4）。组件里只留「事件 → 调这里 → 应用结果」的接线，
 * 钳制 / wheel 方向 / 拖动阈值若散在 JSX 里就只能靠手动拖鼠标验证。
 */
describe('clampZoom', () => {
  it('钳在上下界内，越界时返回边界值', () => {
    expect(clampZoom(ZOOM_MIN - 1)).toBe(ZOOM_MIN);
    expect(clampZoom(ZOOM_MAX + 1)).toBe(ZOOM_MAX);
    expect(clampZoom(1)).toBe(1);
  });

  it('保留两位小数，且钳制是幂等的（同值再钳不变）', () => {
    expect(clampZoom(1.234)).toBe(1.23);
    expect(clampZoom(1.235)).toBe(1.24);
    const once = clampZoom(1.234);
    expect(clampZoom(once)).toBe(once);
  });
});

describe('zoomFromWheel', () => {
  it('上滚放大、下滚缩小，步长是 ZOOM_STEP', () => {
    expect(zoomFromWheel(1, -100)).toBe(Number((1 + ZOOM_STEP).toFixed(2)));
    expect(zoomFromWheel(1, 100)).toBe(Number((1 - ZOOM_STEP).toFixed(2)));
  });

  it('deltaY=0 时不变', () => {
    expect(zoomFromWheel(1.4, 0)).toBe(1.4);
  });

  it('到边界后继续滚也不越界（同值时不变）', () => {
    expect(zoomFromWheel(ZOOM_MAX, -100)).toBe(ZOOM_MAX);
    expect(zoomFromWheel(ZOOM_MIN, 100)).toBe(ZOOM_MIN);
  });
});

describe('isPanClick', () => {
  it('零位移 / 恰好阈值都仍是点击', () => {
    expect(isPanClick(0, 0)).toBe(false);
    expect(isPanClick(PAN_CLICK_THRESHOLD, 0)).toBe(false);
    expect(isPanClick(0, PAN_CLICK_THRESHOLD)).toBe(false);
  });

  it('超过阈值（含反向 / 斜向）就不是点击，要吞掉', () => {
    expect(isPanClick(PAN_CLICK_THRESHOLD + 1, 0)).toBe(true);
    expect(isPanClick(0, -(PAN_CLICK_THRESHOLD + 1))).toBe(true);
    expect(isPanClick(3, 4)).toBe(true);
  });
});
