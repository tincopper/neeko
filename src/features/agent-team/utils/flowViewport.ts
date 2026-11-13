/**
 * 分配图画布视口的**纯逻辑**（design §11.4）。
 *
 * 单独成文件而不是塞进 `TeamFlowGraph` 的裸事件处理：wheel 方向、缩放钳制、拖动阈值
 * 都是可以直接打表的判据；组件只负责「事件 → 调这里 → 写 state / scrollLeft」。
 *
 * 这里是画布 pan（滚动视口），不是列表排序 —— 不引入 dnd-kit，见
 * `.trellis/spec/frontend/interaction-patterns.md`「画布 pan 与列表排序的边界」。
 */

/** 缩放上下界（渲染精度 2 位小数，避免浮点尾巴渗进 SVG 尺寸）。 */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.5;
/** wheel 一步的步长；按钮步长（0.25）是中央 tab 的另一套手感，不合并。 */
export const ZOOM_STEP = 0.1;
/** 指针位移超过它就算拖动（不是点击）：拖完手一松不能误开任务详情。 */
export const PAN_CLICK_THRESHOLD = 4;

/** 钳制到 [ZOOM_MIN, ZOOM_MAX] 并保留两位小数（幂等：同值再钳不变）。 */
export function clampZoom(zoom: number): number {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) * 100) / 100;
}

/**
 * wheel → 新缩放：上滚（deltaY < 0）放大、下滚缩小，deltaY=0 原样返回。
 * 到边界后继续滚仍停在边界 —— 受控模式下 `onZoomChange` 也只收到钳制后的值。
 */
export function zoomFromWheel(current: number, deltaY: number): number {
  if (deltaY === 0) return clampZoom(current);
  const step = deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
  return clampZoom(clampZoom(current) + step);
}

/** 指针总位移是否超过阈值（斜向按欧氏距离，反向按绝对值）。超过即「不是点击」。 */
export function isPanClick(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > PAN_CLICK_THRESHOLD;
}
